const { contextBridge, ipcRenderer, webUtils } = require("electron");

if (process.platform === "win32") {
    window.addEventListener("DOMContentLoaded", () => {
        document.documentElement.classList.add("native-titlebar-enabled");
    });
}

contextBridge.exposeInMainWorld("electronAPI", {
    onOpenFile: (callback) => {
        ipcRenderer.on("open-file", (event, filePath) => {
            callback(filePath);
        });
    },

    // Resolves a real absolute path for a File picked via <input
    // type=file> or drag/drop. Must run here in preload (not main) —
    // webUtils.getPathForFile only works on the File object itself,
    // which can't cross the IPC boundary. Returns null for Files that
    // aren't backed by a real file on disk (e.g. reconstructed from
    // raw bytes) — script.js treats "" the same as null.
    getPathForFile: (file) => {
        try { return webUtils.getPathForFile(file); }
        catch { return null; }
    },

    // Accurate bitrate + tag reading/writing (see metadata-bridge.js
    // in the main process for the implementation).
    // filePath -> Promise<{bitrate, codec, sampleRate, lossless, container, duration, fileSize, mimeType} | null>
    getAudioMetadata: (filePath) => ipcRenderer.invoke("get-audio-metadata", filePath),
    // (filePath, {title, artist, album, imageData, imageMime, removeImage}) -> Promise<{written, reason?}>
    writeAudioTags: (filePath, tags) => ipcRenderer.invoke("write-audio-tags", filePath, tags),

    // Auto-tag: identifies a track and returns matched tags plus
    // cover art if any was found (see autotag-bridge.js). Ambiguous
    // lookups (a fingerprint or text search that plausibly matches
    // more than one recording) come back as several ranked `matches`
    // entries — each with its own title/artist/album/year/trackNum
    // and cover-art `images` — for the Edit modal's "which one is
    // it?" picker. `title`/`artist`/.../`images` at the top level
    // just mirror matches[0], kept for callers that don't care about
    // the alternatives.
    // mode: "fingerprint" (audio only), "text" (title/artist search
    // only), or omitted for the combined "try fingerprint, fall back
    // to text" behavior — see the two separate Auto-tag buttons in
    // the Edit modal (script.js).
    // (filePath, {title, artist}, mode?) ->
    //   Promise<{
    //     found, source?, title?, artist?, album?, year?, trackNum?,
    //     image?, images?, matches?: Array<{source, title, artist, album, year, trackNum, images}>,
    //     reason?
    //   }>
    autoTagTrack: (filePath, hint, mode) => ipcRenderer.invoke("auto-tag-track", filePath, hint, mode),

    // Batch existence check for real paths on disk (files or
    // directories). Used by verifyLibraryOnDisk() to prune tracks/
    // folders that were moved or deleted outside the app, and by
    // handleMissingTrack() to confirm a playback failure was really a
    // missing file before touching the library.
    // paths:string[] -> Promise<{[path]: boolean}>
    checkPathsExist: (paths) => ipcRenderer.invoke("check-paths-exist", paths),

    // Recursively lists every audio file currently inside folderPath.
    // Used by rescanFolders() to pick up songs dropped into an
    // already-added folder from outside the app.
    // folderPath:string -> Promise<string[]>
    scanFolder: (folderPath) => ipcRenderer.invoke("scan-folder", folderPath),

    // Moves the real file on disk to the OS Recycle Bin / Trash.
    // Used by "Delete track"/"Delete folder" so those actions remove
    // the file itself, not just the library entry.
    // filePath -> Promise<{trashed, reason?}>
    trashFile: (filePath) => ipcRenderer.invoke("trash-file", filePath),

    // Renames the real file on disk to match an edited title/artist
    // (extension and folder are kept as-is). Used by the Edit modal's
    // Save button alongside writeAudioTags.
    // (filePath, desiredBaseName) -> Promise<{renamed, newPath?, reason?}>
    renameFile: (filePath, desiredBaseName) => ipcRenderer.invoke("rename-file", filePath, desiredBaseName),

    // Generic native Save/Open dialogs for text content the renderer
    // already owns — used by the Settings > Backup & Restore library
    // backup (JSON) and by a playlist's "Export as .m3u" (see
    // exportLibraryBackup()/importLibraryBackup()/exportPlaylistAsM3U()
    // in script.js). Kept generic rather than backup-specific since
    // both features need exactly the same "write this string to a
    // file the user picks" / "read a string back from a file the user
    // picks" shape.
    // (defaultName, content, filterName, filterExts) -> Promise<{saved:true, filePath} | {saved:false, reason?}>
    saveTextFile: (defaultName, content, filterName, filterExts) =>
        ipcRenderer.invoke("save-text-file", defaultName, content, filterName, filterExts),
    // (filterName, filterExts) -> Promise<{content, filePath} | null>
    openTextFile: (filterName, filterExts) =>
        ipcRenderer.invoke("open-text-file", filterName, filterExts),

    // Settings > Updates. Fires whenever main.js's autoUpdater reports
    // something new (checking/found/downloading/ready/up-to-date/error)
    // — see wireUpdateEvents() in main.js.
    onUpdateStatus: (callback) => {
        ipcRenderer.on("update-status", (event, payload) => callback(payload));
    },

    // Kicks off a fresh update check on demand (the "Check for
    // Updates" / "Try Again" button). Progress still arrives via
    // onUpdateStatus above, not through this call's return value.
    // -> Promise<{started:true} | {started:false, reason}>
    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),

    // Installs an already-downloaded update now instead of waiting
    // for the app to quit normally. Only meaningful once onUpdateStatus
    // has reported state:"downloaded".
    installUpdateNow: () => ipcRenderer.invoke("install-update-now"),

    // -> Promise<string> — running app's version, for the "you're up
    // to date (vX.X.X)" label.
    getAppVersion: () => ipcRenderer.invoke("get-app-version"),

    setTitleBarAppearance: (backgroundColor, symbolColor) =>
        ipcRenderer.invoke("set-title-bar-appearance", backgroundColor, symbolColor)
});
