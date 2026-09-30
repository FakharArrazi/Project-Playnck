// `npm run release` - one command that ships the version in package.json.
//
// A Windows .exe and Linux .rpm/.deb packages can't all be built on one
// machine, so this starts the "Release" workflow on GitHub (a Windows runner
// and a Linux runner build in parallel), waits for it, then checks that the
// published release has every download.
//
//   npm run release                   release the current version
//   npm run release -- --dry-run      run every check, start nothing
//   npm run release -- --force        replace the files of an already
//                                     published version
//   npm run release -- --no-wait      start the build and return immediately
const { execFileSync } = require("child_process");
const {
  ROOT,
  pkg,
  publishCfg,
  TOKEN,
  repoInfo,
  tagName,
  gh,
  sleep,
  missingAssetKinds,
  inspectRemote,
  formatBytes,
  isManagedAsset,
} = require("./github-release-utils");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY_RUN = args.includes("--dry-run");
const NO_WAIT = args.includes("--no-wait");
const WORKFLOW_FILE = "release.yml";
const TIMEOUT_MS =
  Number(process.env.RELEASE_TIMEOUT_MINUTES || 60) * 60 * 1000;

const log = (message = "") => console.log(message);
const short = (sha) => String(sha).slice(0, 7);

function git(...gitArgs) {
  return execFileSync("git", gitArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(...gitArgs) {
  try {
    return git(...gitArgs);
  } catch {
    return null;
  }
}

function elapsed(since) {
  const total = Math.round((Date.now() - since) / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function uploadedNames(release) {
  return (release.assets || [])
    .filter((asset) => asset.state === "uploaded")
    .map((asset) => asset.name);
}

function nextPatch(version) {
  return version.replace(/(\d+)$/, (n) => String(Number(n) + 1));
}

function tokenHelp() {
  return [
    "No GitHub token found. `npm run release` needs one to start the build on GitHub.",
    "",
    "Create a token at https://github.com/settings/tokens (a classic token with the",
    '"repo" scope, or a fine-grained one with Contents + Actions read & write), then',
    "use ONE of these:",
    '  - save it in a file called "github token.txt" in the project folder',
    "    (it is already in .gitignore, so it will never be committed),",
    "  - set the GH_TOKEN environment variable, or",
    "  - sign in with the GitHub CLI: gh auth login",
  ].join("\n");
}

async function preflight(owner, repo, tag) {
  const problems = [];
  const notes = [];
  const info = {};

  info.branch = tryGit("symbolic-ref", "--short", "-q", "HEAD");
  info.sha = tryGit("rev-parse", "HEAD");
  info.subject = tryGit("log", "-1", "--format=%s") || "";

  if (!info.sha) {
    problems.push("This folder isn't a git repository with a commit yet.");
    return { problems, notes, info };
  }
  if (!info.branch) {
    problems.push(
      "You are on a detached HEAD. Check out your release branch (for example: git checkout main).",
    );
  }

  const dirty = tryGit("status", "--porcelain", "--untracked-files=no");
  if (dirty) {
    const lines = dirty.split("\n");
    problems.push(
      "You have uncommitted changes to tracked files. GitHub builds what is committed and pushed,\n" +
        "    so these would NOT be in the release:\n      " +
        lines.slice(0, 10).join("\n      ") +
        (lines.length > 10 ? `\n      ...and ${lines.length - 10} more` : "") +
        "\n    Commit and push them first.",
    );
  }

  if (info.branch) {
    const remote = await gh(
      "GET",
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(info.branch)}`,
      undefined,
      { allow404: true },
    );
    if (!remote) {
      problems.push(
        `Branch "${info.branch}" isn't on GitHub yet. Push it first: git push -u origin ${info.branch}`,
      );
    } else if (remote.commit.sha !== info.sha) {
      let relation = null;
      try {
        relation = await gh(
          "GET",
          `/repos/${owner}/${repo}/compare/${remote.commit.sha}...${info.sha}`,
          undefined,
          { allow404: true, attempts: 2 },
        );
      } catch {}
      if (!relation || relation.status === "ahead") {
        problems.push(
          `Your latest commit (${short(info.sha)}) isn't on GitHub yet, so it can't be built.\n    Push it first: git push`,
        );
      } else if (relation.status === "behind") {
        problems.push(
          `GitHub's "${info.branch}" has ${relation.behind_by} newer commit(s) than yours.\n    Run: git pull   (then run this again)`,
        );
      } else {
        problems.push(
          `Your "${info.branch}" and GitHub's have diverged. Sort that out (git pull / git push) first.`,
        );
      }
    }
  }

  const workflow = tryGit("show", `HEAD:.github/workflows/${WORKFLOW_FILE}`);
  if (workflow === null) {
    problems.push(
      `.github/workflows/${WORKFLOW_FILE} isn't committed. Commit and push it first.`,
    );
  } else if (!/^\s*workflow_dispatch\s*:/m.test(workflow)) {
    problems.push(
      `.github/workflows/${WORKFLOW_FILE} has no "workflow_dispatch" trigger, so it can't be started from here.`,
    );
  }

  const state = await inspectRemote(owner, repo, tag);
  info.state = state;
  const complete = state.published.find(
    (r) => missingAssetKinds(uploadedNames(r)).length === 0,
  );

  if (complete && !FORCE) {
    problems.push(
      `${tag} is already published with every download:\n    ${complete.html_url}\n` +
        `    For a new release, raise "version" in package.json (for example to ${nextPatch(pkg.version)}), commit, push, and run this again.\n` +
        `    To replace the files of ${tag} anyway: npm run release -- --force`,
    );
  } else if (complete) {
    notes.push(
      `${tag} is already published; --force will replace its files with a fresh build.`,
    );
  } else if (state.published.length) {
    const missing = missingAssetKinds(uploadedNames(state.published[0]));
    if (state.tagCommit && state.tagCommit !== info.sha && !FORCE) {
      problems.push(
        `${tag} is published but incomplete (missing: ${missing.join(", ") || "n/a"}), and its tag points at\n` +
          `    ${short(state.tagCommit)}, not your commit ${short(info.sha)}. Run: npm run release -- --force`,
      );
    } else {
      notes.push(
        `The published ${tag} release is missing: ${missing.join(", ")}. It will be repaired.`,
      );
    }
  }

  if (!state.published.length) {
    if (state.tagCommit && state.tagCommit !== info.sha) {
      notes.push(
        `Tag ${tag} already exists on GitHub at ${short(state.tagCommit)} (an older commit) but was never published - it will be moved to ${short(info.sha)}.`,
      );
    }
    if (state.drafts.length) {
      notes.push(
        `${state.drafts.length} leftover draft release(s) for ${tag} will be reused/cleaned up.`,
      );
    }
  }

  return { problems, notes, info };
}

async function listRuns(owner, repo, branch) {
  const data = await gh(
    "GET",
    `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch)}&per_page=20`,
  );
  return (data && data.workflow_runs) || [];
}

async function dispatch(owner, repo, branch) {
  const body = { ref: branch };
  if (FORCE) body.inputs = { force: "true" };
  try {
    await gh(
      "POST",
      `/repos/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      body,
    );
  } catch (err) {
    if (err.status === 404) {
      throw new Error(
        `GitHub can't find the ${WORKFLOW_FILE} workflow, or your token can't see this repository.\n` +
          "  Make sure the workflow is pushed, and that your token has the repo scope (classic)\n" +
          "  or Contents + Actions read & write (fine-grained).",
      );
    }
    if (err.status === 403) {
      throw new Error(
        "Your token isn't allowed to start workflows. Use a classic token with the repo scope,\n" +
          "  or a fine-grained token with Actions: read & write.\n" +
          `  (Or start it by hand: https://github.com/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE} > Run workflow.)`,
      );
    }
    if (err.status === 422) {
      throw new Error(
        `GitHub refused to start the workflow (${err.body}).\n  Push the latest .github/workflows/${WORKFLOW_FILE} to "${branch}" and try again.`,
      );
    }
    throw err;
  }
}

async function findNewRun(owner, repo, branch, sha, knownIds) {
  const deadline = Date.now() + 2 * 60 * 1000;
  while (Date.now() < deadline) {
    const runs = await listRuns(owner, repo, branch);
    const fresh = runs
      .filter((run) => !knownIds.has(run.id) && run.head_sha === sha)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (fresh) return fresh;
    await sleep(3000);
  }
  throw new Error(
    `The workflow was started but its run didn't show up. Check https://github.com/${owner}/${repo}/actions`,
  );
}

function describeJob(job) {
  if (job.status === "completed") return job.conclusion;
  if (job.status === "in_progress") {
    const step = (job.steps || []).find((s) => s.status === "in_progress");
    return step ? `running - ${step.name}` : "running";
  }
  return job.status === "queued" ? "queued" : job.status;
}

async function waitForRun(owner, repo, runId, startedAt) {
  const seen = new Map();
  let lastBeat = Date.now();

  for (;;) {
    const run = await gh("GET", `/repos/${owner}/${repo}/actions/runs/${runId}`);
    const data = await gh(
      "GET",
      `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=30`,
    );
    const jobs = (data && data.jobs) || [];

    let changed = false;
    for (const job of jobs) {
      const label = describeJob(job);
      if (seen.get(job.name) !== label) {
        seen.set(job.name, label);
        log(`  [${elapsed(startedAt)}] ${job.name}: ${label}`);
        changed = true;
      }
    }
    if (changed) lastBeat = Date.now();
    else if (Date.now() - lastBeat > 60 * 1000) {
      log(`  [${elapsed(startedAt)}] still working...`);
      lastBeat = Date.now();
    }

    if (run.status === "completed") return { run, jobs };
    if (Date.now() - startedAt > TIMEOUT_MS) {
      throw new Error(
        `Gave up waiting after ${Math.round(TIMEOUT_MS / 60000)} minutes. The build may still be running: ${run.html_url}`,
      );
    }
    await sleep(Number(process.env.RELEASE_POLL_MS) || 10000);
  }
}

function explainFailure(run, jobs) {
  log("");
  for (const job of jobs.filter((j) => j.conclusion && j.conclusion !== "success" && j.conclusion !== "skipped")) {
    const step = (job.steps || []).find(
      (s) => s.conclusion && s.conclusion !== "success" && s.conclusion !== "skipped",
    );
    log(`  ${job.name}: ${job.conclusion}${step ? ` (step: ${step.name})` : ""}`);
  }
  throw new Error(
    `The build on GitHub did not succeed (${run.conclusion}). Nothing was published. Open the log to see why:\n  ${run.html_url}`,
  );
}

async function confirmPublished(owner, repo, tag) {
  const release = await gh(
    "GET",
    `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    undefined,
    { allow404: true },
  );
  if (!release || release.draft) {
    throw new Error(
      `The build finished, but ${tag} isn't published. Check the "publish" job in the run log.`,
    );
  }
  const missing = missingAssetKinds(uploadedNames(release));
  if (missing.length) {
    throw new Error(`${tag} is published but is missing: ${missing.join(", ")}`);
  }

  const base = release.html_url.replace("/releases/tag/", "/releases/download/");
  const manifests = release.assets.map((a) => a.name).filter((n) => /^latest.*\.yml$/i.test(n));
  for (const name of manifests) {
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
      try {
        const res = await fetch(`${base}/${name}`);
        ok =
          res.ok &&
          new RegExp(`^version:\\s*${pkg.version}\\s*$`, "m").test(await res.text());
      } catch {}
      if (!ok) await sleep(5000);
    }
    if (!ok) {
      log(`  note: ${name} isn't downloadable yet (GitHub's CDN can take a minute).`);
    }
  }
  return release;
}

