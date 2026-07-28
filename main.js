const { app, BrowserWindow, ipcMain, shell, Menu, protocol, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { Readable } = require("stream");
const http = require("http");

// Kept in its own file on purpose — everything related to accurate
// bitrate reading and writing tags back to disk lives there, so it's
// easy to see exactly what's new and easy to drop entirely if this
// ever needs to build for a non-desktop target.
const { getAudioMetadata, writeAudioTags } = require("./metadata-bridge");
const { autoTagTrack } = require("./autotag-bridge");

// Auto-update: checks the GitHub repo configured under
// build.publish in package.json for a newer release, downloads it
// in the background, and installs it on next restart.
//
// This repo (Arrazi-w140/Project-Playnck) needs to be PUBLIC.
// electron-updater's GitHub provider always resolves the latest
// version via a plain https://github.com/OWNER/REPO/releases.atom
// page — a normal github.com webpage, not the api.github.com REST
// API — and that page only supports browser-session login, not a
// personal access token. No token can make that endpoint work
// against a private repo, so there's no "correct" token to put here.
// Making the repo public (Settings -> Danger Zone -> Change
// visibility) is the actual fix, and it's the setup electron-updater
// itself assumes. It's fine to make public since it only holds
// compiled installers, never source.
const { autoUpdater } = require("electron-updater");
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Settings > Updates indicator: mirrors autoUpdater's lifecycle
// events to the renderer over IPC ("update-status") so the Settings
// modal can show a live dot + status line, including real failures
// (bad token, no network) that devtools being locked out in
// production would otherwise hide.
function sendUpdateStatus(payload) {
    if (mainWindow) mainWindow.webContents.send("update-status", payload);
}

function wireUpdateEvents() {
    autoUpdater.on("checking-for-update", () => {
        sendUpdateStatus({ state: "checking" });
    });
    autoUpdater.on("update-available", (info) => {
        sendUpdateStatus({ state: "available", version: info.version });
    });
    autoUpdater.on("update-not-available", () => {
        sendUpdateStatus({ state: "up-to-date", version: app.getVersion() });
    });
    autoUpdater.on("download-progress", (progress) => {
        sendUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) });
    });
    autoUpdater.on("update-downloaded", (info) => {
        sendUpdateStatus({ state: "downloaded", version: info.version });
    });
    autoUpdater.on("error", (err) => {
        console.error("Auto-update error:", err);
        // A plain, non-technical message for the UI — the real error
        // (which could include the release-repo URL) still goes to the
        // console for us, but production builds have devtools/console
        // locked out, so this is the only version an end user ever sees.
        sendUpdateStatus({
            state: "error",
            message: "Couldn't check for updates. Check your internet connection and try again."
        });
    });
}

// Shared between the "open with" IPC path below and the playnck-file://
// streaming protocol further down, so both agree on the same guess.
const MIME_MAP = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    opus: "audio/opus",
    weba: "audio/webm"
};

// Lets the renderer play/seek audio straight off disk by path
// (playnck-file://local/?p=<encoded path>) instead of the library
// keeping its own duplicate copy of every song's bytes in IndexedDB.
// Must be registered before app.whenReady(). "stream" and
// "supportFetchAPI" are what let <audio> do range-request seeking
// against it like it would against a normal http(s) URL.
protocol.registerSchemesAsPrivileged([
    {
        scheme: "playnck-file",
        privileges: {
            standard: true,
            secure: true,
            stream: true,
            supportFetchAPI: true,
            corsEnabled: true,
            bypassCSP: true
        }
    }
]);

let mainWindow = null;
let fileToOpen = null;
let updateCheckStarted = false; // guards against did-finish-load firing more than once

// Tiny local-only static file server for the app's own renderer
// files (index.html, script.js, styles.css, fonts, jsmediatags),
// served over http://127.0.0.1 instead of file://. Loopback-only
// (127.0.0.1, never 0.0.0.0), GET/HEAD-only, and every resolved path
// is confirmed to still be inside this app's own folder before being
// read — this is not a general file server, just file:// swapped for
// http://127.0.0.1 for this app's own bundled files. It doesn't
// change what the renderer can reach; it's the same set of files
// already reachable via file://.
const STATIC_MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml"
};

