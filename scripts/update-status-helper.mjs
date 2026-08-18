#!/usr/bin/env node
/**
 * Linux apt + Qadbak git update status and background jobs (admin Updates tab).
 * Usage: update-status-helper.mjs <command> [args...]
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile, copyFile, chmod, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const QADBAK_DIR = process.env.QADBAK_DIR || "/opt/qadbak";
const QADBAK_USER = process.env.QADBAK_USER || "qadbak";
const DATA_DIR = path.join(QADBAK_DIR, "data");
const CACHE_PATH = path.join(DATA_DIR, "linux-update-cache.json");
const JOBS_DIR = path.join(DATA_DIR, "update-jobs");
const BACKUP_ROOT = path.join(DATA_DIR, "pre-update-backups");
const DATA_BACKUP_FILES = [
  "users.json",
  "native-domains.json",
  "sessions.json",
  "audit.json",
  "plans.json",
  "resellers.json",
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function githubReleasesUrl(remoteUrl) {
  const s = String(remoteUrl || "").trim();
  const m = s.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (!m) return "";
  return `https://github.com/${m[1]}/${m[2]}/releases`;
}

function parseChangelogLatest(text) {
  const m = String(text || "").match(
    /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*\n([\s\S]*?)(?=\n## \[|$)/m,
  );
  if (!m) return { changelogVersion: "", changelogDate: "", changelog: "" };
  return {
    changelogVersion: m[1],
    changelogDate: m[2] || "",
    changelog: m[3].trim().replace(/\n{3,}/g, "\n\n").slice(0, 1800),
  };
}

function versionFromPackageJson(raw) {
  try {
    return String(JSON.parse(raw).version || "").trim();
  } catch {
    return "";
  }
}

async function localReleaseMeta() {
  let version = "";
  let notes = { changelogVersion: "", changelogDate: "", changelog: "" };
  try {
    version = versionFromPackageJson(
      await readFile(path.join(QADBAK_DIR, "package.json"), "utf8"),
    );
  } catch {
    version = "";
  }
  try {
    notes = parseChangelogLatest(
      await readFile(path.join(QADBAK_DIR, "CHANGELOG.md"), "utf8"),
    );
  } catch {
    /* optional */
  }
  return { version, originVersion: version, ...notes };
}

async function ensureDirs() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(BACKUP_ROOT, { recursive: true });
}

function emit(obj) {
  console.log(JSON.stringify(obj));
}

function fail(msg) {
  emit({ ok: false, error: msg });
  process.exit(1);
}

async function run(cmd, args, opts = {}) {
  const { stdout, stderr } = await exec(cmd, args, {
    timeout: opts.timeout ?? 300_000,
    maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive", ...opts.env },
  });
  if (opts.jsonStdout) {
    return stdout;
  }
  return [stdout, stderr].filter(Boolean).join("\n");
}

/** Parse JSON from script stdout; ignore trailing apt/dpkg stderr noise. */
function parseJsonOutput(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error(trimmed.slice(0, 200) || "Invalid JSON from helper script.");
  }
}

async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}

async function chownQadbak(p) {
  try {
    await exec("chown", [`${QADBAK_USER}:${QADBAK_USER}`, p], { timeout: 5000 });
  } catch {
    // ignore on dev machines
  }
}

async function writeJson(p, data) {
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
  await chownQadbak(p);
}

async function parseLinuxUpgradeSim() {
  if (!(await exists("/usr/bin/apt-get"))) {
    return {
      upgradable: 0,
      security: 0,
      summaryLine: "apt-get not available (non-Debian host?)",
    };
  }
  let out = "";
  try {
    out = await run("apt-get", ["-s", "upgrade"], { timeout: 120_000 });
  } catch (e) {
    return {
      upgradable: 0,
      security: 0,
      summaryLine: e.message?.slice(0, 200) ?? "apt-get -s upgrade failed",
    };
  }
  const summary = out.match(/^(\d+)\s+upgraded/m);
  const upgradable = summary ? Number(summary[1]) : 0;
  const security = (out.match(/security/gi) ?? []).length;
  const summaryLine =
    out
      .split("\n")
      .find((l) => /upgraded/.test(l))
      ?.trim() ?? (upgradable ? `${upgradable} upgradable` : "System up to date");
  return { upgradable, security, summaryLine };
}

