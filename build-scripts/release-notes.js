const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function loadChangelog() {
  const file = path.join(ROOT, "script", "whats-new-data.js");
  if (!fs.existsSync(file)) return [];
  try {
    const source = fs
      .readFileSync(file, "utf8")
      .replace(/^\s*export\s*\{[^}]*\};?\s*$/m, "");
    const changelog = vm.runInNewContext(
      `${source}\n;typeof CHANGELOG === "undefined" ? [] : CHANGELOG`,
      {},
      { timeout: 2000 },
    );
    return Array.isArray(changelog) ? changelog : [];
  } catch {
    return [];
  }
}

function buildReleaseNotes(version, assetNames) {
  const entry = loadChangelog().find((e) => e && e.version === version);
  const sections = [];

  if (entry && Array.isArray(entry.highlights) && entry.highlights.length) {
    const bullets = entry.highlights
      .map((line) => `- ${String(line).trim()}`)
      .join("\n");
    sections.push(`## What's new in ${version}\n\n${bullets}`);
  }

  const find = (re) => assetNames.find((name) => re.test(name));
  const rows = [
    ["Windows 10 / 11 (64-bit)", find(/\.exe$/i)],
    ["Fedora, RHEL, openSUSE (.rpm)", find(/\.rpm$/i)],
    ["Ubuntu, Debian (.deb)", find(/\.deb$/i)],
  ]
    .filter(([, file]) => file)
    .map(([platform, file]) => `| ${platform} | \`${file}\` |`);

  if (rows.length) {
    sections.push(
      `## Downloads\n\n| Platform | File |\n| --- | --- |\n${rows.join("\n")}`,
    );
  }

  sections.push(
    "The `latest.yml`, `latest-linux.yml` and `.blockmap` files are read by Playnck's built-in updater; you do not need to download them.",
  );

  return { body: `${sections.join("\n\n")}\n`, hasChangelog: Boolean(entry) };
}

module.exports = { buildReleaseNotes };
