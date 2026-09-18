const {
  pkg,
  publishCfg,
  TOKEN,
  headers,
  gh,
  uploadAsset,
  publishRelease,
} = require("./github-release-utils");

async function downloadAsset(assetApiUrl) {
  const res = await fetch(assetApiUrl, {
    headers: headers({ Accept: "application/octet-stream" }),
  });
  if (!res.ok) throw new Error(`download ${assetApiUrl} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  if (!publishCfg) {
    console.log(
      "No GitHub publish config in package.json — skipping duplicate-release check.",
    );
    return;
  }
  if (!TOKEN) {
    console.log(
      "No GH_TOKEN/GITHUB_TOKEN in env — skipping duplicate-release check.",
    );
    return;
  }

  const owner = publishCfg.owner;
  const repo = publishCfg.repo;
  if (!owner || !repo) {
    console.log(
      "Publish config is missing owner/repo — skipping duplicate-release check.",
    );
    return;
  }

  const tag = (publishCfg.vPrefixedTagName === false ? "" : "v") + pkg.version;

  const releases = await gh(
    "GET",
    `/repos/${owner}/${repo}/releases?per_page=100`,
  );
  const matches = releases.filter((r) => r.tag_name === tag);

  if (matches.length === 0) {
    console.log(
      `Release check: no release found yet for ${tag} — nothing to publish.`,
    );
    return;
  }

  if (matches.length === 1) {
    console.log(
      `Release check: exactly one release found for ${tag} — no merge needed.`,
    );
  } else {
    console.log(
      `Release check: found ${matches.length} releases tagged ${tag} — merging into one.`,
    );
  }

  matches.sort((a, b) => b.assets.length - a.assets.length);
  const keeper = matches[0];
  const extras = matches.slice(1);
  const existingNames = new Set(keeper.assets.map((a) => a.name));

  for (const extra of extras) {
    for (const asset of extra.assets) {
      if (existingNames.has(asset.name)) {
        console.log(
          `  ${asset.name} already present on kept release — skipping.`,
        );
        continue;
      }
      console.log(`  moving ${asset.name} onto release ${keeper.id}...`);
      const buffer = await downloadAsset(asset.url);
      await uploadAsset(keeper.upload_url, asset.name, buffer);
      existingNames.add(asset.name);
    }
    console.log(`  deleting duplicate release ${extra.id} (${extra.html_url})`);
    await gh("DELETE", `/repos/${owner}/${repo}/releases/${extra.id}`);
  }

  console.log(
    `Release check: ${keeper.html_url} now has every asset for ${tag}.`,
  );
  await publishRelease(
    owner,
    repo,
    keeper,
    "The release is uploaded and ready",
  );
}

main().catch((err) => {
  console.error("reconcile-github-release.js failed:", err.message);
  process.exit(1);
});