async function cmdLinuxRefresh() {
  await ensureDirs();
  if (await exists("/usr/bin/apt-get")) {
    try {
      await run("apt-get", ["update", "-qq"], { timeout: 300_000 });
    } catch (e) {
      emit({
        ok: false,
        error: `apt-get update failed: ${e.message ?? e}`,
      });
      process.exit(1);
    }
  }
  const parsed = await parseLinuxUpgradeSim();
  const rebootRequired = await exists("/var/run/reboot-required");
  const cache = {
    updatedAt: new Date().toISOString(),
    rebootRequired,
    ...parsed,
  };
  await writeJson(CACHE_PATH, cache);
  return { linux: cache };
}

async function cmdLinuxStatus() {
  await ensureDirs();
  const cache = await readJson(CACHE_PATH);
  if (cache?.updatedAt) {
    const ageMs = Date.now() - new Date(cache.updatedAt).getTime();
    if (ageMs < 60 * 60 * 1000) {
      return { linux: cache, fromCache: true };
    }
  }
  return cmdLinuxRefresh();
}

async function writeJobMeta(jobId, meta) {
  await writeJson(path.join(JOBS_DIR, `${jobId}.json`), meta);
}

async function readJobMeta(jobId) {
  return readJson(path.join(JOBS_DIR, `${jobId}.json`));
}

async function tailLog(jobId, maxLines = 80) {
  const logPath = path.join(JOBS_DIR, `${jobId}.log`);
  if (!(await exists(logPath))) return "";
  const raw = await readFile(logPath, "utf8");
  const lines = raw.split("\n");
  return lines.slice(-maxLines).join("\n");
}

async function startNohupJob(jobId, type, shellBody) {
  await ensureDirs();
  const logPath = path.join(JOBS_DIR, `${jobId}.log`);
  const metaPath = path.join(JOBS_DIR, `${jobId}.json`);
  await writeFile(
    logPath,
    `==> Job ${jobId} (${type}) started ${new Date().toISOString()}\n`,
    "utf8",
  );
  await writeJobMeta(jobId, {
    id: jobId,
    type,
    status: "running",
    startedAt: new Date().toISOString(),
  });

  const wrapped = `#!/bin/bash
set -uo pipefail
export META=${JSON.stringify(metaPath)}
exec >>${JSON.stringify(logPath)} 2>&1
echo "==> Running ${type}"
${shellBody}
EC=$?
echo "==> Finished exit $EC"
export EC
write_meta() {
  python3 - <<'PY'
import json, os, datetime
p = os.environ["META"]
ec = int(os.environ.get("EC", "1"))
with open(p, encoding="utf-8") as f:
    m = json.load(f)
m["status"] = "done" if ec == 0 else "failed"
m["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
m["exitCode"] = ec
with open(p, "w", encoding="utf-8") as f:
    json.dump(m, f, indent=2)
    f.write("\\n")
PY
}
if command -v python3 >/dev/null 2>&1; then
  write_meta
elif command -v node >/dev/null 2>&1; then
  node <<'NODE'
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.env.META, "utf8"));
const ec = Number(process.env.EC);
m.status = ec === 0 ? "done" : "failed";
m.finishedAt = new Date().toISOString();
m.exitCode = ec;
fs.writeFileSync(process.env.META, JSON.stringify(m, null, 2));
NODE
fi
exit $EC
`;
  const scriptPath = path.join(JOBS_DIR, `${jobId}.sh`);
  await writeFile(scriptPath, wrapped, { mode: 0o700 });
  await chmod(scriptPath, 0o700);
  const child = spawn("nohup", ["bash", scriptPath], {
    detached: true,
    stdio: "ignore",
    cwd: QADBAK_DIR,
  });
  const pid = child.pid;
  child.unref();
  await writeJobMeta(jobId, {
    id: jobId,
    type,
    status: "running",
    startedAt: new Date().toISOString(),
    pid,
  });
  return { jobId, type, status: "running", pid };
}

function processAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

async function runningUpdateJobs() {
  await ensureDirs();
  let names = [];
  try {
    names = await readdir(JOBS_DIR);
  } catch {
    return [];
  }
  const running = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const meta = await readJson(path.join(JOBS_DIR, name), null);
    if (!(meta?.status === "running" && meta.id)) continue;
    if (meta.pid && !processAlive(meta.pid)) {
      await writeJobMeta(meta.id, {
        ...meta,
        status: "failed",
        finishedAt: new Date().toISOString(),
        exitCode: -1,
        error: "process no longer running",
      });
      continue;
    }
    running.push(meta);
  }
  return running;
}

async function assertNoRunningUpdateJob() {
  const running = await runningUpdateJobs();
  if (running.length) {
    fail(
      `An update job is already running (${running[0].id}). Wait until it finishes.`,
    );
  }
}

async function cmdUbuntuReleaseStatus() {
  const script = path.join(QADBAK_DIR, "scripts", "ubuntu-release-upgrade.sh");
  if (!(await exists(script))) {
    return {
      ubuntuRelease: {
        supported: false,
        reason: "ubuntu-release-upgrade.sh not found — git pull first.",
        checkedAt: new Date().toISOString(),
      },
    };
  }
  const cache = await readJson(CACHE_PATH);
  const rebootRequired = await exists("/var/run/reboot-required");
  let raw = "";
  try {
    raw = await run("bash", [script, "status-json"], {
      timeout: 120_000,
      jsonStdout: true,
    });
  } catch (e) {
    return {
      ubuntuRelease: {
        supported: false,
        reason: e.message?.slice(0, 300) ?? "status check failed",
        checkedAt: new Date().toISOString(),
      },
    };
  }
  const status = parseJsonOutput(raw);
  let preflight = null;
  if (status.nextTarget?.version) {
    try {
      const pfRaw = await run(
        "bash",
        [script, "preflight", status.nextTarget.version],
        { timeout: 300_000, jsonStdout: true },
      );
      preflight = parseJsonOutput(pfRaw);
    } catch (e) {
      preflight = {
        preflightOk: false,
        issues: [e.message?.slice(0, 200) ?? "preflight failed"],
      };
    }
  }
  return {
    ubuntuRelease: {
      ...status,
      packageUpdatesPending: cache?.upgradable ?? preflight?.packageUpdatesPending ?? 0,
      rebootRequired: rebootRequired || Boolean(preflight?.rebootRequired),
      preflightOk: preflight?.preflightOk ?? false,
      preflightIssues: preflight?.issues ?? status.issues ?? [],
      checkedAt: new Date().toISOString(),
    },
  };
}

async function cmdUbuntuReleaseStart(target) {
  if (!target || !/^\d{2}\.\d{2}$/.test(target)) {
    fail("Invalid target Ubuntu version.");
  }
  const script = path.join(QADBAK_DIR, "scripts", "ubuntu-release-upgrade.sh");
  if (!(await exists(script))) {
    fail("ubuntu-release-upgrade.sh not found.");
  }
  let preflight;
  try {
    const pfRaw = await run("bash", [script, "preflight", target], {
      timeout: 300_000,
      jsonStdout: true,
    });
    preflight = parseJsonOutput(pfRaw);
  } catch (e) {
    fail(`Preflight failed: ${e.message ?? e}`);
  }
  if (!preflight.preflightOk) {
    fail(
      `Preflight failed: ${(preflight.issues ?? []).join(" ") || "see admin UI"}`,
    );
  }
  const jobId = `ubuntu-release-${Date.now()}`;
  await assertNoRunningUpdateJob();
  await startNohupJob(
    jobId,
    "ubuntu-release-upgrade",
    `export DEBIAN_FRONTEND=noninteractive
export PYTHONUNBUFFERED=1
export NEEDRESTART_MODE=a
bash ${JSON.stringify(script)} run ${JSON.stringify(target)}
`,
  );
  return { job: { id: jobId, type: "ubuntu-release-upgrade", status: "running" } };
}

