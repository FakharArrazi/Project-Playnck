// ================================================================
// ffmpeg-bridge.js — Electron MAIN PROCESS module
// ----------------------------------------------------------------
// Everything the Convert tab needs from a real FFmpeg install:
// detecting it, installing it (Windows, via winget) when it's
// missing, and actually running conversions with real progress
// reporting — kept separate from main.js for the same reason
// metadata-bridge.js/autotag-bridge.js are: it's a self-contained
// slice of "talk to an external tool" that's easy to see in one
// place and easy to drop entirely if this project is ever built for
// a target where FFmpeg conversion doesn't make sense.
//
// This is the "FFmpeg Service" layer — it owns every detail of how
// FFmpeg itself is found, installed, and driven (including turning a
// simple {format, bitrate/compressionLevel/bitDepth} choice into the
// actual ffmpeg command-line flags). The renderer's Conversion
// Manager (see the CONVERT TAB section of script.js) only ever deals
// in plain job descriptions and progress percentages — it never
// needs to know an AAC file is "-c:a aac -b:a 256k", just that the
// person picked "AAC" and "256 kbps".
//
// Exports (wired to IPC in main.js):
//   detectFFmpeg() -> Promise<{available, version?, reason?}>
//   installFFmpeg(onLine) -> Promise<{success, reason?}>
//   resolveOutputPath(dir, baseName, ext, mode) -> Promise<{path, skip}>
//   convertFile(job, onProgress) -> Promise<{success, cancelled?, outputPath?, reason?}>
//   cancelConvertJob(jobId) -> boolean
//   FORMAT_INFO — static {ext, label, lossless, supportsCoverArt} per output format
// ================================================================

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFile } = require("child_process");

// What each output format actually is, for both the FFmpeg args
// below and the renderer's format picker (script.js keeps its own
// copy of this same shape in sync — see CONVERT_FORMATS there — since
// it's tiny, static, and needed before any IPC round trip could
// answer it). supportsCoverArt reflects what the *container* can
// really hold, not a wish: RIFF WAV has no standard picture frame,
// and ffmpeg's own opus/ogg muxer doesn't reliably carry an attached
// picture through either, so both are left out here rather than
// silently producing a file that looks like it should have art but
// doesn't.
const FORMAT_INFO = {
    mp3:  { ext: "mp3",  label: "MP3",  lossless: false, supportsCoverArt: true  },
    aac:  { ext: "m4a",  label: "AAC",  lossless: false, supportsCoverArt: true  },
    opus: { ext: "opus", label: "Opus", lossless: false, supportsCoverArt: false },
    flac: { ext: "flac", label: "FLAC", lossless: true,  supportsCoverArt: true  },
    alac: { ext: "m4a",  label: "ALAC", lossless: true,  supportsCoverArt: true  },
    wav:  { ext: "wav",  label: "WAV",  lossless: true,  supportsCoverArt: false }
};

// ----------------------------------------------------------------
// DETECTION
// ----------------------------------------------------------------

// Resolved once per app session and reused from then on (findFFmpeg's
// fast path below) — cleared automatically if a later conversion
// actually fails with ENOENT, so a real "FFmpeg got uninstalled mid-
// session" case still self-corrects instead of trusting a stale path
// forever. { ffmpegPath, ffprobePath, version, env } | null.
let cached = null;

// Actually executes `<bin> -version` and parses a version string out
// of real output — this is the "verify it's executable and usable"
// step the spec asks for, not just noticing a file exists somewhere.
// Resolves {ok:false} rather than throwing/rejecting either way.
function tryRunVersion(bin, env) {
    return new Promise((resolve) => {
        execFile(bin, ["-version"], { timeout: 8000, windowsHide: true, env }, (err, stdout) => {
            if (err || !stdout) return resolve({ ok: false });
            // First line looks like: "ffmpeg version 7.1-full_build-www.gyan.dev Copyright (c) ..."
            const match = /version\s+(\S+)/i.exec(stdout);
            resolve({ ok: true, version: match ? match[1] : "unknown" });
        });
    });
}

