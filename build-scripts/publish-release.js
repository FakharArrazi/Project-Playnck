const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  ROOT,
  pkg,
  publishCfg,
  TOKEN,
  repoInfo,
  tagName,
  gh,
  paginate,
  uploadAsset,
  ASSET_KINDS,
  missingAssetKinds,
  isManagedAsset,
  inspectRemote,
  formatBytes,
  sleep,
} = require("./github-release-utils");
const { verifyUpdateManifests } = require("./verify-update-manifests");
const { buildReleaseNotes } = require("./release-notes");

const args = process.argv.slice(2);
const truthy = (value) => /^(1|true|yes)$/i.test(String(value || ""));
const FORCE = args.includes("--force") || truthy(process.env.FORCE_RELEASE);
const ALLOW_PARTIAL =
  args.includes("--allow-partial") || truthy(process.env.ALLOW_PARTIAL_RELEASE);
const SKIP_PUBLIC_CHECK = truthy(process.env.SKIP_PUBLIC_CHECK);

const isManifest = (name) => /^latest(-[a-z0-9]+)*\.yml$/i.test(name);
const short = (sha) => String(sha).slice(0, 7);

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function guardTagMatchesVersion(tag) {
  if (
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME !== tag
  ) {
    throw new Error(
      `This run was started by tag ${process.env.GITHUB_REF_NAME}, but package.json says ${pkg.version} (expected ${tag}). Refusing to publish a mismatched release.`,
    );
  }
}

function listAssetFiles(assetsDir) {
  return fs
    .readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith("__uninstaller.exe"))
    .sort();
}

function checkAssetSet(files) {
  const problems = [];
  const warnings = [];

  for (const name of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      problems.push(
        `"${name}" contains characters GitHub would rename, which breaks download links.`,
      );
    }
  }

  for (const kind of ASSET_KINDS) {
    const found = files.filter((name) => kind.re.test(name));
    if (found.length === 0) {
      (ALLOW_PARTIAL ? warnings : problems).push(`missing ${kind.label}`);
    } else if (kind.exactlyOne && found.length > 1) {
      problems.push(
        `expected one ${kind.label}, found ${found.length}: ${found.join(", ")}`,
      );
    }
  }
  return { problems, warnings };
}

function isCompletePublished(release) {
  const uploaded = (release.assets || [])
    .filter((asset) => asset.state === "uploaded")
    .map((asset) => asset.name);
  return missingAssetKinds(uploaded).length === 0;
}

async function ensureTag(owner, repo, tag, sha, state) {
  if (!state.tagCommit) {
    console.log(`Creating tag ${tag} at ${short(sha)}.`);
    await gh("POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/tags/${tag}`,
      sha,
    });
    return;
  }
  if (state.tagCommit === sha) {
    console.log(`Tag ${tag} already points at ${short(sha)}.`);
    return;
  }
  if (state.published.length && !FORCE) {
    throw new Error(
      `${tag} is already published and points at ${short(state.tagCommit)}, but this run built ${short(sha)}. ` +
        `Re-run with "force" to move the tag and replace the assets, or bump the version.`,
    );
  }
  console.log(
    `Tag ${tag} points at ${short(state.tagCommit)} - an older commit than the one being released (${short(sha)}) and nothing published depends on it. Moving it.`,
  );
  await gh("PATCH", `/repos/${owner}/${repo}/git/refs/tags/${tag}`, {
    sha,
    force: true,
  });
}

