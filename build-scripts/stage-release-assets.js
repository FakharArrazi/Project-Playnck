const fs = require("fs");
const path = require("path");

const INCLUDE_RE = /\.(exe|blockmap|rpm|deb)$/i;
const MANIFEST_RE = /^latest(-[a-z0-9]+)*\.yml$/i;
const isStageable = (name) => INCLUDE_RE.test(name) || MANIFEST_RE.test(name);

// What a build on each platform must have produced, so a run that silently
// lost a file fails here instead of shipping a half-empty release.
const PLATFORM_REQUIREMENTS = {
  windows: [
    { label: "one Windows installer (.exe)", re: /\.exe$/i, count: 1 },
    { label: "one .exe.blockmap", re: /\.exe\.blockmap$/i, count: 1 },
    { label: "latest.yml", re: /^latest\.yml$/i, count: 1 },
  ],
  linux: [
    { label: "one .rpm package", re: /\.rpm$/i, count: 1 },
    { label: "one .deb package", re: /\.deb$/i, count: 1 },
    { label: "latest-linux.yml", re: /^latest-linux\.yml$/i, count: 1 },
  ],
};

function stageReleaseAssets(distDir, outDir, platform) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`${distDir} does not exist - run the build first.`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const staged = [];
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue; // skip win-unpacked/, linux-unpacked/, etc.
    if (!isStageable(entry.name)) continue; // skip builder-debug.yml, etc.
    if (entry.name.endsWith("__uninstaller.exe")) continue;

    fs.copyFileSync(
      path.join(distDir, entry.name),
      path.join(outDir, entry.name),
    );
    staged.push(entry.name);
  }

  if (staged.length === 0) {
    throw new Error(
      `No installer/update files (.exe, .blockmap, .rpm, .deb, latest*.yml) found in ${distDir}.`,
    );
  }

  if (platform) {
    const requirements = PLATFORM_REQUIREMENTS[platform];
    if (!requirements) {
      throw new Error(
        `Unknown platform "${platform}" (use ${Object.keys(PLATFORM_REQUIREMENTS).join(" or ")}).`,
      );
    }
    const problems = [];
    for (const { label, re, count } of requirements) {
      const found = staged.filter((name) => re.test(name));
      if (found.length !== count) {
        problems.push(
          `expected ${label}, found ${found.length}${found.length ? `: ${found.join(", ")}` : ""}`,
        );
      }
    }
    if (problems.length) {
      throw new Error(
        `The ${platform} build did not produce the expected files:\n  - ${problems.join("\n  - ")}`,
      );
    }
  }

  return staged;
}

module.exports = { stageReleaseAssets };

if (require.main === module) {
  const args = process.argv.slice(2);
  const platformFlag = args.indexOf("--platform");
  const platform = platformFlag === -1 ? null : args[platformFlag + 1];
  const positional = args.filter(
    (arg, i) =>
      arg !== "--platform" && !(platformFlag !== -1 && i === platformFlag + 1),
  );
  const distDir = positional[0] || "dist";
  const outDir = positional[1] || "release-assets";
  try {
    const staged = stageReleaseAssets(distDir, outDir, platform);
    console.log(`Staged ${staged.length} file(s) into ${outDir}/:`);
    staged.forEach((f) => console.log(`  - ${f}`));
  } catch (err) {
    console.error("stage-release-assets.js failed:", err.message);
    process.exit(1);
  }
}