// Windows only. winget installing FFmpeg updates the registry's User
// (HKCU) and/or Machine (HKLM) PATH value, but this already-running
// process's own process.env.PATH is a snapshot taken at launch —
// Windows broadcasts WM_SETTINGCHANGE when the registry changes,
// which is how Explorer/new terminals pick it up, but an existing
// Node process never receives that broadcast. Re-reading both PATH
// values straight from the registry and merging them the same way
// Windows itself does (Machine, then User) lets a freshly-finished
// install be found in *this* session instead of asking the person to
// restart Playnck.
function readWindowsPathFromRegistry() {
    return new Promise((resolve) => {
        if (process.platform !== "win32") return resolve(null);
        const queries = [
            ["HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"],
            ["HKCU\\Environment"]
        ];
        Promise.all(queries.map(([key]) => new Promise((res) => {
            execFile("reg", ["query", key, "/v", "Path"], { windowsHide: true }, (err, stdout) => {
                if (err) return res("");
                // A matching line looks like:
                // "    Path    REG_EXPAND_SZ    C:\Windows\system32;C:\Windows;..."
                const match = /REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(stdout);
                res(match ? match[1].trim() : "");
            });
        }))).then(([machine, user]) => {
            const merged = [machine, user].filter(Boolean).join(";");
            resolve(merged || null);
        });
    });
}

// Bounded-depth walk under winget's per-user package folder looking
// for a bin/ containing ffmpeg.exe. Gyan.FFmpeg's package layout is
// "Gyan.FFmpeg_<publisher-id>\ffmpeg-<version>-full_build\bin\", and
// the version-numbered middle folder changes with every release, so
// this can't be a single fixed path — it's a genuine (if small)
// search, not a hard-coded guess. Depth is capped at 3 purely to keep
// this from ever becoming an accidental full-disk walk; the real
// layout above is only 2 levels deep.
async function findFFmpegBinDir(dir, depth = 0) {
    if (depth > 3) return null;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { return null; }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(dir, entry.name);
        if (entry.name.toLowerCase() === "bin") {
            try {
                await fs.promises.access(path.join(full, "ffmpeg.exe"), fs.constants.F_OK);
                return full;
            } catch { /* a bin/ folder that isn't the one we want — keep looking */ }
        }
        const nested = await findFFmpegBinDir(full, depth + 1);
        if (nested) return nested;
    }
    return null;
}

// Finds a real, runnable ffmpeg (and its sibling ffprobe), tried in
// order:
//   1. Whatever was already resolved earlier this session (fast path).
//   2. The bare command on the current process's PATH — covers the
//      ordinary case where FFmpeg was already installed before
//      Playnck ever ran.
//   3. Windows only: PATH re-read straight from the registry (see
//      readWindowsPathFromRegistry above) — covers "winget just
//      finished installing it a moment ago, in this same session".
//   4. Windows only: winget's own per-user package folder (see
//      findFFmpegBinDir above) — covers a winget install whose PATH
//      registry update hasn't been picked up for some other reason.
// Every candidate is actually executed and its output checked before
// being trusted — nothing here is assumed just because a file exists
// at a plausible-looking location.
async function findFFmpeg({ forceRefresh = false } = {}) {
    if (!forceRefresh && cached) return cached;

    let result = await tryRunVersion("ffmpeg", process.env);
    if (result.ok) {
        cached = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", version: result.version, env: process.env };
        return cached;
    }

    if (process.platform === "win32") {
        const freshPath = await readWindowsPathFromRegistry();
        if (freshPath) {
            const env = { ...process.env, PATH: freshPath };
            result = await tryRunVersion("ffmpeg", env);
            if (result.ok) {
                cached = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", version: result.version, env };
                return cached;
            }
        }

        const wingetRoot = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
        try {
            const pkgDirs = await fs.promises.readdir(wingetRoot);
            const ffmpegPkgDir = pkgDirs.find(d => d.toLowerCase().startsWith("gyan.ffmpeg"));
            if (ffmpegPkgDir) {
                const binDir = await findFFmpegBinDir(path.join(wingetRoot, ffmpegPkgDir));
                if (binDir) {
                    const candidate = path.join(binDir, "ffmpeg.exe");
                    result = await tryRunVersion(candidate, process.env);
                    if (result.ok) {
                        cached = {
                            ffmpegPath: candidate,
                            ffprobePath: path.join(binDir, "ffprobe.exe"),
                            version: result.version,
                            env: process.env
                        };
                        return cached;
                    }
                }
            }
        } catch { /* winget's package folder doesn't exist — not installed that way, or not on Windows */ }
    }

    return null;
}