let localOrigin = null; // e.g. "http://127.0.0.1:47862" — set once startLocalServer() resolves

// Fixed on purpose. The renderer's IndexedDB library (tracks,
// folders, playlists, theme — see music_player_db in script.js) is
// scoped per-origin, and port number is part of the origin. Letting
// the OS hand out a random port (listen(0, ...)) meant every launch
// got a brand-new origin and therefore a brand-new, empty IndexedDB
// — the app wasn't actually losing data, it just could never see the
// previous launch's origin again. Pinning the port keeps the origin
// (and the saved library) stable across restarts.
const PREFERRED_PORT = 47862;

function startLocalServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            if (req.method !== "GET" && req.method !== "HEAD") {
                res.writeHead(405);
                res.end();
                return;
            }

            let reqPath;
            try {
                reqPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
            } catch {
                res.writeHead(400);
                res.end();
                return;
            }
            if (reqPath === "/") reqPath = "/index.html";

            const filePath = path.normalize(path.join(__dirname, reqPath));
            if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) {
                res.writeHead(403);
                res.end();
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, { "Content-Type": STATIC_MIME_MAP[ext] || "application/octet-stream" });
                res.end(req.method === "HEAD" ? undefined : data);
            });
        });

        // "listening" (rather than listen()'s own callback) fires no
        // matter which of the two listen() calls below actually
        // succeeds, so there's one single place that resolves the
        // promise either way.
        server.on("listening", () => {
            localOrigin = `http://127.0.0.1:${server.address().port}`;
            resolve(localOrigin);
        });

        server.once("error", (err) => {
            if (err.code !== "EADDRINUSE") { reject(err); return; }
            // Extremely unlikely for a fixed high port, but if
            // something else on the machine is already bound to it,
            // fall back to a random port rather than failing to
            // start at all — this session just won't see whatever
            // was saved under the usual fixed-port origin.
            console.warn(`Port ${PREFERRED_PORT} is already in use — falling back to a random port. Your saved library/theme from previous sessions won't show up until port ${PREFERRED_PORT} is free again.`);
            server.removeAllListeners("error");
            server.once("error", reject);
            server.listen(0, "127.0.0.1");
        });

        server.listen(PREFERRED_PORT, "127.0.0.1");
    });
}

const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".ogg", ".m4a"];

// Finds the first argument that looks like an actual audio file,
// skipping flags and (critically) skipping argv[0]/other args that
// just happen to have SOME extension — like the app's own .exe path,
// which `path.extname()` would otherwise match just as happily as a
// real .mp3.
function findAudioArg(argv) {
    return argv.find(arg => AUDIO_EXTS.includes(path.extname(arg).toLowerCase()));
}

// Reads the file off disk and sends it to the renderer as raw bytes
// (a File object can't cross the contextIsolation boundary, so we
// send a Buffer + filename + guessed mime type instead, and the
// renderer reconstructs a File from that).
function sendFileToRenderer(filePath) {
    if (!mainWindow) return;

    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error("Failed to read file:", filePath, err);
            return;
        }

        const ext = path.extname(filePath).slice(1).toLowerCase();

        mainWindow.webContents.send("open-file", {
            name: path.basename(filePath),
            mime: MIME_MAP[ext] || "application/octet-stream",
            data: data, // Buffer, sent as-is over IPC
            path: filePath // real disk path — the rebuilt File loses this, so script.js stashes it back on (see resolveFilePath())
        });
    });
}

// Get file passed from Windows
if (process.argv.length > 1) {
    fileToOpen = findAudioArg(process.argv);
}

console.log("Process arguments:", process.argv);
console.log("Startup file:", fileToOpen);

// Accurate bitrate reading + tag writing (see metadata-bridge.js).
// The renderer reaches these through preload.js's electronAPI bridge.
ipcMain.handle("get-audio-metadata", async (event, filePath) => {
    try {
        return await getAudioMetadata(filePath);
    } catch (err) {
        console.error("get-audio-metadata failed:", err);
        return null;
    }
});

