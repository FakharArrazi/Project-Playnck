// ================================================================
// build-scripts/build.js
// ----------------------------------------------------------------
// `npm run build` runs this instead of calling electron-builder
// directly:
//   1. Backs up every .js file we own (in memory, not on disk).
//   2. Overwrites those files in place with an obfuscated version.
//   3. Runs the real `electron-builder` against the obfuscated source.
//   4. Restores the original source over the top — wrapped in
//      try/finally so this happens even if the build fails partway,
//      and the working copy is never left obfuscated.
//
// Only touches files this project owns; node_modules, package.json,
// index.html/styles.css, and icon.ico are untouched.
// ================================================================

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const JavaScriptObfuscator = require("javascript-obfuscator");

const ROOT = path.join(__dirname, "..");

// Files that run under Node/Electron's main process (require(),
// ipcMain, Node built-ins). Obfuscated with target:"node" so the
// obfuscator doesn't add browser-only tricks (e.g. checks against
// `window`) that don't apply here.
const NODE_FILES = ["main.js", "preload.js", "metadata-bridge.js", "autotag-bridge.js"];

// Files that run in the renderer (loaded via <script> in
// index.html, no direct Node access). Obfuscated with
// target:"browser-no-eval" — same strength, but avoids eval()-based
// tricks that a Content-Security-Policy could otherwise block.
const BROWSER_FILES = ["script.js", "renderer-bridge.js"];

// Toggle: SKIP_OBFUSCATION=1 npm run release
// Publishes with the source completely untouched, to test in
// isolation whether GitHub/antivirus is flagging the .exe because of
// the obfuscated code shape rather than anything else about the
// build. If the .exe survives with this on, obfuscation was the
// trigger; if it still goes missing, look elsewhere (signing, the
// publish step, repo settings).
const SKIP_OBFUSCATION = process.env.SKIP_OBFUSCATION === "1";

// controlFlowFlattening and deadCodeInjection are deliberately off:
// those two make the output *behave* like a packer/dropper under
// static analysis (jump-table-driven control flow, decoy code) —
// exactly what heuristic AV scanners key on, regardless of what the
// code actually does. Renaming + string-array encoding still gives
// real protection against casual reverse engineering without that
// signature. The two flags are left commented below rather than
// deleted in case the stronger profile is worth revisiting — but
// turning them back on reintroduces that AV-flagging risk.
const BASE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,      // was: true
  // controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: false,          // was: true
  // deadCodeInjectionThreshold: 0.3,
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,       // was: 2
  stringArrayWrappersChainedCalls: false, // was: true
  stringArrayWrappersParametersMaxCount: 2, // was: 4
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.5,         // was: 0.75
  transformObjectKeys: true,
  unicodeEscapeSequence: false,

  // Left off on purpose: both are fragile (can break on legitimate
  // users' machines / conflict with devtools) and add little real
  // protection for a desktop app. Also both are classic AV/heuristic
  // red flags on their own — leave these off.
  selfDefending: false,
  debugProtection: false
};

const backups = new Map(); // absolute path -> original source

function obfuscateFile(relPath, target) {
  const filePath = path.join(ROOT, relPath);
  if (!fs.existsSync(filePath)) return;

  const original = fs.readFileSync(filePath, "utf8");
  backups.set(filePath, original);

  if (SKIP_OBFUSCATION) {
    console.log("Skipped obfuscating (SKIP_OBFUSCATION=1):", relPath);
    return; // leave file exactly as-is; still backed up/restored for consistency
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

// Holds an electron-builder failure so it can be re-thrown (still
// failing the npm script/CI step) after the duplicate-release check
// below runs — GitHub's side can end up half-published even on a
// run that exits non-zero, so that check needs to happen regardless.
let buildError = null;

try {
  NODE_FILES.forEach(f => obfuscateFile(f, "node"));
  BROWSER_FILES.forEach(f => obfuscateFile(f, "browser-no-eval"));

  // Forwards any flags this script was called with (e.g. `--publish
  // always` from the "release" npm script) straight through to
  // electron-builder, so publishing still goes through the same
  // obfuscate -> build -> restore wrapper as a normal build.
  const extraArgs = process.argv.slice(2).join(" ");
  execSync(`npx electron-builder ${extraArgs}`.trim(), { stdio: "inherit", cwd: ROOT });
} catch (err) {
  buildError = err;
} finally {
  restoreOriginals();
}

// electron-builder has a known race condition (see
// electron-userland/electron-builder#6676) where publishing several
// artifacts for one version in one run can create TWO GitHub releases
// for the same tag, splitting the installer/.blockmap/latest.yml
// between them. Checking here — after every build, success or
// failure — means `npm run release` always leaves exactly one draft
// with everything attached.
try {
  execSync(`node ${JSON.stringify(path.join(__dirname, "reconcile-github-release.js"))}`, {
    stdio: "inherit",
    cwd: ROOT
  });
} catch (reconcileErr) {
  console.warn("Duplicate-release check failed:", reconcileErr.message);
}

if (buildError) throw buildError;