// The Convert tab's very first question, every time it's opened.
async function detectFFmpeg() {
    const found = await findFFmpeg();
    if (!found) return { available: false };
    return { available: true, version: found.version };
}

// ----------------------------------------------------------------
// INSTALLATION (Windows / winget)
// ----------------------------------------------------------------

// Runs winget non-interactively and streams its raw output lines to
// onLine(text) as they arrive, so the UI can show real status text
// instead of an invented progress bar. winget draws its interactive
// progress bar using carriage-return redraws meant for a real
// terminal, and doesn't expose a clean numeric percentage once its
// output is piped (as it is here) — rather than trying to fake one
// out of that, this just forwards whatever real lines it does print
// (download/verify/install status), which is the honest version of
// "don't fake installation progress" for a tool that doesn't hand
// back a real percentage at all.
function installFFmpeg(onLine) {
    return new Promise((resolve) => {
        if (process.platform !== "win32") {
            resolve({
                success: false,
                reason: "One-click installation is only available on Windows. Install FFmpeg manually from ffmpeg.org, then reopen the Convert tab."
            });
            return;
        }

        execFile("winget", ["--version"], { windowsHide: true }, (err) => {
            if (err) {
                resolve({
                    success: false,
                    reason: "winget (the Windows Package Manager) isn't available on this system. Install the \"App Installer\" from the Microsoft Store to get winget, or install FFmpeg manually from ffmpeg.org, then reopen the Convert tab."
                });
                return;
            }

            const args = [
                "install", "--id=Gyan.FFmpeg", "-e",
                "--silent",
                "--accept-package-agreements", "--accept-source-agreements"
            ];
            if (onLine) onLine("Starting installation via winget…");

            let child;
            try {
                child = spawn("winget", args, { windowsHide: true });
            } catch (err) {
                resolve({ success: false, reason: `Couldn't start winget: ${err.message}` });
                return;
            }

            let tail = ""; // last chunk of combined output — used for the failure reason if this doesn't work out
            const forward = (chunk) => {
                const text = chunk.toString("utf8");
                tail += text;
                if (tail.length > 4000) tail = tail.slice(-4000);
                text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean).forEach(line => onLine && onLine(line));
            };
            child.stdout.on("data", forward);
            child.stderr.on("data", forward);

            child.on("error", (err) => {
                resolve({ success: false, reason: `Couldn't start winget: ${err.message}` });
            });

            child.on("close", async (code) => {
                // A couple of winget's own exit codes (and the wording it
                // prints) mean "there was nothing to do, it's already
                // there" rather than a real failure — treat that as
                // success and let the re-detect below confirm it either way.
                const alreadyInstalled = /already installed|no available upgrade/i.test(tail);
                if (code !== 0 && !alreadyInstalled) {
                    resolve({
                        success: false,
                        reason: `winget exited with an error (code ${code}). ${tail.trim().split("\n").slice(-3).join(" ")}`
                    });
                    return;
                }

                if (onLine) onLine("Installation finished. Verifying…");
                const found = await findFFmpeg({ forceRefresh: true });
                if (found) {
                    resolve({ success: true, version: found.version });
                } else {
                    resolve({
                        success: false,
                        reason: "winget reported success, but Playnck still can't run FFmpeg in this session. Try restarting Playnck — Windows sometimes needs a fresh process to see a just-installed program."
                    });
                }
            });
        });
    });
}

// ----------------------------------------------------------------
// OUTPUT PATH / COLLISION HANDLING
// ----------------------------------------------------------------

