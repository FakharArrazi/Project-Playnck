
const path = require("path");

const ID3_WRITABLE_EXTS = new Set([".mp3"]);

const EXT_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4"
};

async function getAudioMetadata(filePath) {
    if (!filePath) return null;

    const fs = require("fs");

    const mm = await import("music-metadata");
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: false });
    const fmt = meta.format || {};
    const common = meta.common || {};

    let fileSize = null;
    try {
        fileSize = fs.statSync(filePath).size;
    } catch (err) {
        console.error("getAudioMetadata: couldn't stat file for size:", err);
    }

    return {
        bitrate: fmt.bitrate ? Math.round(fmt.bitrate / 1000) : null,
        codec: fmt.codec || null,
        sampleRate: fmt.sampleRate || null,
        lossless: !!fmt.lossless,
        container: fmt.container || null,
        duration: fmt.duration || null,
        fileSize,
        mimeType: EXT_MIME_TYPES[path.extname(filePath).toLowerCase()] || null,
        trackNum: (common.track && common.track.no != null) ? common.track.no : null,
        title: common.title || null,
        artist: common.artist || null,
        album: common.album || null,
        picture: (common.picture && common.picture.length)
            ? { data: Buffer.from(common.picture[0].data), format: common.picture[0].format || "image/jpeg" }
            : null
    };
}

async function writeAudioTags(filePath, tags) {
    if (!filePath) return { written: false, reason: "This track's file location isn't known (it may have been imported from a different device)." };

    const ext = path.extname(filePath).toLowerCase();

    if (!ID3_WRITABLE_EXTS.has(ext)) {
        const label = ext ? ext.slice(1).toUpperCase() : "this file type";
        return {
            written: false,
            reason: `Writing tags directly to ${label} files isn't supported yet — only .mp3. Your library copy is still updated.`
        };
    }

    const NodeID3 = require("node-id3");

    const id3Tags = {};
    if (tags.title != null) id3Tags.title = tags.title;
    if (tags.artist != null) id3Tags.artist = tags.artist;
    if (tags.album != null) id3Tags.album = tags.album;

    if (tags.removeImage) {
        id3Tags.image = "";
    } else if (tags.imageData) {
        id3Tags.image = {
            mime: tags.imageMime || "image/jpeg",
            type: { id: 3, name: "front cover" },
            description: "cover",
            imageBuffer: Buffer.from(tags.imageData)
        };
    }

    let ok = null;
    const lockCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
    for (let attempt = 0; attempt < 5; attempt++) {
        ok = NodeID3.update(id3Tags, filePath);
        if (ok === true) break;
        const code = ok instanceof Error ? ok.code : null;
        if (attempt === 4 || !lockCodes.has(code)) break;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }

    if (ok !== true) {
        const detail = ok instanceof Error ? (ok.message || String(ok)) : null;
        return {
            written: false,
            reason: detail
                ? `Couldn't write to the file: ${detail}`
                : "node-id3 wasn't able to write to this file (it may be read-only or locked by another program)."
        };
    }

    try {
        const verify = NodeID3.read(filePath);
        const mismatches = [];
        if (tags.title != null && (verify.title || "") !== tags.title) mismatches.push("title");
        if (tags.artist != null && (verify.artist || "") !== tags.artist) mismatches.push("artist");
        if (tags.album != null && (verify.album || "") !== tags.album) mismatches.push("album");
        if (tags.imageData && !verify.image) mismatches.push("cover art");
        if (tags.removeImage && verify.image) mismatches.push("cover art removal");
        if (mismatches.length) {
            return { written: false, reason: `Wrote to the file, but reading it back shows the ${mismatches.join(", ")} didn't actually stick.` };
        }
    } catch (err) {
        return { written: false, reason: `Wrote to the file, but couldn't verify it afterward: ${String((err && err.message) || err)}` };
    }

    return { written: true };
}

module.exports = { getAudioMetadata, writeAudioTags };