async function pickRelease(owner, repo, tag, sha, files, state) {
  const byAssetCount = (a, b) =>
    (b.assets || []).length - (a.assets || []).length;
  const all = [...state.published, ...state.drafts];
  const keeper = state.published.length
    ? [...state.published].sort(byAssetCount)[0]
    : [...state.drafts].sort(byAssetCount)[0];

  for (const extra of all.filter((r) => keeper && r.id !== keeper.id)) {
    console.log(
      `Deleting duplicate ${extra.draft ? "draft" : "published"} release ${extra.id} for ${tag}.`,
    );
    await gh("DELETE", `/repos/${owner}/${repo}/releases/${extra.id}`);
  }

  const notes = buildReleaseNotes(pkg.version, files);
  if (!notes.hasChangelog) {
    console.warn(
      `Warning: script/whats-new-data.js has no entry for ${pkg.version}; the release notes will only list downloads plus GitHub's generated changes.`,
    );
  }

  if (!keeper) {
    console.log(`Creating release ${pkg.version} (as a draft until every file is uploaded).`);
    const payload = {
      tag_name: tag,
      target_commitish: sha,
      name: pkg.version,
      body: notes.body,
      draft: true,
      prerelease: false,
    };
    if (!notes.hasChangelog) payload.generate_release_notes = true;
    return gh("POST", `/repos/${owner}/${repo}/releases`, payload);
  }

  console.log(
    `Reusing existing ${keeper.draft ? "draft" : "published"} release: ${keeper.html_url}`,
  );
  const patch = {};
  if (keeper.draft) patch.name = pkg.version;
  if (!keeper.body || !keeper.body.trim()) patch.body = notes.body;
  if (Object.keys(patch).length) {
    return gh("PATCH", `/repos/${owner}/${repo}/releases/${keeper.id}`, patch);
  }
  return keeper;
}

async function syncAssets(owner, repo, release, assetsDir, files) {
  const current = await paginate(
    `/repos/${owner}/${repo}/releases/${release.id}/assets`,
  );
  const keep = new Set(files);

  for (const asset of current) {
    if (keep.has(asset.name) || !isManagedAsset(asset.name)) continue;
    const kind = ASSET_KINDS.find((k) => k.re.test(asset.name));
    if (kind && !files.some((name) => kind.re.test(name))) continue;
    console.log(`Removing stale asset from an earlier attempt: ${asset.name}`);
    await gh("DELETE", `/repos/${owner}/${repo}/releases/assets/${asset.id}`);
  }

  const ordered = [
    ...files.filter((name) => !isManifest(name)),
    ...files.filter(isManifest),
  ];
  const byName = new Map(current.map((asset) => [asset.name, asset]));

  for (const name of ordered) {
    const existing = byName.get(name);
    if (existing) {
      console.log(`Replacing existing asset ${name}...`);
      await gh(
        "DELETE",
        `/repos/${owner}/${repo}/releases/assets/${existing.id}`,
      );
    }
    const buffer = fs.readFileSync(path.join(assetsDir, name));
    console.log(`Uploading ${name} (${formatBytes(buffer.length)})...`);
    await uploadAsset(release, name, buffer);
  }
}

async function publishDraft(owner, repo, release) {
  if (!release.draft) {
    console.log("Release is already published; leaving its state alone.");
    return;
  }
  const attempts = 4;
  for (let i = 1; ; i++) {
    try {
      await gh("PATCH", `/repos/${owner}/${repo}/releases/${release.id}`, {
        draft: false,
        prerelease: false,
        make_latest: "true",
      });
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`Publish attempt ${i} failed (${err.message}); retrying...`);
      await sleep(5000);
    }
  }
}

async function verifyPublished(owner, repo, release, files) {
  const final = await gh(
    "GET",
    `/repos/${owner}/${repo}/releases/${release.id}`,
  );
  if (final.draft) {
    throw new Error(`${final.html_url} is still a draft after publishing.`);
  }
  const assets = await paginate(
    `/repos/${owner}/${repo}/releases/${release.id}/assets`,
  );
  const missing = files.filter(
    (name) => !assets.some((a) => a.name === name && a.state === "uploaded"),
  );
  if (missing.length) {
    throw new Error(
      `Published, but these files are not available on the release: ${missing.join(", ")}`,
    );
  }
  return { release: final, assets };
}