// Applies the collision-handling mode chosen in the Output section
// (skip/replace/rename) to a desired output path. The "rename" loop
// is the exact same "(2)", "(3)"... pattern main.js's rename-file
// handler already uses for the Edit modal's Save button, so a
// conversion never behaves any differently than anywhere else in
// this app that has to avoid clobbering an existing file.
async function resolveOutputPath(outputDir, baseName, ext, mode) {
    const straightPath = path.join(outputDir, `${baseName}.${ext}`);
    let exists = false;
    try { await fs.promises.access(straightPath, fs.constants.F_OK); exists = true; } catch { /* nothing there — nothing to resolve */ }

    if (!exists) return { path: straightPath, skip: false };
    if (mode === "replace") return { path: straightPath, skip: false };
    if (mode === "skip") return { path: straightPath, skip: true };

    // mode === "rename" (the default — see CONVERT tab in script.js)
    let n = 2;
    let candidate = path.join(outputDir, `${baseName} (${n}).${ext}`);
    for (;;) {
        try {
            await fs.promises.access(candidate, fs.constants.F_OK);
        } catch {
            return { path: candidate, skip: false };
        }
        n++;
        candidate = path.join(outputDir, `${baseName} (${n}).${ext}`);
    }
}

// ----------------------------------------------------------------
// CONVERSION
// ----------------------------------------------------------------

// Turns a {format, settings} choice into real FFmpeg flags. This is
// the one place in the app that knows what "AAC at 256 kbps" or
// "FLAC, compression level 5" actually means on the command line —
// see the header comment on why that knowledge lives here and not in
// the renderer.
function buildFFmpegArgs(inputPath, outputPath, format, settings) {
    const info = FORMAT_INFO[format] || FORMAT_INFO.mp3;
    const args = ["-y", "-i", inputPath];

    // Map audio always; map the (optional) attached-picture video
    // stream too for containers that can actually hold one — "0:v?"
    // is FFmpeg's own "optional stream" syntax, so this does nothing
    // (no error) for a source file that has no cover art at all,
    // instead of needing a separate probe first just to find out.
    // -c:v copy re-packages the existing image as-is rather than
    // re-encoding it.
    if (info.supportsCoverArt) args.push("-map", "0:a", "-map", "0:v?", "-c:v", "copy");
    else args.push("-map", "0:a");

    // Every tag FFmpeg can read off the source container — title,
    // artist, album, album artist, track/disc number, genre, date,
    // composer, copyright, etc. — copied straight through.
    args.push("-map_metadata", "0");

    const settingsObj = settings || {};
    switch (format) {
        case "mp3":
            args.push("-c:a", "libmp3lame", "-b:a", `${settingsObj.bitrateKbps || 192}k`);
            break;
        case "aac":
            args.push("-c:a", "aac", "-b:a", `${settingsObj.bitrateKbps || 192}k`, "-movflags", "+faststart");
            break;
        case "opus":
            args.push("-c:a", "libopus", "-b:a", `${settingsObj.bitrateKbps || 160}k`);
            break;
        case "flac": {
            const level = Math.max(0, Math.min(8, settingsObj.compressionLevel ?? 5));
            args.push("-c:a", "flac", "-compression_level", String(level));
            break;
        }
        case "alac":
            args.push("-c:a", "alac", "-movflags", "+faststart");
            break;
        case "wav":
            args.push("-c:a", settingsObj.bitDepth === 24 ? "pcm_s24le" : "pcm_s16le");
            break;
        default:
            args.push("-c:a", "copy");
    }

    // Machine-readable progress on stdout (repeating key=value blocks,
    // each ended by a literal "progress=continue"/"progress=end" line)
    // instead of the normal human-readable status line on stderr —
    // this is what lets the UI show real elapsed-time/percent instead
    // of guessing from a timer. -nostats silences the redundant
    // human-readable version so it doesn't also show up on stderr.
    args.push("-progress", "pipe:1", "-nostats");
    args.push(outputPath);
    return args;
}

// Active child processes, keyed by a jobId the renderer made up when
// it started the job — lets cancelConvertJob() below find and kill
// exactly the right one without either side needing to track a real
// OS process id across the IPC boundary.
const activeJobs = new Map();

