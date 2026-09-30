const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));

const publishEntries = Array.isArray(pkg.build && pkg.build.publish)
  ? pkg.build.publish
  : [pkg.build && pkg.build.publish].filter(Boolean);

const publishCfg = publishEntries.find((p) => p && p.provider === "github");

const API = (process.env.GITHUB_API_URL || "https://api.github.com").replace(
  /\/+$/,
  "",
);

const TOKEN_FILE = path.join(ROOT, "github token.txt");

// Notepad and Windows PowerShell like to save text as UTF-8 with a BOM or as
// UTF-16, so decode by BOM instead of assuming plain UTF-8.
function decodeTextFile(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer).swap16().toString("utf16le");
  }
  return buffer.toString("utf8");
}

function parseTokenText(text) {
  const t = String(text || "")
    .replace(/^\uFEFF/, "")
    .trim();
  const known = t.match(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)/);
  if (known) return known[1];
  const keyValue = t.match(/^[A-Za-z_ ]*[=:]\s*(\S+)\s*$/m);
  if (keyValue) return keyValue[1];
  return t.split(/\s+/)[0] || "";
}

function resolveToken() {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  try {
    const token = parseTokenText(decodeTextFile(fs.readFileSync(TOKEN_FILE)));
    if (token) return token;
  } catch {}

  try {
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    if (out && out.trim()) return out.trim();
  } catch {}

  return "";
}

const TOKEN = resolveToken();

function repoInfo() {
  const fromEnv = (process.env.GITHUB_REPOSITORY || "").split("/");
  if (fromEnv.length === 2 && fromEnv[0] && fromEnv[1]) {
    return { owner: fromEnv[0], repo: fromEnv[1] };
  }
  if (!publishCfg || !publishCfg.owner || !publishCfg.repo) {
    throw new Error("package.json build.publish is missing owner/repo.");
  }
  return { owner: publishCfg.owner, repo: publishCfg.repo };
}

function tagName() {
  const prefix = publishCfg && publishCfg.vPrefixedTagName === false ? "" : "v";
  return prefix + pkg.version;
}

function headers(extra) {
  return {
    "User-Agent": "playnck-release-script",
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GitHubError extends Error {
  constructor(method, urlPath, status, body) {
    super(`${method} ${urlPath} -> ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

async function gh(method, urlPath, body, options = {}) {
  const attempts = options.attempts || 4;
  for (let i = 1; ; i++) {
    let res;
    try {
      res = await fetch(`${API}${urlPath}`, {
        method,
        headers: headers(body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(1000 * 2 ** (i - 1));
      continue;
    }

    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 404 && options.allow404) return null;

    const retryable =
      res.status >= 500 ||
      res.status === 429 ||
      (res.status === 403 && res.headers.get("retry-after"));
    if (retryable && i < attempts) {
      const wait = Number(res.headers.get("retry-after")) * 1000;
      await sleep(wait > 0 ? Math.min(wait, 60000) : 1000 * 2 ** (i - 1));
      continue;
    }
    throw new GitHubError(method, urlPath, res.status, await res.text());
  }
}

async function paginate(urlPath, maxPages = 5) {
  const joiner = urlPath.includes("?") ? "&" : "?";
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const items = await gh("GET", `${urlPath}${joiner}per_page=100&page=${page}`);
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

async function uploadAsset(release, name, buffer) {
  const uploadUrl = release.upload_url.replace(
    /\{\?name,label\}$/,
    `?name=${encodeURIComponent(name)}`,
  );
  const attempts = 3;
  let lastError;

  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: headers({ "Content-Type": "application/octet-stream" }),
        body: buffer,
      });
      if (!res.ok) {
        throw new Error(`upload ${name} -> ${res.status}: ${await res.text()}`);
      }
      const asset = await res.json();
      if (asset.name !== name) {
        throw new Error(
          `GitHub stored "${name}" as "${asset.name}", so any update manifest pointing at "${name}" would 404. Use file names without spaces or special characters.`,
        );
      }
      if (asset.size !== buffer.length || asset.state !== "uploaded") {
        throw new Error(
          `${name} did not upload completely (state ${asset.state}, ${asset.size} of ${buffer.length} bytes).`,
        );
      }
      return asset;
    } catch (err) {
      lastError = err;
      if (i === attempts || /stored ".*" as/.test(err.message)) break;
      console.log(`  upload of ${name} failed (${err.message}); retrying...`);
      await removeAssetsNamed(release, name);
      await sleep(3000 * i);
    }
  }
  await removeAssetsNamed(release, name).catch(() => {});
  throw lastError;
}

async function removeAssetsNamed(release, name) {
  const { owner, repo } = repoInfo();
  const assets = await paginate(
    `/repos/${owner}/${repo}/releases/${release.id}/assets`,
  );
  for (const asset of assets.filter((a) => a.name === name)) {
    await gh("DELETE", `/repos/${owner}/${repo}/releases/assets/${asset.id}`);
  }
}

const ASSET_KINDS = [
  { label: "Windows installer (.exe)", re: /\.exe$/i, exactlyOne: true },
  { label: "Windows blockmap", re: /\.exe\.blockmap$/i, exactlyOne: true },
  { label: "Fedora/RHEL/openSUSE package (.rpm)", re: /\.rpm$/i, exactlyOne: true },
  { label: "Ubuntu/Debian package (.deb)", re: /\.deb$/i, exactlyOne: true },
  { label: "latest.yml (Windows updater)", re: /^latest\.yml$/i },
  { label: "latest-linux.yml (Linux updater)", re: /^latest-linux\.yml$/i },
];

function missingAssetKinds(names) {
  return ASSET_KINDS.filter((kind) => !names.some((n) => kind.re.test(n))).map(
    (kind) => kind.label,
  );
}

const isManagedAsset = (name) =>
  /\.(exe|blockmap|rpm|deb)$/i.test(name) ||
  /^latest(-[a-z0-9]+)*\.yml$/i.test(name) ||
  name === "builder-debug.yml";

async function resolveTagCommit(owner, repo, tag) {
  const ref = await gh(
    "GET",
    `/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
    undefined,
    { allow404: true, attempts: 2 },
  );
  if (!ref) return null;

  let object = ref.object;
  for (let i = 0; i < 3 && object && object.type === "tag"; i++) {
    const annotated = await gh(
      "GET",
      `/repos/${owner}/${repo}/git/tags/${object.sha}`,
    );
    object = annotated.object;
  }
  return object && object.type === "commit" ? object.sha : null;
}

async function inspectRemote(owner, repo, tag) {
  const releases = (await paginate(`/repos/${owner}/${repo}/releases`)).filter(
    (r) => r.tag_name === tag,
  );
  return {
    published: releases.filter((r) => !r.draft),
    drafts: releases.filter((r) => r.draft),
    tagCommit: await resolveTagCommit(owner, repo, tag),
  };
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

module.exports = {
  parseTokenText,
  decodeTextFile,
  ROOT,
  API,
  pkg,
  publishCfg,
  TOKEN,
  TOKEN_FILE,
  repoInfo,
  tagName,
  headers,
  sleep,
  gh,
  paginate,
  uploadAsset,
  removeAssetsNamed,
  ASSET_KINDS,
  missingAssetKinds,
  isManagedAsset,
  inspectRemote,
  formatBytes,
};
