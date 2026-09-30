const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST_RE = /^latest(-[a-z0-9]+)*\.yml$/i;

function unquote(value) {
  return String(value)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
}

function parseManifest(text) {
  const files = [];
  const entryRe =
    /^\s*-\s+url:\s*(.+?)\s*\r?\n\s+sha512:\s*(.+?)\s*\r?\n\s+size:\s*(\d+)/gm;
  let match;
  while ((match = entryRe.exec(text))) {
    files.push({
      url: unquote(match[1]),
      sha512: unquote(match[2]),
      size: Number(match[3]),
    });
  }
  const versionMatch = /^version:\s*(.+?)\s*$/m.exec(text);
  const pathMatch = /^path:\s*(.+?)\s*$/m.exec(text);
  return {
    version: versionMatch ? unquote(versionMatch[1]) : null,
    path: pathMatch ? unquote(pathMatch[1]) : null,
    files,
  };
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512");
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("base64")));
  });
}

function looseKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function verifyUpdateManifests(assetsDir, expectedVersion) {
  const problems = [];
  const warnings = [];

  const names = fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith("__uninstaller.exe"));
  const nameSet = new Set(names);

  if (names.some((n) => /\.exe$/i.test(n)) && !nameSet.has("latest.yml")) {
    problems.push(
      "A Windows installer is present but latest.yml is missing, so installed apps could never find this update.",
    );
  }
  if (
    names.some((n) => /\.(rpm|deb)$/i.test(n)) &&
    !nameSet.has("latest-linux.yml")
  ) {
    problems.push(
      "A Linux package (.rpm/.deb) is present but latest-linux.yml is missing, so installed apps could never find this update.",
    );
  }

  const listedInManifests = new Set();

  for (const manifestName of names.filter((n) => MANIFEST_RE.test(n))) {
    const manifest = parseManifest(
      fs.readFileSync(path.join(assetsDir, manifestName), "utf8"),
    );

    if (!manifest.files.length) {
      problems.push(`${manifestName}: no file entries could be read from it.`);
      continue;
    }
    if (expectedVersion && manifest.version !== expectedVersion) {
      problems.push(
        `${manifestName}: says version ${manifest.version} but package.json is ${expectedVersion} (stale build output?).`,
      );
    }

    const referenced = new Set(manifest.files.map((f) => f.url));
    if (manifest.path) referenced.add(manifest.path);
    referenced.forEach((url) => listedInManifests.add(url));

    for (const url of referenced) {
      if (/\s/.test(url)) {
        problems.push(
          `${manifestName}: "${url}" contains whitespace. GitHub renames such assets, so the download URL would 404.`,
        );
      }
      if (!nameSet.has(url)) {
        const near = names.find((n) => looseKey(n) === looseKey(url));
        problems.push(
          `${manifestName} points to "${url}" but no asset has exactly that name.` +
            (near ? ` The file being uploaded is called "${near}".` : ""),
        );
      }
    }

    for (const file of manifest.files) {
      if (!nameSet.has(file.url)) continue;
      const filePath = path.join(assetsDir, file.url);
      const actualSize = fs.statSync(filePath).size;
      if (actualSize !== file.size) {
        problems.push(
          `${manifestName}: "${file.url}" is ${actualSize} bytes but the manifest says ${file.size}.`,
        );
        continue;
      }
      const actualHash = await sha512Base64(filePath);
      if (actualHash !== file.sha512) {
        problems.push(
          `${manifestName}: sha512 of "${file.url}" doesn't match the manifest (the updater would reject the download).`,
        );
      }
      if (/\.exe$/i.test(file.url) && !nameSet.has(`${file.url}.blockmap`)) {
        warnings.push(
          `${file.url}.blockmap is missing; updates will still work but can't use differential download.`,
        );
      }
    }
  }

  for (const name of names.filter((n) => /\.(exe|rpm|deb)$/i.test(n))) {
    if (!listedInManifests.has(name)) {
      problems.push(
        `${name} is not listed in any update manifest, so the updater would never offer it.`,
      );
    }
  }

  return { problems, warnings };
}

module.exports = { verifyUpdateManifests, parseManifest };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error(
      "Usage: node build-scripts/verify-update-manifests.js <assets-dir> [expected-version]",
    );
    process.exit(2);
  }
  verifyUpdateManifests(dir, process.argv[3])
    .then(({ problems, warnings }) => {
      warnings.forEach((w) => console.warn(`Warning: ${w}`));
      if (problems.length) {
        console.error("Update manifest check FAILED:");
        problems.forEach((p) => console.error(`  - ${p}`));
        process.exit(1);
      }
      console.log("Update manifests OK.");
    })
    .catch((err) => {
      console.error("verify-update-manifests.js failed:", err.message);
      process.exit(1);
    });
}
