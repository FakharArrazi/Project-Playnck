
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
