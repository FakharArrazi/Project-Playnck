const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = path.join(__dirname, "..");

const NODE_FILES = [
  "main.js",
  "preload.js",
  "metadata-bridge.js",
  "autotag-bridge.js",
  "ffmpeg-bridge.js",
];

const BROWSER_FILES = [
  "script.js",
  "renderer-bridge.js",
  "player-marquee.js",
  "theme-boot.js",
  "script/state.js",
  "script/utils.js",
  "script/i18n.js",
  "script/init.js",
  "script/metadata.js",
  "script/drag-drop.js",
  "script/library-view.js",
  "script/folders.js",
  "script/menus.js",
  "script/convert.js",
  "script/playlists.js",
  "script/playlist-folders.js",
  "script/queue.js",
  "script/crossfade.js",
  "script/equalizer.js",
  "script/visualizer.js",
  "script/player.js",
  "script/now-playing-ui.js",
  "script/volume.js",
  "script/lyrics.js",
  "script/modal.js",
  "script/side-menu.js",
  "script/metadata-edit.js",
  "script/theme.js",
  "script/settings.js",
  "script/backup.js",
  "script/sleep-timer.js",
  "script/bindings.js",
  "script/history.js",
  "script/whats-new.js",
  "script/whats-new-data.js",
];

const SKIP_OBFUSCATION = process.env.SKIP_OBFUSCATION === "1";

const BASE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: false,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.5,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,

  selfDefending: false,
  debugProtection: false,
};

const backups = new Map();

function obfuscateFile(relPath, target) {
  const filePath = path.join(ROOT, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(
      "Obfuscation list entry does not resolve to a file, skipping:",
      relPath,
    );
    return;
  }

  const original = fs.readFileSync(filePath, "utf8");
  backups.set(filePath, original);

  if (SKIP_OBFUSCATION) {
    console.log("Skipped obfuscating (SKIP_OBFUSCATION=1):", relPath);
    return;
  }

  const result = JavaScriptObfuscator.obfuscate(original, {
    ...BASE_OPTIONS,
    target,
  });
  fs.writeFileSync(filePath, result.getObfuscatedCode(), "utf8");
  console.log("Obfuscated:", relPath);
}

function restoreOriginals() {
  for (const [filePath, original] of backups) {
    fs.writeFileSync(filePath, original, "utf8");
  }
  if (backups.size) console.log("Restored original source files.");
}

let buildError = null;

try {
  NODE_FILES.forEach((f) => obfuscateFile(f, "node"));
  BROWSER_FILES.forEach((f) => obfuscateFile(f, "browser-no-eval"));

  const extraArgs = process.argv.slice(2).join(" ");
  execSync(`npx electron-builder ${extraArgs}`.trim(), {
    stdio: "inherit",
    cwd: ROOT,
  });
} catch (err) {
  buildError = err;
} finally {
  restoreOriginals();
}

try {
  execSync(
    `node ${JSON.stringify(path.join(__dirname, "reconcile-github-release.js"))}`,
    {
      stdio: "inherit",
      cwd: ROOT,
    },
  );
} catch (reconcileErr) {
  console.warn("Duplicate-release check failed:", reconcileErr.message);
}

if (buildError) throw buildError;
