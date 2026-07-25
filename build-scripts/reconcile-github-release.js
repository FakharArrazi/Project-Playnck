// ================================================================
// build-scripts/reconcile-github-release.js
// ----------------------------------------------------------------
// Works around a known electron-builder bug where publishing several
// artifacts for one version in one run can create TWO separate GitHub
// releases for the same tag, splitting the installer, .blockmap, and
// latest.yml between them.
// See: https://github.com/electron-userland/electron-builder/issues/6676
//
// Run automatically at the end of `npm run release` (build.js calls
// this after electron-builder, whether or not electron-builder itself
// reported success — GitHub's side can end up split even on a run
// that exits non-zero).
//
// What it does:
//   1. Lists releases in the configured GitHub repo.
//   2. Finds every release whose tag matches the current
//      package.json version.
//   3. If there's more than one, treats the one with the most assets
//      as the keeper, copies over any assets missing from it, then
//      deletes the extra release(s).
//
// Requires GH_TOKEN or GITHUB_TOKEN in the environment — the same
// token electron-builder uses to publish. Without a token, or
// without a GitHub publish config, this is a no-op (no network calls
// made), so it's safe to leave wired into a plain `npm run build`.
// ================================================================

const path = require("path");
const pkg = require(path.join(__dirname, "..", "package.json"));

const publishEntries = Array.isArray(pkg.build && pkg.build.publish)
    ? pkg.build.publish
    : [pkg.build && pkg.build.publish].filter(Boolean);

const publishCfg = publishEntries.find(p => p && p.provider === "github");

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const API = "https://api.github.com";

function headers(extra) {
    return {
        "User-Agent": "playnck-release-script",
        "Authorization": `Bearer ${TOKEN}`,
        "Accept": "application/vnd.github+json",
        ...extra
    };
}

async function gh(method, urlPath, body) {
    const res = await fetch(`${API}${urlPath}`, {
        method,
        headers: headers(body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
        throw new Error(`${method} ${urlPath} -> ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : res.json();
}

async function downloadAsset(assetApiUrl) {
    const res = await fetch(assetApiUrl, { headers: headers({ Accept: "application/octet-stream" }) });
    if (!res.ok) throw new Error(`download ${assetApiUrl} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function uploadAsset(uploadUrlTemplate, name, buffer) {
    // upload_url looks like ".../releases/12345/assets{?name,label}"
    const uploadUrl = uploadUrlTemplate.replace("{?name,label}", `?name=${encodeURIComponent(name)}`);
    const res = await fetch(uploadUrl, {
        method: "POST",
        headers: headers({ "Content-Type": "application/octet-stream" }),
        body: buffer
    });
    if (!res.ok) throw new Error(`upload ${name} -> ${res.status}: ${await res.text()}`);
}

async function main() {
    if (!publishCfg) {
        console.log("No GitHub publish config in package.json — skipping duplicate-release check.");
        return;
    }
    if (!TOKEN) {
        console.log("No GH_TOKEN/GITHUB_TOKEN in env — skipping duplicate-release check.");
        return;
    }

    const owner = publishCfg.owner;
    const repo = publishCfg.repo;
    if (!owner || !repo) {
        console.log("Publish config is missing owner/repo — skipping duplicate-release check.");
        return;
    }

    const tag = (publishCfg.vPrefixedTagName === false ? "" : "v") + pkg.version;

    const releases = await gh("GET", `/repos/${owner}/${repo}/releases?per_page=100`);
    const matches = releases.filter(r => r.tag_name === tag);

    if (matches.length === 0) {
        console.log(`Release check: no release found yet for ${tag} — nothing to publish.`);
        return;
    }

    if (matches.length === 1) {
        console.log(`Release check: exactly one release found for ${tag} — no merge needed.`);
    } else {
        console.log(`Release check: found ${matches.length} releases tagged ${tag} — merging into one.`);
    }

    matches.sort((a, b) => b.assets.length - a.assets.length);
    const keeper = matches[0];
    const extras = matches.slice(1);
    const existingNames = new Set(keeper.assets.map(a => a.name));

    for (const extra of extras) {
        for (const asset of extra.assets) {
            if (existingNames.has(asset.name)) {
                console.log(`  ${asset.name} already present on kept release — skipping.`);
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

    console.log(`Release check: ${keeper.html_url} now has every asset for ${tag}.`);
    await publishRelease(owner, repo, keeper);
}

// Flips a draft release to published. Safer than asking GitHub to
// create a release as published from scratch (which produced the
// original 422 "Published releases must have a valid tag" error) —
// by this point the tag has existed for a while and every asset is
// attached, so GitHub has had time to settle it. Still retries a
// couple of times with a short delay since that error has been
// reported to be intermittent even here.
async function publishRelease(owner, repo, release) {
    if (release.draft === false) {
        console.log(`Release ${release.html_url} is already published.`);
        return;
    }

    const attempts = 3;
    for (let i = 1; i <= attempts; i++) {
        try {
            const published = await gh("PATCH", `/repos/${owner}/${repo}/releases/${release.id}`, { draft: false });
            console.log(`Published: ${published.html_url}`);
            return;
        } catch (err) {
            if (i === attempts) {
                console.warn(`Could not auto-publish after ${attempts} attempts (${err.message}).`);
                console.warn(`The release is uploaded and ready — publish it manually from: ${release.html_url}`);
                return;
            }
            console.log(`Publish attempt ${i} failed, retrying in 5s... (${err.message})`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

main().catch(err => {
    console.error("reconcile-github-release.js failed:", err.message);
    process.exit(1);
});
