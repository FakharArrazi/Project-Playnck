const fs = require("fs");
const path = require("path");
const {
  pkg,
  publishCfg,
  TOKEN,
  gh,
  uploadAsset,
  publishRelease,
} = require("./github-release-utils");

async function findOrCreateRelease(owner, repo, tag) {
  const releases = await gh(
    "GET",
    `/repos/${owner}/${repo}/releases?per_page=100`,
  );
  const existing = releases.find((r) => r.tag_name === tag);
  if (existing) {
    console.log(`Found existing release for ${tag}: ${existing.html_url}`);
    return existing;
  }

  console.log(
    `No release found for ${tag} — creating a new draft (auto-tagging current commit).`,
  );
  return gh("POST", `/repos/${owner}/${repo}/releases`, {
    tag_name: tag,
    name: `${pkg.build.productName || pkg.name} ${pkg.version}`,
    draft: true,
    generate_release_notes: true,
  });
}

const INSTALLER_CATEGORIES = [
  {
    label: "Windows installer",
    match: (name) => /\.exe(\.blockmap)?$/i.test(name),
  },
  { label: "Linux rpm", match: (name) => /\.rpm$/i.test(name) },
];

async function removeStaleInstallers(owner, repo, current, files) {
  const keep = new Set(files);
  for (const { label, match } of INSTALLER_CATEGORIES) {
    if (!files.some(match)) continue;
    for (const asset of current) {
      if (match(asset.name) && !keep.has(asset.name)) {
        console.log(
          `Removing stale ${label} asset from an earlier run: ${asset.name}`,
        );
        await gh(
          "DELETE",
          `/repos/${owner}/${repo}/releases/assets/${asset.id}`,
        );
      }
    }
  }
}

async function uploadAssets(owner, repo, release, assetsDir) {
  const files = fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith("__uninstaller.exe"));

  if (files.length === 0) {
    throw new Error(`No files found in ${assetsDir} — nothing to upload.`);
  }

  const exeFiles = files.filter((name) => name.toLowerCase().endsWith(".exe"));
  if (exeFiles.length > 1) {
    throw new Error(
      `Expected at most one .exe asset, found ${exeFiles.length}: ${exeFiles.join(", ")} — refusing to publish a duplicate installer.`,
    );
  }

  const current = await gh(
    "GET",
    `/repos/${owner}/${repo}/releases/${release.id}/assets?per_page=100`,
  );
  await removeStaleInstallers(owner, repo, current, files);
  const byName = new Map(current.map((a) => [a.name, a]));

  for (const name of files) {
    const filePath = path.join(assetsDir, name);
    const buffer = fs.readFileSync(filePath);

    const existingAsset = byName.get(name);
    if (existingAsset) {
      console.log(`Replacing existing asset ${name}...`);
      await gh(
        "DELETE",
        `/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`,
      );
    } else {
      console.log(`Uploading ${name}...`);
    }
    await uploadAsset(release.upload_url, name, buffer);
  }
}

async function main() {
  const assetsDir = process.argv[2];
  if (!assetsDir) {
    throw new Error(
      "Usage: node build-scripts/publish-release.js <assets-dir>",
    );
  }
  if (!publishCfg) {
    throw new Error(
      "No GitHub publish config in package.json (build.publish) — nothing to do.",
    );
  }
  if (!TOKEN) {
    throw new Error(
      "No GH_TOKEN/GITHUB_TOKEN in env — can't talk to the GitHub API.",
    );
  }

  const owner = publishCfg.owner;
  const repo = publishCfg.repo;
  if (!owner || !repo) {
    throw new Error("Publish config is missing owner/repo.");
  }

  const tag = (publishCfg.vPrefixedTagName === false ? "" : "v") + pkg.version;

  const release = await findOrCreateRelease(owner, repo, tag);
  await uploadAssets(owner, repo, release, assetsDir);
  await publishRelease(owner, repo, release, "Every asset is uploaded");
}

main().catch((err) => {
  console.error("publish-release.js failed:", err.message);
  process.exit(1);
});