async function cmdLinuxUpgradeStart() {
  if (!(await exists("/usr/bin/apt-get"))) {
    fail("apt-get not available on this host.");
  }
  const jobId = `linux-${Date.now()}`;
  await assertNoRunningUpdateJob();
  await startNohupJob(
    jobId,
    "linux-upgrade",
    `export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y
`,
  );
  return { job: { id: jobId, type: "linux-upgrade", status: "running" } };
}

async function readEnvGitBranch() {
  const envPath = path.join(QADBAK_DIR, ".env.local");
  if (!(await exists(envPath))) return "";
  const raw = await readFile(envPath, "utf8");
  const m = raw.match(/^[ \t]*QADBAK_GIT_BRANCH=(.+)$/m);
  if (!m) return "";
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function resolveTrackingBranch() {
  const fromEnv = await readEnvGitBranch();
  if (fromEnv) return fromEnv;
  const head = (
    await run("git", ["-C", QADBAK_DIR, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 10_000,
    })
  ).trim();
  if (!head || head === "HEAD") return "main";
  return head;
}

async function originBranchRef(branch) {
  const ref = `refs/remotes/origin/${branch}`;
  try {
    await run("git", ["-C", QADBAK_DIR, "show-ref", "--verify", "--quiet", ref], {
      timeout: 10_000,
    });
    return branch;
  } catch {
    return "main";
  }
}

async function cmdQadbakStatus() {
  if (!(await exists(path.join(QADBAK_DIR, ".git")))) {
    const meta = await localReleaseMeta();
    return {
      qadbak: {
        isGit: false,
        message: "Not a git checkout.",
        ...meta,
      },
    };
  }
  let commit = "";
  let branch = "main";
  let trackingBranch = "main";
  let remoteUrl = "";
  let behind = 0;
  let diverged = false;
  let remoteRef = "";
  try {
    commit = (
      await run("git", ["-C", QADBAK_DIR, "rev-parse", "--short", "HEAD"], {
        timeout: 10_000,
      })
    ).trim();
    branch = (
      await run("git", ["-C", QADBAK_DIR, "rev-parse", "--abbrev-ref", "HEAD"], {
        timeout: 10_000,
      })
    ).trim();
    trackingBranch = await resolveTrackingBranch();
    remoteUrl = (
      await run("git", ["-C", QADBAK_DIR, "remote", "get-url", "origin"], {
        timeout: 10_000,
      })
    ).trim();
  } catch (e) {
    const meta = await localReleaseMeta();
    return {
      qadbak: {
        isGit: true,
        commit,
        branch,
        error: e.message?.slice(0, 200),
        ...meta,
      },
    };
  }
  try {
    await run("git", ["-C", QADBAK_DIR, "fetch", "--prune", "origin", "--quiet"], {
      timeout: 120_000,
    });
    const remoteBranch = await originBranchRef(trackingBranch);
    remoteRef = `origin/${remoteBranch}`;
    const count = (
      await run(
        "git",
        ["-C", QADBAK_DIR, "rev-list", "--count", `HEAD..${remoteRef}`],
        { timeout: 10_000 },
      )
    ).trim();
    behind = Number(count) || 0;
    try {
      const localSha = (
        await run("git", ["-C", QADBAK_DIR, "rev-parse", "HEAD"], { timeout: 10_000 })
      ).trim();
      const remoteSha = (
        await run("git", ["-C", QADBAK_DIR, "rev-parse", remoteRef], {
          timeout: 10_000,
        })
      ).trim();
      if (localSha !== remoteSha && behind === 0) {
        diverged = true;
      }
    } catch {
      diverged = false;
    }
  } catch {
    behind = -1;
  }
  const meta = await localReleaseMeta();
  if (behind !== -1 && remoteRef) {
    try {
      const originPkg = await run(
        "git",
        ["-C", QADBAK_DIR, "show", `${remoteRef}:package.json`],
        { timeout: 10_000 },
      );
      meta.originVersion = versionFromPackageJson(originPkg) || meta.originVersion;
    } catch {
      /* keep local version */
    }
    try {
      const originCl = await run(
        "git",
        ["-C", QADBAK_DIR, "show", `${remoteRef}:CHANGELOG.md`],
        { timeout: 10_000 },
      );
      const parsed = parseChangelogLatest(originCl);
      if (parsed.changelogVersion) {
        meta.changelogVersion = parsed.changelogVersion;
        meta.changelogDate = parsed.changelogDate;
        meta.changelog = parsed.changelog;
      }
    } catch {
      /* keep local changelog */
    }
  }
  return {
    qadbak: {
      isGit: true,
      commit,
      branch,
      trackingBranch,
      remoteUrl,
      behind,
      diverged,
      upToDate: behind === 0 && !diverged,
      checkedAt: new Date().toISOString(),
      releasesUrl: githubReleasesUrl(remoteUrl),
      ...meta,
    },
  };
}

async function backupPanelData() {
  await ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(BACKUP_ROOT, stamp);
  await mkdir(dir, { recursive: true });
  const copied = [];
  for (const name of DATA_BACKUP_FILES) {
    const src = path.join(DATA_DIR, name);
    if (await exists(src)) {
      await copyFile(src, path.join(dir, name));
      copied.push(name);
    }
  }
  return { backupDir: dir, copied };
}

async function cmdQadbakUpgradeStart() {
  const script = path.join(QADBAK_DIR, "scripts", "update-qadbak.sh");
  if (!(await exists(script))) {
    fail(`Missing ${script}`);
  }
  await assertNoRunningUpdateJob();
  const { backupDir, copied } = await backupPanelData();
  const jobId = `qadbak-${Date.now()}`;
  await startNohupJob(
    jobId,
    "qadbak-upgrade",
    `echo "==> Data backup: ${backupDir} (${copied.join(", ") || "none"})"
cd ${JSON.stringify(QADBAK_DIR)}
bash ${JSON.stringify(script)}
`,
  );
  return {
    job: { id: jobId, type: "qadbak-upgrade", status: "running" },
    backupDir,
    copied,
  };
}

async function cmdJobStatus(jobId) {
  if (!jobId || /[^a-zA-Z0-9_-]/.test(jobId)) {
    fail("Invalid job id.");
  }
  const meta = await readJobMeta(jobId);
  if (!meta) {
    fail("Job not found.");
  }
  const log = await tailLog(jobId, 120);
  return { job: meta, log };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!cmd) {
    fail(
      "Usage: ping | linux-status | linux-refresh | linux-upgrade-start | ubuntu-release-status | ubuntu-release-start VERSION | qadbak-status | qadbak-upgrade-start | job-status JOB_ID",
    );
  }
  let result;
  switch (cmd) {
    case "ping":
      result = { pong: true };
      break;
    case "linux-status":
      result = await cmdLinuxStatus();
      break;
    case "linux-refresh":
      result = await cmdLinuxRefresh();
      break;
    case "linux-upgrade-start":
      result = await cmdLinuxUpgradeStart();
      break;
    case "ubuntu-release-status":
      result = await cmdUbuntuReleaseStatus();
      break;
    case "ubuntu-release-start":
      result = await cmdUbuntuReleaseStart(arg);
      break;
    case "qadbak-status":
      result = await cmdQadbakStatus();
      break;
    case "qadbak-upgrade-start":
      result = await cmdQadbakUpgradeStart();
      break;
    case "job-status":
      result = await cmdJobStatus(arg);
      break;
    default:
      fail(`Unknown command: ${cmd}`);
  }
  emit({ ok: true, ...result });
}

main().catch((err) => {
  emit({ ok: false, error: err.message ?? String(err) });
  process.exit(1);
});
