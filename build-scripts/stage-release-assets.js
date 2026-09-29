const fs = require("fs");
const path = require("path");

const INCLUDE_RE = /\.(exe|blockmap|rpm)$/i;
const MANIFEST_RE = /^latest(-[a-z0-9]+)*\.yml$/i;
const isStageable = (name) => INCLUDE_RE.test(name) || MANIFEST_RE.test(name);

function stageReleaseAssets(distDir, outDir) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`${distDir} does not exist — run the build first.`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const staged = [];
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue; // skip win-unpacked/, linux-unpacked/, etc.
    if (!isStageable(entry.name)) continue; // skip builder-debug.yml, builder-effective-config.yaml, etc.
    if (entry.name.endsWith("__uninstaller.exe")) continue;

    fs.copyFileSync(
      path.join(distDir, entry.name),
      path.join(outDir, entry.name),
    );
    staged.push(entry.name);
  }

  if (staged.length === 0) {
    throw new Error(
      `No installer/update files (.exe, .blockmap, .rpm, latest*.yml) found in ${distDir}.`,
    );
  }

  return staged;
}

module.exports = { stageReleaseAssets };

if (require.main === module) {
  const distDir = process.argv[2] || "dist";
  const outDir = process.argv[3] || "release-assets";
  try {
    const staged = stageReleaseAssets(distDir, outDir);
    console.log(`Staged ${staged.length} file(s) into ${outDir}/:`);
    staged.forEach((f) => console.log(`  - ${f}`));
  } catch (err) {
    console.error("stage-release-assets.js failed:", err.message);
    process.exit(1);
  }
}
