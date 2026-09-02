const { app, BrowserWindow, ipcMain, shell, Menu, protocol, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Readable } = require("stream");
const http = require("http");

const { getAudioMetadata, writeAudioTags } = require("./metadata-bridge");
const { autoTagTrack } = require("./autotag-bridge");
const ffmpegBridge = require("./ffmpeg-bridge");

const { autoUpdater } = require("electron-updater");
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const _publishCfg = (require("./package.json").build || {}).publish || [];
const _githubPublishCfg = (Array.isArray(_publishCfg) ? _publishCfg : [_publishCfg]).find(p => p && p.provider === "github") || {};
const UPDATE_REPO_OWNER = _githubPublishCfg.owner || "FakharArrazi";
const UPDATE_REPO_NAME = _githubPublishCfg.repo || "Project-Playnck";

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
        sendUpdateStatus({
            state: "error",
            message: "Couldn't check for updates. Check your internet connection and try again."
        });
    });
}

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
let updateCheckStarted = false;

function isHexColor(value) {
    return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

ipcMain.handle("set-title-bar-appearance", (event, backgroundColor, symbolColor) => {
    if (!mainWindow || !isHexColor(backgroundColor) || !isHexColor(symbolColor)) return false;
    mainWindow.setBackgroundColor(backgroundColor);
    if (process.platform === "win32") {
        mainWindow.setTitleBarOverlay({ color: backgroundColor, symbolColor });
    }
    return true;
});

const STATIC_MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
};

let localOrigin = null;

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

        server.on("listening", () => {
            localOrigin = `http://127.0.0.1:${server.address().port}`;
            resolve(localOrigin);
        });

        server.once("error", (err) => {
            if (err.code !== "EADDRINUSE") { reject(err); return; }
            console.warn(`Port ${PREFERRED_PORT} is already in use — falling back to a random port. Your saved library/theme from previous sessions won't show up until port ${PREFERRED_PORT} is free again.`);
            server.removeAllListeners("error");
            server.once("error", reject);
            server.listen(0, "127.0.0.1");
        });

        server.listen(PREFERRED_PORT, "127.0.0.1");
    });
}

const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".ogg", ".m4a"];

function findAudioArg(argv) {
    return argv.find(arg => AUDIO_EXTS.includes(path.extname(arg).toLowerCase()));
}

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
            data: data,
            path: filePath
        });
    });
}

if (process.argv.length > 1) {
    fileToOpen = findAudioArg(process.argv);
}

console.log("Process arguments:", process.argv);
console.log("Startup file:", fileToOpen);

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
        const ext = path.extname(filePath || "").toLowerCase();
        if (ext === ".mp3") return await writeAudioTags(filePath, tags);
        return await ffmpegBridge.writeTagsViaFFmpeg(filePath, tags);
    } catch (err) {
        console.error("write-audio-tags failed:", err);
        return { written: false, reason: String((err && err.message) || err) };
    }
});

ipcMain.handle("auto-tag-track", async (event, filePath, hint, mode) => {
    try {
        return await autoTagTrack(filePath, hint, mode);
    } catch (err) {
        console.error("auto-tag-track failed:", err);
        return { found: false, reason: String((err && err.message) || err) };
    }
});

ipcMain.handle("check-for-updates", async () => {
    if (!app.isPackaged) {
        return { started: false, reason: "Updates only run in the installed app, not in development." };
    }
    if (process.platform === "linux") {
        return {
            started: false,
            reason: `Playnck on Linux updates like any other RPM package. Check https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest for a newer version and install it with your package manager (e.g. "sudo dnf install --allowerasing ./playnck-<version>.x86_64.rpm").`,
        };
    }
    try {
        await autoUpdater.checkForUpdates();
        return { started: true };
    } catch (err) {
        console.error("Manual update check failed:", err);
        return { started: false, reason: "Couldn't check for updates. Check your internet connection and try again." };
    }
});

ipcMain.handle("install-update-now", () => {
    autoUpdater.quitAndInstall();
});

ipcMain.handle("get-app-version", () => app.getVersion());

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