ipcMain.handle("write-audio-tags", async (event, filePath, tags) => {
    try {
        return await writeAudioTags(filePath, tags);
    } catch (err) {
        console.error("write-audio-tags failed:", err);
        return { written: false, reason: String((err && err.message) || err) };
    }
});

// Auto-tag (see autotag-bridge.js): fingerprint + AcoustID, falling
// back to a MusicBrainz text search, plus a Cover Art Archive lookup
// for the artwork. hint carries the track's current title/artist so
// the text tier has something to search on. mode ("fingerprint" |
// "text") lets the Edit modal's two separate Auto-tag buttons run
// just one tier instead of the combined "auto" default — see
// autotag-bridge.js's autoTagTrack for details.
ipcMain.handle("auto-tag-track", async (event, filePath, hint, mode) => {
    try {
        return await autoTagTrack(filePath, hint, mode);
    } catch (err) {
        console.error("auto-tag-track failed:", err);
        return { found: false, reason: String((err && err.message) || err) };
    }
});

// Backs the Settings > Updates button, which means two different
// things depending on state: "Try Again" kicks off a fresh check;
// once an update has finished downloading, it installs right now
// instead of waiting for the user to quit on their own.
ipcMain.handle("check-for-updates", async () => {
    if (!app.isPackaged) {
        return { started: false, reason: "Updates only run in the installed app, not in development." };
    }
    try {
        await autoUpdater.checkForUpdates();
        return { started: true };
    } catch (err) {
        // Deliberately not forwarding err.message to the renderer — for
        // GitHub failures that can be a raw HttpError dump (status,
        // full URL, headers, cookies) meant for a log, not a Settings
        // panel. wireUpdateEvents()'s "error" listener already pushes a
        // clean message over "update-status"; this catch just keeps the
        // awaited IPC call from rejecting unhandled.
        console.error("Manual update check failed:", err);
        return { started: false, reason: "Couldn't check for updates. Check your internet connection and try again." };
    }
});

ipcMain.handle("install-update-now", () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle("get-app-version", () => app.getVersion());

// Called from script.js's applyTheme() every time the user switches
// background theme (dark/light/pitchblack), so the title bar's
// background always matches the app's own --bg color instead of
// staying stuck on whatever it was set to at window creation.
// setTitleBarOverlay() only has an effect on Windows/Linux with the
// titleBarStyle:"hidden" overlay above; it's a silent no-op elsewhere
// (e.g. macOS), so no platform check is needed here.
ipcMain.handle("set-titlebar-overlay", (event, { color, symbolColor } = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        mainWindow.setTitleBarOverlay({ color, symbolColor });
    } catch (e) {
        // Older Electron/OS combos without overlay support — ignore.
    }
});

// "Delete track" / "Delete folder" in the renderer send the real
// file to the OS Recycle Bin / Trash (never a permanent unlink) via
// Electron's built-in shell.trashItem. Returns {trashed:false, reason}
// instead of throwing so one locked/missing file doesn't derail a
// whole folder/bulk delete.
ipcMain.handle("trash-file", async (event, filePath) => {
    if (!filePath) return { trashed: false, reason: "No file path known for this track." };
    try {
        await shell.trashItem(filePath);
        return { trashed: true };
    } catch (err) {
        console.error("trash-file failed:", filePath, err);
        return { trashed: false, reason: String((err && err.message) || err) };
    }
});

