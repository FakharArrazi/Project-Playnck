const path = require("path");
const pkg = require(path.join(__dirname, "..", "package.json"));

const publishEntries = Array.isArray(pkg.build && pkg.build.publish)
  ? pkg.build.publish
  : [pkg.build && pkg.build.publish].filter(Boolean);

const publishCfg = publishEntries.find((p) => p && p.provider === "github");

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const API = "https://api.github.com";

function headers(extra) {
  return {
    "User-Agent": "playnck-release-script",
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    ...extra,
  };
}

async function gh(method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: headers(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(
      `${method} ${urlPath} -> ${res.status}: ${await res.text()}`,
    );
  }
  return res.status === 204 ? null : res.json();
}

async function uploadAsset(uploadUrlTemplate, name, buffer) {
  const uploadUrl = uploadUrlTemplate.replace(
    "{?name,label}",
    `?name=${encodeURIComponent(name)}`,
  );
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: headers({ "Content-Type": "application/octet-stream" }),
    body: buffer,
  });
  if (!res.ok)
    throw new Error(`upload ${name} -> ${res.status}: ${await res.text()}`);
}

async function publishRelease(owner, repo, release, readyPhrase) {
  if (release.draft === false) {
    console.log(`Release ${release.html_url} is already published.`);
    return;
  }

  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      const published = await gh(
        "PATCH",
        `/repos/${owner}/${repo}/releases/${release.id}`,
        { draft: false },
      );
      console.log(`Published: ${published.html_url}`);
      return;
    } catch (err) {
      if (i === attempts) {
        console.warn(
          `Could not auto-publish after ${attempts} attempts (${err.message}).`,
        );
        console.warn(
          `${readyPhrase} — publish it manually from: ${release.html_url}`,
        );
        return;
      }
      console.log(
        `Publish attempt ${i} failed, retrying in 5s... (${err.message})`,
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

module.exports = {
  pkg,
  publishCfg,
  TOKEN,
  headers,
  gh,
  uploadAsset,
  publishRelease,
};