// Runs one real FFmpeg conversion and resolves once it's completely
// finished, failed, or was cancelled — never rejects. job:
//   { jobId, inputPath, outputPath, format, settings, durationSec }
// durationSec (from the source file's already-known duration — see
// getAudioMetadata, reused as-is for the queue's file info) is what
// turns FFmpeg's raw out_time_ms progress numbers into a percentage;
// without it this still works, it just can't report a percent.
async function convertFile(job, onProgress) {
    const found = await findFFmpeg();
    if (!found) {
        return { success: false, reason: "FFmpeg is no longer available. Try reopening the Convert tab." };
    }

    return new Promise((resolve) => {
        const args = buildFFmpegArgs(job.inputPath, job.outputPath, job.format, job.settings);
        let child;
        try {
            child = spawn(found.ffmpegPath, args, { windowsHide: true, env: found.env || process.env });
        } catch (err) {
            resolve({ success: false, reason: `FFmpeg couldn't start: ${err.message}` });
            return;
        }
        activeJobs.set(job.jobId, { child, cancelled: false });

        let stderrTail = "";
        let stdoutBuf = "";

        child.stderr.on("data", (chunk) => {
            stderrTail += chunk.toString("utf8");
            if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000); // keep just enough recent context for a failure reason
        });

        child.stdout.on("data", (chunk) => {
            stdoutBuf += chunk.toString("utf8");
            // Split on the block terminator rather than parsing line by
            // line, since a chunk boundary can land mid-block.
            const blocks = stdoutBuf.split(/progress=(?:continue|end)\r?\n?/);
            stdoutBuf = blocks.pop() || ""; // last piece is a not-yet-complete block — keep it for the next chunk
            for (const block of blocks) {
                const outTimeMatch = /out_time_ms=(\d+)/.exec(block) || /out_time_us=(\d+)/.exec(block);
                const speedMatch = /speed=\s*([\d.]+)x/.exec(block);
                if (outTimeMatch && job.durationSec > 0) {
                    const outSec = Number(outTimeMatch[1]) / 1e6;
                    const percent = Math.max(0, Math.min(100, (outSec / job.durationSec) * 100));
                    if (onProgress) onProgress({ percent, positionSec: outSec, speed: speedMatch ? Number(speedMatch[1]) : null });
                }
            }
        });

        child.on("error", (err) => {
            activeJobs.delete(job.jobId);
            if (err.code === "ENOENT") cached = null; // the resolved path stopped working — don't keep trusting it next time
            resolve({ success: false, reason: `FFmpeg couldn't start: ${err.message}` });
        });

        child.on("close", (code) => {
            const wasCancelled = !!(activeJobs.get(job.jobId) && activeJobs.get(job.jobId).cancelled);
            activeJobs.delete(job.jobId);

            if (wasCancelled) {
                // A half-written file left behind by a killed encode would
                // otherwise look like a real (but silently corrupt) result.
                fs.promises.unlink(job.outputPath).catch(() => {});
                resolve({ success: false, cancelled: true });
                return;
            }
            if (code === 0) {
                if (onProgress) onProgress({ percent: 100 });
                resolve({ success: true, outputPath: job.outputPath });
                return;
            }
            fs.promises.unlink(job.outputPath).catch(() => {}); // don't leave a broken partial file behind on failure either
            const reason = stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" ") || `FFmpeg exited with code ${code}`;
            resolve({ success: false, reason });
        });
    });
}

// Cancel button — kills whichever job is currently running under
// this id, if any. The child's own "close" handler above (which
// checks the "cancelled" flag set here) is what actually resolves the
// pending convertFile() promise and cleans up the partial output
// file, so nothing further is needed on this side.
function cancelConvertJob(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    job.child.kill();
    return true;
}

// ----------------------------------------------------------------
// TAG WRITING (everything except MP3)
// ----------------------------------------------------------------
// metadata-bridge.js's writeAudioTags() only ever covers .mp3 (ID3v2
// via node-id3) — there's no dependency-free tag writer for the rest
// of what Playnck can play. Once FFmpeg is available (same
// detection as the Convert tab above), this reuses it for that too:
// remux the file to a temp copy with the same -map_metadata 0 +
// explicit overrides trick buildFFmpegArgs() already uses, -c copy
// throughout so the actual audio is never re-encoded, then
// atomically swap the temp copy in for the original. The original is
// never opened for writing directly — if anything goes wrong
// partway through, it's the temp copy that ends up broken (and gets
// deleted), and the real file is untouched.
//
// Which containers can actually hold an embedded picture mirrors
// FORMAT_INFO's supportsCoverArt reasoning above (WAV has no
// standard picture frame; FFmpeg's ogg/opus muxer doesn't reliably
// carry one through) — title/artist/album still get written either
// way, just not a new cover.
const TAG_WRITABLE_EXTS = {
    ".flac": { supportsCoverArt: true },
    ".m4a":  { supportsCoverArt: true },
    // .ogg and .opus share the same underlying Ogg container/muxer in
    // FFmpeg, and an attached picture there is an unofficial (if
    // widely-used) convention rather than a formally standardized
    // part of the format the way FLAC's own PICTURE block is — in
    // practice, plenty of phones/media scanners don't reliably show
    // it even when FFmpeg writes it correctly. Kept false for both,
    // consistent with FORMAT_INFO's opus entry above, rather than
    // risk the exact "looks fine in Playnck, still missing once it's
    // actually on your phone" bug this file exists to fix.
    ".ogg":  { supportsCoverArt: false },
    ".opus": { supportsCoverArt: false },
    ".wav":  { supportsCoverArt: false }
};

