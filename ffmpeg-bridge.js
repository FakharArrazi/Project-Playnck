
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFile } = require("child_process");

const FORMAT_INFO = {
    mp3:  { ext: "mp3",  label: "MP3",  lossless: false, supportsCoverArt: true  },
    aac:  { ext: "m4a",  label: "AAC",  lossless: false, supportsCoverArt: true  },
    opus: { ext: "opus", label: "Opus", lossless: false, supportsCoverArt: false },
    flac: { ext: "flac", label: "FLAC", lossless: true,  supportsCoverArt: true  },
    alac: { ext: "m4a",  label: "ALAC", lossless: true,  supportsCoverArt: true  },
    wav:  { ext: "wav",  label: "WAV",  lossless: true,  supportsCoverArt: false }
};


let cached = null;

function tryRunVersion(bin, env) {
    return new Promise((resolve) => {
        execFile(bin, ["-version"], { timeout: 8000, windowsHide: true, env }, (err, stdout) => {
            if (err || !stdout) return resolve({ ok: false });
            const match = /version\s+(\S+)/i.exec(stdout);
            resolve({ ok: true, version: match ? match[1] : "unknown" });
        });
    });
}

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
                const match = /REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(stdout);
                res(match ? match[1].trim() : "");
            });
        }))).then(([machine, user]) => {
            const merged = [machine, user].filter(Boolean).join(";");
            resolve(merged || null);
        });
    });
}

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
            } catch {   }
        }
        const nested = await findFFmpegBinDir(full, depth + 1);
        if (nested) return nested;
    }
    return null;
}

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
        } catch {   }
    }

    return null;
}

async function detectFFmpeg() {
    const found = await findFFmpeg();
    if (!found) return { available: false };
    return { available: true, version: found.version };
}


function installFFmpeg(onLine) {
    return new Promise((resolve) => {
        if (process.platform === "linux") {
            resolve({
                success: false,
                reason: "FFmpeg wasn't found. On Fedora, the official repo's \"ffmpeg-free\" package is missing the MP3 encoder — enable RPM Fusion first: sudo dnf install https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm && sudo dnf install ffmpeg. On other distros, install the \"ffmpeg\" package from your package manager. Reopen the Convert tab once it's installed."
            });
            return;
        }
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

            let tail = "";
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


async function resolveOutputPath(outputDir, baseName, ext, mode) {
    const straightPath = path.join(outputDir, `${baseName}.${ext}`);
    let exists = false;
    try { await fs.promises.access(straightPath, fs.constants.F_OK); exists = true; } catch {   }

    if (!exists) return { path: straightPath, skip: false };
    if (mode === "replace") return { path: straightPath, skip: false };
    if (mode === "skip") return { path: straightPath, skip: true };

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


function buildFFmpegArgs(inputPath, outputPath, format, settings) {
    const info = FORMAT_INFO[format] || FORMAT_INFO.mp3;
    const args = ["-y", "-i", inputPath];

    if (info.supportsCoverArt) args.push("-map", "0:a", "-map", "0:v?", "-c:v", "copy");
    else args.push("-map", "0:a");

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

    args.push("-progress", "pipe:1", "-nostats");
    args.push(outputPath);
    return args;
}

const activeJobs = new Map();

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
            if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
        });

        child.stdout.on("data", (chunk) => {
            stdoutBuf += chunk.toString("utf8");
            const blocks = stdoutBuf.split(/progress=(?:continue|end)\r?\n?/);
            stdoutBuf = blocks.pop() || "";
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
            if (err.code === "ENOENT") cached = null;
            resolve({ success: false, reason: `FFmpeg couldn't start: ${err.message}` });
        });

        child.on("close", (code) => {
            const wasCancelled = !!(activeJobs.get(job.jobId) && activeJobs.get(job.jobId).cancelled);
            activeJobs.delete(job.jobId);

            if (wasCancelled) {
                fs.promises.unlink(job.outputPath).catch(() => {});
                resolve({ success: false, cancelled: true });
                return;
            }
            if (code === 0) {
                if (onProgress) onProgress({ percent: 100 });
                resolve({ success: true, outputPath: job.outputPath });
                return;
            }
            fs.promises.unlink(job.outputPath).catch(() => {});
            const reason = stderrTail.trim().split("\n").filter(Boolean).slice(-3).join(" ") || `FFmpeg exited with code ${code}`;
            resolve({ success: false, reason });
        });
    });
}

function cancelConvertJob(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    job.child.kill();
    return true;
}

const TAG_WRITABLE_EXTS = {
    ".flac": { supportsCoverArt: true },
    ".m4a":  { supportsCoverArt: true },
    ".ogg":  { supportsCoverArt: false },
    ".opus": { supportsCoverArt: false },
    ".wav":  { supportsCoverArt: false }
};

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
    const tempOutput = path.join(dir, `.playnck-tagwrite-${Date.now()}${ext}`);
    let tempCoverPath = null;

    try {
        const args = ["-y", "-i", filePath];

        if (wantsNewImage && capability.supportsCoverArt) {
            tempCoverPath = path.join(os.tmpdir(), `playnck-cover-${Date.now()}${imageExtFromMime(tags.imageMime)}`);
            await fs.promises.writeFile(tempCoverPath, Buffer.from(tags.imageData));
            args.push("-i", tempCoverPath);
        }

        args.push("-map_metadata", "0", "-map", "0:a", "-c:a", "copy");

        if (tags.removeImage) {
        } else if (wantsNewImage && capability.supportsCoverArt) {
            args.push("-map", "1:v", "-disposition:v:0", "attached_pic", "-c:v", "copy");
        } else if (capability.supportsCoverArt) {
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