// "Save Changes" in the Edit modal also renames the real file to
// match the edited title/artist, so it looks right outside the app
// too (Explorer/Finder, another player, etc), not just in its tags.
// desiredBaseName arrives pre-sanitized from the renderer, but this
// re-checks since it's the code actually touching the filesystem.
// Keeps the original extension/folder, and never clobbers an
// unrelated file with the same name — appends " (2)", " (3)", etc.
ipcMain.handle("rename-file", async (event, filePath, desiredBaseName) => {
    if (!filePath) return { renamed: false, reason: "No file path known for this track." };

    const safeBase = String(desiredBaseName || "").replace(/[\\/:*?"<>|]/g, "-").trim();
    if (!safeBase) return { renamed: false, reason: "That name isn't valid for a file." };

    try {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const currentBase = path.basename(filePath, ext);

        // Name didn't actually change (e.g. same title, only artist
        // edited elsewhere) — nothing to rename.
        if (safeBase === currentBase) return { renamed: true, newPath: filePath };

        let candidate = path.join(dir, safeBase + ext);
        let n = 2;
        while (fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(filePath)) {
            candidate = path.join(dir, `${safeBase} (${n})${ext}`);
            n++;
        }

        await fs.promises.rename(filePath, candidate);
        return { renamed: true, newPath: candidate };
    } catch (err) {
        console.error("rename-file failed:", filePath, err);
        return { renamed: false, reason: String((err && err.message) || err) };
    }
});

// Extensions recognized when walking a folder for scan-folder below —
// kept in sync with AUDIO_EXT in script.js's ingestFiles(), which is
// the full list this app ever accepts as a song when importing files
// directly. Deliberately a separate list from AUDIO_EXTS above, which
// is intentionally narrower: that one only governs which OS "open
// this file" argument counts as an audio file worth launching the
// app for, and widening it would be an unrelated behavior change.
const SCAN_AUDIO_EXTS = [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".weba"];

// Recursively collects every audio file under `dir` into `out`.
// Symlinked directories are skipped rather than followed —
// fs.Dirent.isDirectory() is false for a symlink even when it points
// at a real directory, so this falls out for free without needing to
// track visited paths to guard against a symlink loop. A directory
// that can't be read (permissions, or it vanished mid-walk) is
// silently skipped rather than failing the whole scan — one
// unreadable subfolder shouldn't hide every other song in the folder.
async function walkAudioFiles(dir, out) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walkAudioFiles(full, out);
        } else if (entry.isFile() && SCAN_AUDIO_EXTS.includes(path.extname(entry.name).toLowerCase())) {
            out.push(full);
        }
    }
}

// Batch existence check for real paths on disk (files or
// directories) — the renderer uses this two ways: verifyLibraryOnDisk()
// in script.js sweeps every path-backed track and every folder's root
// on launch (and periodically) to prune anything moved/deleted outside
// the app, and handleMissingTrack() uses it to confirm a playback
// failure was actually a missing file before touching the library.
// Returns a plain {path: boolean} map rather than rejecting on a
// missing path, so one bad entry in a large batch doesn't lose the
// answer for the rest.
ipcMain.handle("check-paths-exist", async (event, paths) => {
    const results = {};
    if (!Array.isArray(paths)) return results;
    await Promise.all(paths.map(async (p) => {
        if (!p || results.hasOwnProperty(p)) return; // skip blanks and duplicate entries in the batch
        try {
            await fs.promises.access(p, fs.constants.F_OK);
            results[p] = true;
        } catch {
            results[p] = false;
        }
    }));
    return results;
});

// Recursively lists every audio file currently inside folderPath —
// used by rescanFolders() in script.js to pick up songs dropped into
// an already-added folder from outside the app (Explorer/Finder, a
// sync client, etc.) without the user needing to re-run "Add Folder".
// Returns [] (rather than throwing) for a path that's missing or not
// a real directory, so a stale/renamed folder just yields no new
// tracks instead of rejecting the IPC call.
ipcMain.handle("scan-folder", async (event, folderPath) => {
    if (!folderPath) return [];
    const out = [];
    try {
        const stat = await fs.promises.stat(folderPath);
        if (!stat.isDirectory()) return [];
        await walkAudioFiles(folderPath, out);
    } catch (err) {
        console.error("scan-folder failed:", folderPath, err);
        return [];
    }
    return out;
});

// Generic "Save As" for text content the renderer has already fully
// built (a library backup's JSON, a playlist's .m3u8) — the renderer
// owns the content, main process only owns the native Save dialog and
// writing the file to disk, since only main can show OS dialogs.
// (defaultName, content, filterName, filterExts) ->
//   Promise<{saved:true, filePath} | {saved:false, reason?}>
// reason is the literal string "canceled" when the person just backs
// out of the dialog, so callers can tell that apart from a real error.
ipcMain.handle("save-text-file", async (event, defaultName, content, filterName, filterExts) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            defaultPath: defaultName,
            filters: [{ name: filterName || "Text file", extensions: (filterExts && filterExts.length) ? filterExts : ["txt"] }]
        });
        if (result.canceled || !result.filePath) return { saved: false, reason: "canceled" };
        await fs.promises.writeFile(result.filePath, content, "utf8");
        return { saved: true, filePath: result.filePath };
    } catch (err) {
        console.error("save-text-file failed:", err);
        return { saved: false, reason: String((err && err.message) || err) };
    }
});