async function checkPublicManifests(release, files) {
  if (SKIP_PUBLIC_CHECK) return;
  const base = release.html_url.replace("/releases/tag/", "/releases/download/");
  for (const name of files.filter(isManifest)) {
    let ok = false;
    let lastProblem = "";
    for (let i = 1; i <= 6 && !ok; i++) {
      try {
        const res = await fetch(`${base}/${name}`);
        const text = res.ok ? await res.text() : "";
        if (res.ok && new RegExp(`^version:\\s*${pkg.version}\\s*$`, "m").test(text)) {
          ok = true;
        } else {
          lastProblem = res.ok ? "wrong version inside" : `HTTP ${res.status}`;
        }
      } catch (err) {
        lastProblem = err.message;
      }
      if (!ok) await sleep(5000);
    }
    if (ok) console.log(`Public download check OK: ${name}`);
    else console.warn(`Warning: could not confirm ${base}/${name} yet (${lastProblem}).`);
  }
}

function writeStepSummary(release, assets) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const rows = assets
    .filter((a) => isManagedAsset(a.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => `| [${a.name}](${a.browser_download_url}) | ${formatBytes(a.size)} |`);
  const md = `## Released ${pkg.version}\n\n${release.html_url}\n\n| File | Size |\n| --- | --- |\n${rows.join("\n")}\n`;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

async function main() {
  const assetsDir = args.find((arg) => !arg.startsWith("--"));
  if (!assetsDir) {
    throw new Error(
      "Usage: node build-scripts/publish-release.js <assets-dir> [--force] [--allow-partial]",
    );
  }
  if (!publishCfg) {
    throw new Error("No GitHub publish config in package.json (build.publish).");
  }
  if (!TOKEN) {
    throw new Error("No GH_TOKEN/GITHUB_TOKEN available - can't talk to the GitHub API.");
  }

  const { owner, repo } = repoInfo();
  const tag = tagName();
  const sha = currentCommit();
  guardTagMatchesVersion(tag);

  const files = listAssetFiles(assetsDir);
  if (files.length === 0) {
    throw new Error(`No files found in ${assetsDir} - nothing to publish.`);
  }

  const set = checkAssetSet(files);
  const manifests = await verifyUpdateManifests(assetsDir, pkg.version);
  const problems = [...set.problems, ...manifests.problems];
  [...set.warnings, ...manifests.warnings].forEach((w) => console.warn(`Warning: ${w}`));
  if (problems.length) {
    throw new Error(
      `Refusing to publish a release that would be broken:\n  - ${problems.join("\n  - ")}`,
    );
  }
  console.log(
    `Checked ${files.length} files for ${tag}: every manifest entry matches its file's name, size and sha512.`,
  );

  const state = await inspectRemote(owner, repo, tag);
  const complete = state.published.find(isCompletePublished);
  if (complete && !FORCE) {
    console.log(
      `${tag} is already published with every download: ${complete.html_url}\nNothing to do. Run again with "force" to replace its files.`,
    );
    return;
  }
  if (state.published.length && !complete) {
    console.warn(
      `A published release for ${tag} exists but is missing downloads - repairing it.`,
    );
  }

  await ensureTag(owner, repo, tag, sha, state);
  const release = await pickRelease(owner, repo, tag, sha, files, state);
  await syncAssets(owner, repo, release, assetsDir, files);
  await publishDraft(owner, repo, release);

  const { release: final, assets } = await verifyPublished(owner, repo, release, files);
  await checkPublicManifests(final, files);
  writeStepSummary(final, assets);

  console.log(`\nPublished ${pkg.version}: ${final.html_url}`);
  for (const asset of assets.filter((a) => isManagedAsset(a.name))) {
    console.log(`  ${asset.name}  ${formatBytes(asset.size)}`);
  }
}

main().catch((err) => {
  console.error("publish-release.js failed:", err.message);
  process.exit(1);
});
