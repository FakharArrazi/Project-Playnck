
const fs = require("fs");
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

async function uploadAsset(uploadUrlTemplate, name, buffer) {
    const uploadUrl = uploadUrlTemplate.replace("{?name,label}", `?name=${encodeURIComponent(name)}`);
    const res = await fetch(uploadUrl, {
        method: "POST",
        headers: headers({ "Content-Type": "application/octet-stream" }),
        body: buffer
    });
    if (!res.ok) throw new Error(`upload ${name} -> ${res.status}: ${await res.text()}`);
}

async function findOrCreateRelease(owner, repo, tag) {
    const releases = await gh("GET", `/repos/${owner}/${repo}/releases?per_page=100`);
    const existing = releases.find(r => r.tag_name === tag);
    if (existing) {
        console.log(`Found existing release for ${tag}: ${existing.html_url}`);
        return existing;
    }

    console.log(`No release found for ${tag} — creating a new draft (auto-tagging current commit).`);
    return gh("POST", `/repos/${owner}/${repo}/releases`, {
        tag_name: tag,
        name: `${pkg.build.productName || pkg.name} ${pkg.version}`,
        draft: true,
        generate_release_notes: true
    });
}

async function uploadAssets(owner, repo, release, assetsDir) {
    const files = fs.readdirSync(assetsDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name);

    if (files.length === 0) {
        throw new Error(`No files found in ${assetsDir} — nothing to upload.`);
    }

    const current = await gh("GET", `/repos/${owner}/${repo}/releases/${release.id}/assets?per_page=100`);
    const byName = new Map(current.map(a => [a.name, a]));

    for (const name of files) {
        const filePath = path.join(assetsDir, name);
        const buffer = fs.readFileSync(filePath);

        const existingAsset = byName.get(name);
        if (existingAsset) {
            console.log(`Replacing existing asset ${name}...`);
            await gh("DELETE", `/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`);
        } else {
            console.log(`Uploading ${name}...`);
        }
        await uploadAsset(release.upload_url, name, buffer);
    }
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
                console.warn(`Every asset is uploaded — publish it manually from: ${release.html_url}`);
                return;
            }
            console.log(`Publish attempt ${i} failed, retrying in 5s... (${err.message})`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function main() {
    const assetsDir = process.argv[2];
    if (!assetsDir) {
        throw new Error("Usage: node build-scripts/publish-release.js <assets-dir>");
    }
    if (!publishCfg) {
        throw new Error("No GitHub publish config in package.json (build.publish) — nothing to do.");
    }
    if (!TOKEN) {
        throw new Error("No GH_TOKEN/GITHUB_TOKEN in env — can't talk to the GitHub API.");
    }

    const owner = publishCfg.owner;
    const repo = publishCfg.repo;
    if (!owner || !repo) {
        throw new Error("Publish config is missing owner/repo.");
    }

    const tag = (publishCfg.vPrefixedTagName === false ? "" : "v") + pkg.version;

    const release = await findOrCreateRelease(owner, repo, tag);
    await uploadAssets(owner, repo, release, assetsDir);
    await publishRelease(owner, repo, release);
}

main().catch(err => {
    console.error("publish-release.js failed:", err.message);
    process.exit(1);
});