// Generic "Open" for picking a text file the renderer will parse
// itself (currently just a library backup's JSON — see
// importLibraryBackup() in script.js).
// (filterName, filterExts) -> Promise<{content, filePath} | null>
// null covers both "the person canceled the dialog" and a read
// failure — importLibraryBackup() only needs to tell "nothing to
// import" from "here's a file", not why nothing came back.
ipcMain.handle("open-text-file", async (event, filterName, filterExts) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ["openFile"],
            filters: [{ name: filterName || "Text file", extensions: (filterExts && filterExts.length) ? filterExts : ["txt"] }]
        });
        if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
        const content = await fs.promises.readFile(result.filePaths[0], "utf8");
        return { content, filePath: result.filePaths[0] };
    } catch (err) {
        console.error("open-text-file failed:", err);
        return null;
    }
});

// --- Lock down dev tools / the native app menu, but ONLY in
// packaged (production) builds — app.isPackaged is false when
// running via `npm start`/`electron .` in development, so debugging
// while you're actually working on the app is completely
// unaffected. This only ever kicks in for the .exe someone else
// downloads and runs.
//
// Menu.setApplicationMenu(null) removes the whole native menu bar
// (File/Edit/View/...) that "Alt" reveals even with
// autoHideMenuBar:true — including the default "Toggle Developer
// Tools" item. The app doesn't rely on any of its own menu items
// (everything's in its own custom UI), so removing it entirely is
// safe.
if (app.isPackaged) {
    Menu.setApplicationMenu(null);
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 600,
        minWidth: 440,
        minHeight: 600,
        autoHideMenuBar: true,
        icon: path.join(__dirname, "icon.ico"),
        // Replaces the plain OS title bar with one whose background
        // color we control, while keeping the native minimize/
        // maximize/close buttons (just recolored). Windows/Linux only
        // — see setTitleBarOverlay IPC handler below for how it stays
        // in sync with the app's current theme.
        titleBarStyle: "hidden",
        titleBarOverlay: {
            color: "#0c0c11",   // matches the default "dark" theme's --bg
            symbolColor: "#f2f2f6",
            height: 34
        },
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Blocks the usual devtools keyboard shortcuts in production —
    // F12, Ctrl/Cmd+Shift+I (inspector), Ctrl/Cmd+Shift+J (console),
    // Ctrl/Cmd+Shift+C (element picker), and Cmd+Option+I on macOS.
    // Menu.setApplicationMenu(null) above already removes the menu
    // item version of this; this catches the keyboard shortcuts too,
    // since those work independently of the menu.
    if (app.isPackaged) {
        mainWindow.webContents.on("before-input-event", (event, input) => {
            const key = (input.key || "").toLowerCase();
            const cmdOrCtrl = input.control || input.meta;
            const blocked =
                key === "f12" ||
                (cmdOrCtrl && input.shift && (key === "i" || key === "j" || key === "c")) ||
                (input.meta && input.alt && key === "i"); // macOS: Cmd+Option+I
            if (blocked) event.preventDefault();
        });
    }

    mainWindow.loadURL(`${localOrigin}/index.html`);

    // Any link the renderer tries to open in "a new window" (e.g. a
    // target="_blank" <a> in the About modal, like the Telegram
    // group link) gets sent to the user's real default browser
    // instead. Without this, Electron either blocks it outright or
    // opens it in a bare, chrome-less Electron window — neither of
    // which is what a normal link click should do.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://") || url.startsWith("http://")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    mainWindow.webContents.on("did-finish-load", () => {
        console.log("Renderer loaded");

        if (fileToOpen) {
            console.log("Sending file:", fileToOpen);
            sendFileToRenderer(fileToOpen);
        }

        // Only checks in a real installed build, not during development
        // (app.isPackaged is false under `npm start`). Started here
        // (rather than in app.whenReady()) so the renderer's
        // onUpdateStatus listener is guaranteed to already be registered
        // before the first "checking-for-update" event can fire —
        // otherwise that first event could reach a page that hasn't
        // finished loading script.js yet and just gets lost.
        // updateCheckStarted guards against a reload stacking up
        // multiple intervals. Re-checks every 45 minutes on top of the
        // one at launch, so an app left running still learns about a
        // new release without needing a full relaunch.
        if (app.isPackaged && !updateCheckStarted) {
            updateCheckStarted = true;
            wireUpdateEvents();
            autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));
            setInterval(() => {
                autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));
            }, 45 * 60 * 1000);
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {

    // Must be up and running before createWindow() calls loadURL()
    // against it below.
    await startLocalServer();

    // Handles playnck-file://local/?p=<encoded absolute path>. Streams
    // the real file straight off disk instead of the renderer holding
    // a Blob copy of it. Range headers are parsed and served by hand
    // (fs.createReadStream(path,{start,end}) + a proper 206/Content-Range
    // response) rather than delegating to net.fetch() on a file:// URL —
    // net.fetch doesn't reliably honor Range against local files, which
    // is what breaks seeking (dragging the progress bar would otherwise
    // get the whole file back from the start instead of jumping ahead).
    // Only reached for tracks that resolved to a real path in the first
    // place (see resolveFilePath()/hydrateTrack() in script.js) —
    // plain-web imports never use this scheme.
    protocol.handle("playnck-file", async (request) => {
        try {
            const url = new URL(request.url);
            const filePath = decodeURIComponent(url.searchParams.get("p") || "");
            if (!filePath) return new Response("Missing path", { status: 400 });

            const stat = await fs.promises.stat(filePath);
            const fileSize = stat.size;
            const ext = path.extname(filePath).slice(1).toLowerCase();
            const contentType = MIME_MAP[ext] || "application/octet-stream";

            const rangeHeader = request.headers.get("range");
            let start = 0;
            let end = fileSize - 1;
            let status = 200;

            if (rangeHeader) {
                const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
                if (match) {
                    if (match[1] !== "") start = parseInt(match[1], 10);
                    if (match[2] !== "") end = parseInt(match[2], 10);
                    // "bytes=-500" style suffix range: last N bytes.
                    if (match[1] === "" && match[2] !== "") {
                        start = Math.max(0, fileSize - parseInt(match[2], 10));
                        end = fileSize - 1;
                    }
                    status = 206;
                }
            }
            if (end >= fileSize) end = fileSize - 1;
            const chunkSize = end - start + 1;

            const nodeStream = fs.createReadStream(filePath, { start, end });
            const webStream = Readable.toWeb(nodeStream);

            const headers = {
                "Content-Type": contentType,
                "Content-Length": String(chunkSize),
                "Accept-Ranges": "bytes",
                // Required for the Equalizer: routing audioEl through a
                // Web Audio AudioContext (see ensureAudioGraph() in
                // script.js) makes Chromium treat the source as tainted
                // without these — and a tainted MediaElementSourceNode
                // produces silence, not an error, which is exactly the
                // "plays fine, no sound" bug this fixes. Expose-Headers
                // is needed too, or the <audio> element's range-request
                // seeking silently breaks under CORS instead (browsers
                // only expose safelisted response headers to it otherwise).
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges"
            };
            if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;

            return new Response(webStream, { status, headers });
        } catch (err) {
            console.error("playnck-file protocol failed:", err);
            return new Response("Not found", { status: 404 });
        }
    });

    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Update checking itself now happens in createWindow()'s
    // did-finish-load handler above (see the comment there for why).

});

// Windows: second instance handling
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {

    app.on("second-instance", (event, argv) => {

        const file = findAudioArg(argv);

        if (file) {
            console.log("Second instance file:", file);
            fileToOpen = file;

            if (mainWindow) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore();
                }

                mainWindow.focus();

                sendFileToRenderer(file);
            }
        }

    });

}

// macOS
app.on("open-file", (event, filePath) => {
    event.preventDefault();

    fileToOpen = filePath;

    console.log("macOS open-file:", filePath);

    if (mainWindow) {
        sendFileToRenderer(filePath);
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});