// Retries an fs operation a few times with a short, increasing delay
// if it fails with a Windows file-locking error code — EPERM/EBUSY
// most commonly mean some other handle on the file (antivirus, the
// search indexer, OneDrive, or Playnck's own playback stream if it
// wasn't released in time — see the Edit modal's Save handler in
// script.js for that one) hasn't let go yet, and it often does within
// a few hundred ms. Anything else (e.g. a genuine permissions error)
// is rethrown immediately rather than retried pointlessly.
async function retryOnWindowsLock(fn, { attempts = 5, baseDelayMs = 150 } = {}) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            const lockCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
            if (i === attempts - 1 || !lockCodes.has(err && err.code)) throw err;
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
        }
    }
}

// tags: { title?, artist?, album?, imageData?, imageMime?, removeImage? }
// — the exact same shape the renderer already builds for
// metadata-bridge.js's writeAudioTags(), so main.js's write-audio-tags
// handler can hand either writer the same object untouched (see the
// extension-based dispatch there).
async function writeTagsViaFFmpeg(filePath, tags) {
    const ext = path.extname(filePath).toLowerCase();
    const capability = TAG_WRITABLE_EXTS[ext];
    if (!capability) {
        const label = ext ? ext.slice(1).toUpperCase() : "this file type";
        return { written: false, reason: `Writing tags directly to ${label} files isn't supported yet.` };
    }

    const found = await findFFmpeg();
    if (!found) {
        const label = ext.slice(1).toUpperCase();
        return {
            written: false,
            reason: `Writing tags into ${label} files needs FFmpeg, which isn't installed yet. Install it from the Convert tab, then try saving again.`
        };
    }

    const wantsNewImage = !tags.removeImage && tags.imageData;
    const imageIgnored = !!(wantsNewImage && !capability.supportsCoverArt);

    const dir = path.dirname(filePath);
    // Hidden, same-directory temp name — same directory keeps the
    // final fs.rename() on the same filesystem, which is what makes
    // it atomic (a cross-device rename isn't, and could leave a
    // half-copied file behind if interrupted).
    const tempOutput = path.join(dir, `.playnck-tagwrite-${Date.now()}${ext}`);
    let tempCoverPath = null;

    try {
        const args = ["-y", "-i", filePath];

        if (wantsNewImage && capability.supportsCoverArt) {
            // FFmpeg needs a real file for a second input — there's no
            // clean way to hand it an in-memory buffer as -i pipe:1
            // while pipe:0 is already the main input.
            tempCoverPath = path.join(os.tmpdir(), `playnck-cover-${Date.now()}${imageExtFromMime(tags.imageMime)}`);
            await fs.promises.writeFile(tempCoverPath, Buffer.from(tags.imageData));
            args.push("-i", tempCoverPath);
        }

        // Copy every tag FFmpeg can read off the source first, same as
        // buildFFmpegArgs() above, then override just the fields the
        // Edit modal actually exposes — everything else the file
        // already had (genre, date, composer, disc/track number, etc.)
        // passes through untouched.
        args.push("-map_metadata", "0", "-map", "0:a", "-c:a", "copy");

        if (tags.removeImage) {
            // No video map at all — drops whatever picture stream was there.
        } else if (wantsNewImage && capability.supportsCoverArt) {
            // New picture comes from input 1 (the temp file above); it
            // has no pre-existing disposition of its own, so it needs
            // to be explicitly flagged as the attached cover rather
            // than a generic video stream.
            args.push("-map", "1:v", "-disposition:v:0", "attached_pic", "-c:v", "copy");
        } else if (capability.supportsCoverArt) {
            // Keep whatever's already embedded, byte-for-byte — "0:v?"
            // is FFmpeg's "optional stream" syntax, so a source file
            // with no art at all just quietly maps nothing.
            args.push("-map", "0:v?", "-c:v", "copy");
        }

        if (tags.title != null) args.push("-metadata", `title=${tags.title}`);
        if (tags.artist != null) args.push("-metadata", `artist=${tags.artist}`);
        if (tags.album != null) args.push("-metadata", `album=${tags.album}`);
        args.push(tempOutput);

        const run = await new Promise((resolve) => {
            let child;
            try {
                child = spawn(found.ffmpegPath, args, { windowsHide: true, env: found.env || process.env });
            } catch (err) {
                resolve({ ok: false, reason: `FFmpeg couldn't start: ${err.message}` });
                return;
            }
            let stderrTail = "";
            child.stderr.on("data", (chunk) => {
                stderrTail += chunk.toString("utf8");
                if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
            });
            child.on("error", (err) => resolve({ ok: false, reason: `FFmpeg couldn't start: ${err.message}` }));
            child.on("close", (code) => {
                if (code === 0) resolve({ ok: true });
                else resolve({ ok: false, reason: stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" ") || `FFmpeg exited with code ${code}` });
            });
        });

        if (!run.ok) {
            await fs.promises.unlink(tempOutput).catch(() => {});
            return { written: false, reason: run.reason };
        }

        // Verify the temp copy actually contains what was asked for
        // BEFORE swapping it in for the real file — FFmpeg exiting 0
        // only means it finished without error, not that every
        // -metadata override actually stuck (some muxers silently
        // drop fields or streams they don't recognize). Checking here,
        // pre-rename, means the original file is genuinely never
        // touched if verification fails, matching the "temp copy ends
        // up broken, real file untouched" guarantee described above —
        // not just "briefly touched then left in a broken state."
        try {
            const mm = await import("music-metadata");
            const verify = await mm.parseFile(tempOutput, { duration: false, skipCovers: false });
            const common = verify.common || {};
            const mismatches = [];
            if (tags.title != null && (common.title || "") !== tags.title) mismatches.push("title");
            if (tags.artist != null && (common.artist || "") !== tags.artist) mismatches.push("artist");
            if (tags.album != null && (common.album || "") !== tags.album) mismatches.push("album");
            if (wantsNewImage && capability.supportsCoverArt && !(common.picture && common.picture.length)) mismatches.push("cover art");
            if (tags.removeImage && common.picture && common.picture.length) mismatches.push("cover art removal");
            if (mismatches.length) {
                await fs.promises.unlink(tempOutput).catch(() => {});
                return { written: false, reason: `FFmpeg ran, but the ${mismatches.join(", ")} didn't actually take in the result. The original file wasn't touched.` };
            }
        } catch (err) {
            await fs.promises.unlink(tempOutput).catch(() => {});
            return { written: false, reason: `Couldn't verify FFmpeg's output before swapping it in, so the original file wasn't touched: ${String((err && err.message) || err)}` };
        }

        await retryOnWindowsLock(() => fs.promises.rename(tempOutput, filePath));
        return imageIgnored ? { written: true, imageIgnored: true } : { written: true };
    } catch (err) {
        await fs.promises.unlink(tempOutput).catch(() => {});
        return { written: false, reason: String((err && err.message) || err) };
    } finally {
        if (tempCoverPath) await fs.promises.unlink(tempCoverPath).catch(() => {});
    }
}

// Just enough of a mime-type -> extension mapping to give the temp
// cover file a plausible name — FFmpeg identifies the actual image
// format from its file contents, not its extension, so this is only
// for readability if anyone ever has to debug a leftover temp file.
function imageExtFromMime(mime) {
    if (mime === "image/png") return ".png";
    if (mime === "image/webp") return ".webp";
    return ".jpg";
}

module.exports = {
    FORMAT_INFO,
    detectFFmpeg,
    installFFmpeg,
    resolveOutputPath,
    convertFile,
    cancelConvertJob,
    writeTagsViaFFmpeg
};
