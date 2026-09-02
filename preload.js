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

    getPathForFile: (file) => {
        try { return webUtils.getPathForFile(file); }
        catch { return null; }
    },

    getAudioMetadata: (filePath) => ipcRenderer.invoke("get-audio-metadata", filePath),
    writeAudioTags: (filePath, tags) => ipcRenderer.invoke("write-audio-tags", filePath, tags),

    autoTagTrack: (filePath, hint, mode) => ipcRenderer.invoke("auto-tag-track", filePath, hint, mode),

    checkPathsExist: (paths) => ipcRenderer.invoke("check-paths-exist", paths),

    scanFolder: (folderPath) => ipcRenderer.invoke("scan-folder", folderPath),

    trashFile: (filePath) => ipcRenderer.invoke("trash-file", filePath),

    renameFile: (filePath, desiredBaseName) => ipcRenderer.invoke("rename-file", filePath, desiredBaseName),

    saveTextFile: (defaultName, content, filterName, filterExts) =>
        ipcRenderer.invoke("save-text-file", defaultName, content, filterName, filterExts),
    openTextFile: (filterName, filterExts) =>
        ipcRenderer.invoke("open-text-file", filterName, filterExts),

    onUpdateStatus: (callback) => {
        ipcRenderer.on("update-status", (event, payload) => callback(payload));
    },

    checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),

    installUpdateNow: () => ipcRenderer.invoke("install-update-now"),

    getAppVersion: () => ipcRenderer.invoke("get-app-version"),

    setTitleBarAppearance: (backgroundColor, symbolColor) =>
        ipcRenderer.invoke("set-title-bar-appearance", backgroundColor, symbolColor),


    selectFolder: (defaultPath) => ipcRenderer.invoke("select-folder", defaultPath),
    openFolder: (folderPath) => ipcRenderer.invoke("open-folder", folderPath),
    getDefaultConvertOutput: () => ipcRenderer.invoke("get-default-convert-output"),

    ffmpegDetect: () => ipcRenderer.invoke("ffmpeg-detect"),
    ffmpegInstall: () => ipcRenderer.invoke("ffmpeg-install"),
    onFFmpegInstallProgress: (callback) => {
        ipcRenderer.on("ffmpeg-install-progress", (event, payload) => callback(payload));
    },

    convertResolveOutputPath: (outputDir, baseName, ext, mode) =>
        ipcRenderer.invoke("convert-resolve-output-path", outputDir, baseName, ext, mode),
    convertFile: (job) => ipcRenderer.invoke("convert-file", job),
    onConvertProgress: (callback) => {
        ipcRenderer.on("convert-progress", (event, payload) => callback(payload));
    },
    convertCancel: (jobId) => ipcRenderer.invoke("convert-cancel", jobId)
});
