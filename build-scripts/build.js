
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = path.join(__dirname, "..");

const NODE_FILES = ["main.js", "preload.js", "metadata-bridge.js", "autotag-bridge.js"];

const BROWSER_FILES = ["script.js", "renderer-bridge.js", "state.js", "utils.js", "i18n.js",
  "init.js", "metadata.js", "drag-drop.js", "library-view.js", "folders.js", "menus.js",
  "convert.js", "playlists.js", "queue.js", "crossfade.js", "equalizer.js", "visualizer.js",
  "player.js", "now-playing-ui.js", "volume.js", "lyrics.js", "modal.js", "side-menu.js",
  "metadata-edit.js", "theme.js", "settings.js", "backup.js", "sleep-timer.js", "bindings.js"];

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
  debugProtection: false
};

const backups = new Map();

function obfuscateFile(relPath, target) {
  const filePath = path.join(ROOT, relPath);
  if (!fs.existsSync(filePath)) return;

  const original = fs.readFileSync(filePath, "utf8");
  backups.set(filePath, original);

  if (SKIP_OBFUSCATION) {
    console.log("Skipped obfuscating (SKIP_OBFUSCATION=1):", relPath);
    return;
  }

  const result = JavaScriptObfuscator.obfuscate(original, { ...BASE_OPTIONS, target });
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
  NODE_FILES.forEach(f => obfuscateFile(f, "node"));
  BROWSER_FILES.forEach(f => obfuscateFile(f, "browser-no-eval"));

  const extraArgs = process.argv.slice(2).join(" ");
  execSync(`npx electron-builder ${extraArgs}`.trim(), { stdio: "inherit", cwd: ROOT });
} catch (err) {
  buildError = err;
} finally {
  restoreOriginals();
}

try {
  execSync(`node ${JSON.stringify(path.join(__dirname, "reconcile-github-release.js"))}`, {
    stdio: "inherit",
    cwd: ROOT
  });
} catch (reconcileErr) {
  console.warn("Duplicate-release check failed:", reconcileErr.message);
}

if (buildError) throw buildError;