async function main() {
  if (!publishCfg) {
    throw new Error("package.json has no GitHub publish config (build.publish).");
  }
  if (!TOKEN) throw new Error(tokenHelp());

  const { owner, repo } = repoInfo();
  const tag = tagName();

  log(`Checking that ${tag} is ready to release...`);
  const { problems, notes, info } = await preflight(owner, repo, tag);

  if (problems.length) {
    log("");
    problems.forEach((problem) => log(`  x ${problem}\n`));
    throw new Error("Not released. Fix the above and run `npm run release` again.");
  }

  log("");
  log(`Releasing ${pkg.build.productName || pkg.name} ${pkg.version}`);
  log(`  repository : ${owner}/${repo}`);
  log(`  commit     : ${info.branch} @ ${short(info.sha)}  "${info.subject}"`);
  log(`  tag        : ${tag}`);
  log("  builds     : Windows .exe  +  Linux .rpm and .deb  (built on GitHub, in parallel)");
  log("  result     : a published release (not a draft), marked Latest");
  notes.forEach((note) => log(`  note       : ${note}`));

  if (DRY_RUN) {
    log("\nDry run: everything looks ready. Nothing was started.");
    log("Run `npm run release` to build and publish for real.");
    return;
  }

  const known = new Set((await listRuns(owner, repo, info.branch)).map((run) => run.id));
  const startedAt = Date.now();
  log("\nStarting the build on GitHub...");
  await dispatch(owner, repo, info.branch);
  const run = await findNewRun(owner, repo, info.branch, info.sha, known);
  log(`  run: ${run.html_url}`);

  if (NO_WAIT) {
    log("\nBuild started. It will publish the release by itself when it finishes.");
    return;
  }

  process.on("SIGINT", () => {
    log(`\nStopped watching. The build keeps running on GitHub: ${run.html_url}`);
    process.exit(130);
  });

  log("Building on GitHub (this can take around 10 minutes; Ctrl+C is safe, the build keeps going)...");
  const result = await waitForRun(owner, repo, run.id, startedAt);
  if (result.run.conclusion !== "success") explainFailure(result.run, result.jobs);

  const release = await confirmPublished(owner, repo, tag);
  log(`\nReleased ${pkg.version} in ${elapsed(startedAt)}`);
  log(`  ${release.html_url}\n`);
  release.assets
    .filter((asset) => isManagedAsset(asset.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((asset) => log(`  ${asset.name.padEnd(40)} ${formatBytes(asset.size)}`));
  log("\nEveryone running Playnck on Windows will be offered this update automatically.");
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
