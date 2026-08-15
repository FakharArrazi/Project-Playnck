// ================================================================
// metadata-bridge.js — Electron MAIN PROCESS module
// ----------------------------------------------------------------
// Getting an accurate bitrate reading (real encoded stream info, not
// a size/duration estimate) and writing edited tags back into the
// real .mp3 file on disk — kept separate from main.js so it's easy
// to drop entirely if this project is ever built without Electron.
// Non-.mp3 tag writing (FLAC/M4A/OGG/Opus/WAV) lives in
// ffmpeg-bridge.js instead — see write-audio-tags in main.js for how
// the two are dispatched between.
//
// Two functions are exported and wired up to IPC in main.js:
//   getAudioMetadata(filePath) -> { bitrate, codec, sampleRate,
//                                   lossless, container, duration,
//                                   fileSize, mimeType }
//   writeAudioTags(filePath, tags) -> { written: boolean, reason? }
//
// Dependencies:
//   "music-metadata" — reading, works for basically every audio
//                       container. ESM-only, so it's loaded here
//                       with a dynamic import() even though this
//                       file itself is CommonJS.
//   "node-id3"        — writing, .mp3 (ID3v2) only.
// ================================================================

const path = require("path");

// Extensions this file's writeAudioTags() actually knows how to
// write to — just .mp3. Everything else Playnck can play is handled
// by ffmpeg-bridge.js's writeTagsViaFFmpeg() instead once FFmpeg is
// installed (see write-audio-tags in main.js for the dispatch).
const ID3_WRITABLE_EXTS = new Set([".mp3"]);

// Extension -> MIME type, for the Info modal's "File type" row.
// Deliberately a plain lookup rather than trusting music-metadata's
// `format.container` (a human label like "MPEG", not a MIME string)
// or the browser File object's `.type` (path-backed tracks never
// have one). Kept in sync with ID3_WRITABLE_EXTS and
// fileAssociations in package.json.
const EXT_MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4"
};

// Reads real encoded-stream info out of an audio file — the actual
// bitrate the encoder used (not size÷duration), whether it's VBR,
// sample rate, codec, container — plus the real file size straight
// off disk. Works for mp3/flac/ogg/wav/m4a/etc.
//
// fileSize/mimeType exist specifically so the Info modal can upgrade
// its "File size"/"File type" rows for path-backed tracks the same
// way it already upgrades "Bitrate" — those tracks never carry a
// fileBlob (see hydrateTrack()/loadLibrary() in script.js), so there
// is no File object to read .size/.type off of in the renderer.
async function getAudioMetadata(filePath) {
    if (!filePath) return null;

    const fs = require("fs");

    // music-metadata is ESM-only (v8+), so it's imported dynamically
    // here rather than with require() — this works fine from a
    // CommonJS file, import() just returns a Promise either way.
    //
    // skipCovers is deliberately false (not the performance-friendly
    // default you'd want for a bitrate-only read): this function's
    // return value now also feeds ingestDiscoveredPaths() in
    // script.js, which needs the embedded picture to carry cover art
    // over for songs picked up by rescanFolders() — see the `picture`
    // field below. Every other caller (the Info modal,
    // backfillTrackNumbers()) just ignores that field, so the small
    // extra parse cost is paid by all callers but only actually used
    // by the rescan path.
    const mm = await import("music-metadata");
    const meta = await mm.parseFile(filePath, { duration: true, skipCovers: false });
    const fmt = meta.format || {};
    const common = meta.common || {};

    let fileSize = null;
    try {
        fileSize = fs.statSync(filePath).size;
    } catch (err) {
        // File may have moved/been deleted since the track was added —
        // leave fileSize null and let the UI keep showing "Unknown"
        // rather than throwing and losing the bitrate reading too.
        console.error("getAudioMetadata: couldn't stat file for size:", err);
    }

    return {
        bitrate: fmt.bitrate ? Math.round(fmt.bitrate / 1000) : null, // kbps
        codec: fmt.codec || null,
        sampleRate: fmt.sampleRate || null,
        lossless: !!fmt.lossless,
        container: fmt.container || null,
        duration: fmt.duration || null,
        fileSize,
        mimeType: EXT_MIME_TYPES[path.extname(filePath).toLowerCase()] || null,
        // music-metadata reports track number as {no, of} (mirrors the
        // ID3/MP4 "track N of M" convention) across every container it
        // supports — mp3, m4a, flac, ogg, wav — so this one field covers
        // the whole library instead of needing a per-format parser in
        // the renderer. null when the file has no track-number tag at all.
        trackNum: (common.track && common.track.no != null) ? common.track.no : null,
        // title/artist/album/picture: added for rescanFolders()'s
        // auto-import path in script.js (see main.js's scan-folder
        // handler). A file discovered by walking a folder on disk has
        // no browser File object to read tags from with jsmediatags
        // the way ingestFiles() normally does for a manually picked
        // file, so the renderer asks for these here instead — off the
        // exact same music-metadata parse this function already did
        // for bitrate/codec/trackNum above, no second pass over the
        // file needed. Every other existing caller (the Info modal,
        // backfillTrackNumbers()) just ignores the extra fields.
        title: common.title || null,
        artist: common.artist || null,
        album: common.album || null,
        picture: (common.picture && common.picture.length)
            ? { data: Buffer.from(common.picture[0].data), format: common.picture[0].format || "image/jpeg" }
            : null
    };
}

// Writes new title/artist/album/cover directly into the file on
// disk via ID3v2 (.mp3 only — node-id3 doesn't understand any other
// container). main.js's write-audio-tags handler is what actually
// decides which writer a given file gets: this one for .mp3, or
// ffmpeg-bridge.js's writeTagsViaFFmpeg() (FLAC/M4A/OGG/Opus/WAV,
// once FFmpeg is installed) for everything else it can. This
// function itself still returns written:false with a plain-English
// reason for any extension it doesn't recognize, as a defensive
// fallback in case it's ever called directly.
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
        // node-id3: an empty string clears the embedded APIC (cover art) frame.
        id3Tags.image = "";
    } else if (tags.imageData) {
        id3Tags.image = {
            mime: tags.imageMime || "image/jpeg",
            type: { id: 3, name: "front cover" },
            description: "cover",
            imageBuffer: Buffer.from(tags.imageData)
        };
    }

    const ok = NodeID3.update(id3Tags, filePath);
    if (!ok) return { written: false, reason: "node-id3 wasn't able to write to this file (it may be read-only or locked by another program)." };

    return { written: true };
}

module.exports = { getAudioMetadata, writeAudioTags };