ipcMain.handle("rename-file", async (event, filePath, desiredBaseName) => {
    if (!filePath) return { renamed: false, reason: "No file path known for this track." };

    const safeBase = String(desiredBaseName || "").replace(/[\\/:*?"<>|]/g, "-").trim();
    if (!safeBase) return { renamed: false, reason: "That name isn't valid for a file." };

    try {
        const dir = path.dirname(filePath);
        const ext = path.extname(filePath);
        const currentBase = path.basename(filePath, ext);

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

const SCAN_AUDIO_EXTS = [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".weba"];

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

ipcMain.handle("check-paths-exist", async (event, paths) => {
    const results = {};
    if (!Array.isArray(paths)) return results;
    await Promise.all(paths.map(async (p) => {
        if (!p || results.hasOwnProperty(p)) return;
        try {
            await fs.promises.access(p, fs.constants.F_OK);
            results[p] = true;
        } catch {
            results[p] = false;
        }
    }));
    return results;
});

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

ipcMain.handle("select-folder", async (event, defaultPath) => {
    try {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ["openDirectory", "createDirectory"],
            defaultPath: defaultPath || undefined
        });
        if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
        return result.filePaths[0];
    } catch (err) {
        console.error("select-folder failed:", err);
        return null;
    }
});

ipcMain.handle("open-folder", async (event, folderPath) => {
    if (!folderPath) return { opened: false, reason: "No folder path given." };
    try {
        const err = await shell.openPath(folderPath);
        return err ? { opened: false, reason: err } : { opened: true };
    } catch (err) {
        return { opened: false, reason: String((err && err.message) || err) };
    }
});


ipcMain.handle("ffmpeg-detect", async () => {
    try {
        return await ffmpegBridge.detectFFmpeg();
    } catch (err) {
        console.error("ffmpeg-detect failed:", err);
        return { available: false };
    }
});

ipcMain.handle("ffmpeg-install", async () => {
    try {
        return await ffmpegBridge.installFFmpeg((line) => {
            if (mainWindow) mainWindow.webContents.send("ffmpeg-install-progress", { line });
        });
    } catch (err) {
        console.error("ffmpeg-install failed:", err);
        return { success: false, reason: String((err && err.message) || err) };
    }
});

ipcMain.handle("convert-resolve-output-path", async (event, outputDir, baseName, ext, mode) => {
    try {
        return await ffmpegBridge.resolveOutputPath(outputDir, baseName, ext, mode);
    } catch (err) {
        console.error("convert-resolve-output-path failed:", err);
        return { path: path.join(outputDir, `${baseName}.${ext}`), skip: false };
    }
});

ipcMain.handle("convert-file", async (event, job) => {
    try {
        return await ffmpegBridge.convertFile(job, (progress) => {
            if (mainWindow) mainWindow.webContents.send("convert-progress", { jobId: job.jobId, ...progress });
        });
    } catch (err) {
        console.error("convert-file failed:", err);
        return { success: false, reason: String((err && err.message) || err) };
    }
});

ipcMain.handle("convert-cancel", (event, jobId) => {
    return ffmpegBridge.cancelConvertJob(jobId);
});

ipcMain.handle("get-default-convert-output", async () => {
    const dir = path.join(app.getPath("music"), "Playnck Converted");
    try {
        await fs.promises.mkdir(dir, { recursive: true });
    } catch (err) {
        console.error("Couldn't create default Convert output folder:", err);
    }
    return dir;
});

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
        backgroundColor: "#000000",
        ...(process.platform === "win32" ? {
            titleBarStyle: "hidden",
            titleBarOverlay: { color: "#000000", symbolColor: "#f2f2f6", height: 32 }
        } : {}),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    if (app.isPackaged) {
        mainWindow.webContents.on("before-input-event", (event, input) => {
            const key = (input.key || "").toLowerCase();
            const cmdOrCtrl = input.control || input.meta;
            const blocked =
                key === "f12" ||
                (cmdOrCtrl && input.shift && (key === "i" || key === "j" || key === "c")) ||
                (input.meta && input.alt && key === "i");
            if (blocked) event.preventDefault();
        });
    }

    mainWindow.loadURL(`${localOrigin}/index.html`);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://") || url.startsWith("http://")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    let repaintDebounceTimer = null;
    const forceRepaint = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.invalidate();
        }
    };
    const forceRepaintDebounced = () => {
        clearTimeout(repaintDebounceTimer);
        repaintDebounceTimer = setTimeout(forceRepaint, 50);
    };
    mainWindow.on("maximize", forceRepaint);
    mainWindow.on("unmaximize", forceRepaint);
    mainWindow.on("restore", forceRepaint);
    mainWindow.on("enter-full-screen", forceRepaint);
    mainWindow.on("leave-full-screen", forceRepaint);
    mainWindow.on("resize", forceRepaintDebounced);

    mainWindow.webContents.on("did-finish-load", () => {
        console.log("Renderer loaded");

        if (fileToOpen) {
            console.log("Sending file:", fileToOpen);
            sendFileToRenderer(fileToOpen);
        }

        if (app.isPackaged && !updateCheckStarted) {
            updateCheckStarted = true;
            if (process.platform === "linux") {
                console.log("Linux build: skipping in-app update checks (see check-for-updates handler).");
            } else {
                wireUpdateEvents();
                autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));
                setInterval(() => {
                    autoUpdater.checkForUpdates().catch(err => console.error("Update check failed:", err));
                }, 45 * 60 * 1000);
            }
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {

    await startLocalServer();

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


});

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
