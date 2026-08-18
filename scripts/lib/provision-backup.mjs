import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import {
  access,
  readdir,
  stat,
  mkdir,
  rm,
  writeFile,
  readFile,
  cp,
  rename,
  realpath,
  open,
} from "node:fs/promises";
import path from "node:path";
import { safeExtractArchive } from "./safe-archive-extract.mjs";
import {
  emit,
  fail,
  resolveDomainUser,
  unixUserExists,
  domainConfigDir,
  QADBAK_DIR,
  loadRegistry,
  readDomainConfigJson,
  writeDomainConfigJson,
  assertNotAliasDomain,
} from "./provisioning-common.mjs";
import { backupMailToStaging, restoreMailFromHome } from "./backup-mail.mjs";
import { backupDomainExtras, restoreDomainExtras, listDomainSettingsFiles } from "./backup-extras.mjs";

const exec = promisify(execFile);
const BACKUP_CFG = "backups.json";
const CRON_MARKER = "qadbak-backup";
const RUN_BACKUP = path.join(QADBAK_DIR, "scripts", "run-domain-backup.sh");

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function mysqlExec(sql) {
  const { stdout } = await exec("mysql", ["-N", "-B", "-e", sql], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout.trim();
}

async function listDomainDatabases(domain, unixUser) {
  const prefix = `${unixUser}_`;
  const out = await mysqlExec("SHOW DATABASES");
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((name) => name && (name.startsWith(prefix) || name === unixUser.replace(/-/g, "_")));
}

function safeBackupName(name) {
  const base = path.basename(String(name || ""));
  if (!base || base.includes("..") || !base.endsWith(".tar.gz")) {
    fail("Invalid backup file name");
  }
  return base;
}

function backupsRoot(home) {
  return path.join(home, "backups");
}

function backupsDir(home, domain) {
  const d = String(domain || "")
    .trim()
    .toLowerCase();
  return d ? path.join(home, "backups", d) : backupsRoot(home);
}

async function resolveExistingBackup(home, domain, name) {
  const fname = safeBackupName(name);
  const candidates = [
    path.resolve(path.join(backupsDir(home, domain), fname)),
    path.resolve(path.join(backupsRoot(home), fname)),
  ];
  const allowed = [
    path.resolve(backupsDir(home, domain)),
    path.resolve(backupsRoot(home)),
  ];
  for (const full of candidates) {
    if (!allowed.some((dir) => full.startsWith(`${dir}${path.sep}`))) continue;
    if (await fileExists(full)) return full;
  }
  return null;
}

async function chownRestoredSite(user, home) {
  const targets = [
    path.join(home, "public_html"),
    path.join(home, "backups"),
    path.join(home, "tmp"),
    path.join(home, "Maildir"),
  ];
  for (const t of targets) {
    await exec("chown", ["-R", `${user}:${user}`, t], { timeout: 120_000 }).catch(() => {});
  }
}

function qadbakCronUser() {
  return process.env.QADBAK_USER?.trim() || "qadbak";
}

async function loadSchedule(domain) {
  const cfg = await readDomainConfigJson(domain, BACKUP_CFG, {
    schedule: "0 3 * * *",
    enabled: true,
    retain: 7,
  });
  return {
    schedule: String(cfg.schedule || "0 3 * * *"),
    enabled: Boolean(cfg.enabled),
    retain: Number(cfg.retain) > 0 ? Number(cfg.retain) : 7,
  };
}

async function saveSchedule(domain, schedule) {
  await writeDomainConfigJson(domain, BACKUP_CFG, schedule);
}

async function readCrontab(user) {
  try {
    const { stdout } = await exec("crontab", ["-l", "-u", user], { maxBuffer: 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (String(e).includes("no crontab")) return "";
    throw e;
  }
}

async function writeCrontab(user, body) {
  const tmp = `/tmp/qadbak-cron-${user}-${Date.now()}`;
  await writeFile(tmp, body, "utf8");
  await exec("crontab", ["-u", user, tmp]);
}

function stripBackupCronLines(text) {
  return text
    .split("\n")
    .filter((line) => !line.includes(CRON_MARKER))
    .join("\n")
    .replace(/\n+$/, "");
}

/** Remove legacy per-domain-user backup cron lines (broken: domain users lack sudo). */
async function migrateDomainUserBackupCrons() {
  const rows = await loadRegistry();
  for (const row of rows) {
    const user = String(row.user || "").trim();
    if (!user) continue;
    try {
      let body = stripBackupCronLines(await readCrontab(user));
      if (!body.trim()) {
        try {
          await exec("crontab", ["-r", "-u", user]);
        } catch {
          /* no crontab */
        }
      } else {
        await writeCrontab(user, `${body}\n`);
      }
    } catch {
      /* */
    }
  }
}

/** Install all enabled domain backup jobs on the qadbak user crontab (has NOPASSWD sudo). */
async function syncAllBackupCrons() {
  await migrateDomainUserBackupCrons();
  const cronUser = qadbakCronUser();
  const rows = await loadRegistry();
  let body = stripBackupCronLines(await readCrontab(cronUser));
  const lines = [];
  for (const row of rows) {
    const domain = String(row.name || "").trim();
    if (!domain || row.demoOnly) continue;
    if (String(row.type || "").toLowerCase() === "alias") continue;
    const sched = await loadSchedule(domain);
    if (sched.enabled) {
      lines.push(
        `${sched.schedule} ${RUN_BACKUP} ${domain} scheduled # ${CRON_MARKER}:${domain}`,
      );
    }
  }
  if (lines.length) {
    body = body ? `${body}\n${lines.join("\n")}\n` : `${lines.join("\n")}\n`;
  }
  if (!body.trim()) {
    try {
      await exec("crontab", ["-r", "-u", cronUser]);
    } catch {
      /* no crontab */
    }
  } else {
    await writeCrontab(cronUser, body);
  }
}

async function syncBackupCron(_domain) {
  await syncAllBackupCrons();
}

async function applyBackupSchedule(
  domain,
  { forceEnable = false, runIfStale = false, staleDays = 1 } = {},
) {
  await resolveDomainUser(domain);
  const sched = await loadSchedule(domain);
  if (forceEnable && !sched.enabled) {
    sched.enabled = true;
    await saveSchedule(domain, sched);
  }
  let backupCreated = false;
  if (runIfStale) {
    const age = await backupNewestAgeDays(domain);
    if (age === null || age >= staleDays) {
      await backupCreate(domain, "full");
      backupCreated = true;
    }
  }
  return { schedule: sched, backupCreated };
}

async function pruneOldBackups(home, domain, retain) {
  const dir = backupsDir(home, domain);
  const files = [];
  try {
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".tar.gz")) continue;
      const full = path.join(dir, name);
      const st = await stat(full);
      files.push({ name, mtime: st.mtimeMs });
    }
  } catch {
    return;
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(retain)) {
    await rm(path.join(dir, f.name), { force: true });
  }
}

/** Newest local backup age in days, or null when none exist under /home/{user}/backups. */
export async function backupNewestAgeDays(domain) {
  const { home } = await resolveDomainUser(domain);
  const d = String(domain).toLowerCase();
  let newest = 0;
  for (const dir of [backupsDir(home, d), backupsRoot(home)]) {
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.endsWith(".tar.gz")) continue;
      if (dir === backupsRoot(home) && !name.startsWith(`${d}-`)) continue;
      const st = await stat(path.join(dir, name));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  }
  if (!newest) return null;
  return Math.floor((Date.now() - newest) / 86_400_000);
}

export async function backupList(domain) {
  await assertNotAliasDomain(domain, "backups");
  const { home } = await resolveDomainUser(domain);
  const d = String(domain).toLowerCase();
  const dir = backupsDir(home, d);
  await mkdir(dir, { recursive: true });
  const files = [];
  const seen = new Set();
  for (const scan of [dir, backupsRoot(home)]) {
    for (const name of await readdir(scan).catch(() => [])) {
      if (!name.endsWith(".tar.gz")) continue;
      if (scan === backupsRoot(home) && !name.startsWith(`${d}-`)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const full = path.join(scan, name);
      const st = await stat(full);
      files.push({
        name,
        sizeBytes: st.size,
        modified: st.mtime.toISOString(),
        kind: name.includes("-scheduled-") ? "scheduled" : "manual",
        _dir: scan,
      });
    }
  }
  files.sort((a, b) => b.modified.localeCompare(a.modified));
  for (const f of files.slice(0, 40)) {
    try {
      const { stdout } = await exec(
        "tar",
        ["-xOf", path.join(f._dir || dir, f.name), "manifest.json"],
        { timeout: 60_000, maxBuffer: 512 * 1024 },
      );
      const manifest = JSON.parse(stdout);
      if (Array.isArray(manifest.components)) f.components = manifest.components;
      if (Array.isArray(manifest.mailAccounts)) {
        f.mailAccounts = manifest.mailAccounts.length;
      }
    } catch {
      /* legacy archives without manifest */
    }
  }
  const sched = await loadSchedule(domain);
  emit({
    ok: true,
    backups: files.map(({ _dir, ...rest }) => rest),
    schedule: sched,
  });
}

export async function backupCreate(domain, scopeArg) {
  await assertNotAliasDomain(domain, "backups");
  const scope = String(scopeArg || "full").toLowerCase();
  const { user, home } = await resolveDomainUser(domain);
  const dir = backupsDir(home, domain);
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const kind = scope === "scheduled" ? "scheduled" : "manual";
  const archive = `${domain}-${kind}-${stamp}.tar.gz`;
  const file = path.join(dir, archive);
  const staging = `/tmp/qadbak-backup-${user}-${Date.now()}`;
  await mkdir(staging, { recursive: true });

  const components = [];
  const pub = path.join(home, "public_html");
  if (await fileExists(pub)) {
    await mkdir(path.join(staging, "public_html"), { recursive: true });
    await exec("cp", ["-a", `${pub}/.`, path.join(staging, "public_html")], {
      timeout: 600_000,
    });
    components.push("public_html");
  }

  let mailAccounts = [];
  if (scope === "full") {
    const mail = await backupMailToStaging(
      path.join(staging, "mail"),
      domain,
      user,
      home,
    );
    if (mail.included) {
      mailAccounts = mail.accounts;
      const label =
        mail.accounts.length > 1
          ? `mail (${mail.accounts.length} accounts)`
          : mail.accounts.length === 1
            ? `mail (${mail.accounts[0].user})`
            : "mail";
      components.push(label);
      await writeFile(
        path.join(staging, "mail-accounts.json"),
        `${JSON.stringify({ accounts: mail.accounts, paths: mail.entries }, null, 2)}\n`,
        "utf8",
      );
    }
  }

  const cfgDir = domainConfigDir(domain);
  if (scope === "full" && (await fileExists(cfgDir))) {
    await exec("cp", ["-a", cfgDir, path.join(staging, "qadbak-config")], {
      timeout: 120_000,
    });
    const settingsFiles = await listDomainSettingsFiles(domain);
    const settingsLabel =
      settingsFiles.length > 0
        ? `settings (${settingsFiles.length}: ${settingsFiles.map((f) => f.replace(/\.json$/, "")).slice(0, 6).join(", ")}${settingsFiles.length > 6 ? ", …" : ""})`
        : "settings";
    components.push(settingsLabel);
  }

  if (scope === "full") {
    const extras = await backupDomainExtras(domain, user, home, staging);
    components.push(...extras.components);
  }

  const mysqlDir = path.join(staging, "mysql");
  if (scope === "full") {
    try {
      const dbs = await listDomainDatabases(domain, user);
      if (dbs.length) {
        await mkdir(mysqlDir, { recursive: true });
        for (const db of dbs) {
          const outSql = path.join(mysqlDir, `${db}.sql`);
          await exec(
            "mysqldump",
            ["--single-transaction", "--quick", db],
            { timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
          ).then(async ({ stdout }) => {
            await writeFile(outSql, stdout, "utf8");
          });
        }
        components.push("mysql");
      }
    } catch {
      /* mysqldump optional */
    }
  }

  const settingsFiles =
    scope === "full" ? await listDomainSettingsFiles(domain) : [];
  const manifest = {
    version: 3,
    domain,
    created: new Date().toISOString(),
    scope,
    components,
    mailAccounts,
    settingsFiles,
  };
  await writeFile(
    path.join(staging, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await exec("tar", ["-czf", file, "-C", staging, "."], {
    timeout: 900_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  await exec("chown", [`${user}:${user}`, file]);
  await rm(staging, { recursive: true, force: true });

  const sched = await loadSchedule(domain);
  await pruneOldBackups(home, domain, sched.retain);

  let offsite = { uploaded: false };
  try {
    const { maybeUploadBackupOffsite } = await import("./backup-offsite.mjs");
    offsite = await maybeUploadBackupOffsite(domain, file, archive);
  } catch (e) {
    offsite = { uploaded: false, error: e instanceof Error ? e.message : String(e) };
  }

  emit({
    ok: true,
    file: archive,
    path: file,
    sizeBytes: (await stat(file)).size,
    components,
    mailAccounts,
    offsite,
  });
}

export async function backupDelete(domain, name) {
  const fname = safeBackupName(name);
  await resolveDomainUser(domain);
  const { home } = await resolveDomainUser(domain);
  const full = await resolveExistingBackup(home, domain, fname);
  if (!full) fail(`Backup not found: ${fname}`);
  await rm(full);
  emit({ ok: true, deleted: fname });
}

async function assertPanelUploadTemp(tempPath) {
  const tmpRoot = await realpath(os.tmpdir());
  const resolved = await realpath(tempPath).catch(() => null);
  if (!resolved || !resolved.startsWith(`${tmpRoot}${path.sep}`)) {
    fail("Invalid temp path");
  }
  const base = path.basename(resolved);
  if (!base.startsWith("qadbak-upload-")) {
    fail("Invalid temp file");
  }
  const st = await stat(resolved);
  if (!st.isFile()) fail("Not a file");
  return { resolved, sizeBytes: st.size };
}

async function assertGzipArchive(filePath) {
  const buf = Buffer.alloc(2);
  const fh = await open(filePath, "r");
  try {
    await fh.read(buf, 0, 2, 0);
  } finally {
    await fh.close();
  }
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) {
    fail("File must be a .tar.gz gzip archive");
  }
}

/** Import a backup archive uploaded via the panel (temp file under os.tmpdir()). */
export async function backupUpload(domain, tempPath, destNameArg) {
  const { user, home } = await resolveDomainUser(domain);
  const { resolved, sizeBytes } = await assertPanelUploadTemp(tempPath);
  await assertGzipArchive(resolved);

  const dir = backupsDir(home, domain);
  await mkdir(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let fname = destNameArg?.trim()
    ? safeBackupName(destNameArg.trim())
    : `${domain}-uploaded-${stamp}.tar.gz`;
  const dest = path.join(dir, fname);
  if (await fileExists(dest)) {
    fname = `${domain}-uploaded-${stamp}.tar.gz`;
  }
  const finalPath = path.join(dir, fname);

  await rename(resolved, finalPath);
  await exec("chown", [`${user}:${user}`, finalPath]);

  const sched = await loadSchedule(domain);
  await pruneOldBackups(home, domain, sched.retain);

  emit({
    ok: true,
    file: fname,
    path: finalPath,
    sizeBytes: (await stat(finalPath)).size,
    uploadedBytes: sizeBytes,
  });
}

/** Resolve absolute path + size for panel download (path stays server-side until streamed). */
export async function backupResolveDownload(domain, name) {
  const fname = safeBackupName(name);
  const { home } = await resolveDomainUser(domain);
  const full = await resolveExistingBackup(home, domain, fname);
  if (!full) fail(`Backup not found: ${fname}`);
  const st = await stat(full);
  if (!st.isFile()) fail("Not a backup file");
  emit({ ok: true, path: full, fileName: fname, sizeBytes: st.size });
}

export async function backupRestore(domain, source, testOnly) {
  const d = String(domain).trim().toLowerCase();
  const { user, home } = await resolveDomainUser(d);
  const dir = path.resolve(backupsDir(home, d));
  const legacy = path.resolve(backupsRoot(home));
  let archive = String(source || "").trim();
  if (!archive) fail("source required");
  if (!archive.includes("/")) {
    const found = await resolveExistingBackup(home, d, archive);
    archive = found || path.join(dir, safeBackupName(archive));
  }
  archive = path.resolve(archive);
  if (
    !archive.startsWith(`${dir}${path.sep}`) &&
    !archive.startsWith(`${legacy}${path.sep}`)
  ) {
    fail("Restore source must be under domain backups directory");
  }
  if (!(await fileExists(archive))) fail(`Archive not found: ${archive}`);

  if (testOnly === "true" || testOnly === true || testOnly === "1") {
    const { stdout } = await exec("tar", ["-tzf", archive], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const lines = stdout.split("\n").filter(Boolean);
    let manifest = null;
    try {
      const { stdout: raw } = await exec("tar", ["-xOf", archive, "manifest.json"], {
        timeout: 60_000,
        maxBuffer: 512 * 1024,
      });
      manifest = JSON.parse(raw);
    } catch {
      /* legacy archive */
    }
    const important = lines.filter((l) =>
      /^(mail\/|Maildir\/|qadbak-config\/|mysql\/|dns\/|ssl\/|manifest\.json|mail-accounts\.json|settings-index\.json|postfix-domain\.json|crontab\.txt)/.test(
        l,
      ),
    );
    emit({
      ok: true,
      test: true,
      entries: lines.length,
      preview: [...important.slice(0, 20), ...lines.slice(0, 10)].slice(0, 30),
      manifest,
      mailAccounts: manifest?.mailAccounts ?? [],
      components: manifest?.components ?? [],
      settingsFiles: manifest?.settingsFiles ?? [],
    });
    return;
  }

  const staging = `/tmp/qadbak-restore-${user}-${Date.now()}`;
  await mkdir(staging, { recursive: true });
  await safeExtractArchive("tar.gz", archive, staging);

  const restored = [];
  const pubStaging = path.join(staging, "public_html");
  const pub = path.join(home, "public_html");
  if (await fileExists(pubStaging)) {
    await mkdir(pub, { recursive: true });
    await exec("rsync", ["-a", "--delete", `${pubStaging}/`, `${pub}/`], {
      timeout: 600_000,
    });
    restored.push("public_html");
  }

  const mailRestore = await restoreMailFromHome(home, staging, user);
  if (mailRestore.restored.length) {
    const n = mailRestore.accounts.length || mailRestore.restored.length;
    restored.push(n > 1 ? `mail (${n} accounts)` : "mail");
  }

  const cfgStaging = path.join(staging, "qadbak-config");
  if (await fileExists(cfgStaging)) {
    const target = domainConfigDir(d);
    await rm(target, { recursive: true, force: true }).catch(() => {});
    await cp(cfgStaging, target, { recursive: true });
    const settingsFiles = await listDomainSettingsFiles(d);
    restored.push(
      settingsFiles.length ? `settings (${settingsFiles.length} files)` : "settings",
    );
  }

  await restoreDomainExtras(d, user, home, staging, restored);

  const mysqlStaging = path.join(staging, "mysql");
  if (await fileExists(mysqlStaging)) {
    for (const name of await readdir(mysqlStaging)) {
      if (!name.endsWith(".sql")) continue;
      const db = name.replace(/\.sql$/, "");
      const sqlPath = path.join(mysqlStaging, name);
      await exec(
        "bash",
        ["-c", `mysql ${db.replace(/[^a-zA-Z0-9_]/g, "")} < ${JSON.stringify(sqlPath)}`],
        { timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
      ).catch(() => {});
    }
    restored.push("mysql");
  }

  await rm(staging, { recursive: true, force: true });
  await chownRestoredSite(user, home);
  emit({ ok: true, restored, archive: path.basename(archive) });
}

export async function backupScheduleGet(domain) {
  const sched = await loadSchedule(domain);
  emit({ ok: true, schedule: sched });
}

export async function backupScheduleSet(domain, jsonArg) {
  let body = {};
  try {
    body = JSON.parse(jsonArg || "{}");
  } catch {
    fail("invalid schedule JSON");
  }
  const prev = await loadSchedule(domain);
  const next = {
    schedule: String(body.schedule ?? prev.schedule),
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : prev.enabled,
    retain: body.retain !== undefined ? Number(body.retain) : prev.retain,
  };
  await saveSchedule(domain, next);
  await syncAllBackupCrons();
  emit({ ok: true, schedule: next });
}

export async function backupScheduleToggle(domain, enabled) {
  const sched = await loadSchedule(domain);
  sched.enabled = enabled === "true" || enabled === "1" || enabled === true;
  await saveSchedule(domain, sched);
  await syncAllBackupCrons();
  emit({ ok: true, schedule: sched });
}

export async function ensureBackupSchedule(domain, jsonArg) {
  let body = {};
  try {
    body = JSON.parse(jsonArg || "{}");
  } catch {
    fail("invalid JSON");
  }
  const result = await setupBackupSchedule(domain, {
    forceEnable: body.forceEnable !== false,
    runIfStale: Boolean(body.runIfStale),
    staleDays: Number(body.staleDays) > 0 ? Number(body.staleDays) : 1,
  });
  emit({ ok: true, domain, ...result });
}

export async function setupBackupSchedule(
  domain,
  { forceEnable = false, runIfStale = false, staleDays = 1 } = {},
) {
  const result = await applyBackupSchedule(domain, { forceEnable, runIfStale, staleDays });
  await syncAllBackupCrons();
  return result;
}

export async function backupScheduleEnsureAll(jsonArg) {
  let body = {};
  try {
    body = JSON.parse(jsonArg || "{}");
  } catch {
    fail("invalid JSON");
  }
  const runStale = body.runStale !== false;
  const staleDays = Number(body.staleDays) > 0 ? Number(body.staleDays) : 1;
  const rows = await loadRegistry();
  const results = [];
  for (const row of rows) {
    const domain = String(row.name || "").trim();
    if (!domain || row.demoOnly) continue;
    if (!unixUserExists(row.user)) {
      results.push({ domain, skipped: true, reason: "unix user missing" });
      continue;
    }
    try {
      const result = await setupBackupSchedule(domain, {
        forceEnable: true,
        runIfStale: runStale,
        staleDays,
      });
      results.push({ domain, ...result });
    } catch (e) {
      results.push({
        domain,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  emit({ ok: true, domains: results.length, results });
}

const POLICY_CFG = "backup-policy.json";

export async function backupListRemote(domain) {
  const { listRemoteBackups } = await import("./backup-offsite.mjs");
  await listRemoteBackups(domain);
}

export async function backupPullRemote(domain, remoteKey) {
  const { pullRemoteBackupToLocal } = await import("./backup-offsite.mjs");
  await pullRemoteBackupToLocal(domain, remoteKey);
}

export async function backupPullRemoteAndRestore(domain, remoteKey, testOnly) {
  const { pullRemoteBackupToLocal } = await import("./backup-offsite.mjs");
  await pullRemoteBackupToLocal(domain, remoteKey);
  const fname = path.basename(String(remoteKey || ""));
  await backupRestore(domain, fname, testOnly ? "true" : "false");
}

export async function backupPolicyGet(domain) {
  await resolveDomainUser(domain);
  const policy = await readDomainConfigJson(domain, POLICY_CFG, {
    offsite: false,
    providerId: "default",
  });
  emit({ ok: true, policy });
}

export async function backupPolicySet(domain, jsonArg) {
  await resolveDomainUser(domain);
  let body = {};
  try {
    body = JSON.parse(jsonArg || "{}");
  } catch {
    fail("invalid policy JSON");
  }
  const prev = await readDomainConfigJson(domain, POLICY_CFG, {
    offsite: false,
    providerId: "default",
  });
  const next = {
    offsite: body.offsite !== undefined ? Boolean(body.offsite) : prev.offsite,
    providerId: String(body.providerId ?? prev.providerId ?? "default"),
  };
  await writeDomainConfigJson(domain, POLICY_CFG, next);
  emit({ ok: true, policy: next });
}

function safeRelativePath(rel) {
  const p = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p || p.includes("..")) fail("Invalid path in archive");
  return p;
}

export async function backupArchiveList(domain, name, prefixArg) {
  const { home } = await resolveDomainUser(domain);
  const archive = await resolveExistingBackup(home, domain, name);
  if (!archive) fail(`Backup not found: ${name}`);
  const prefix = prefixArg ? safeRelativePath(prefixArg) : "";
  const { stdout } = await exec("tar", ["-tzf", archive], {
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const lines = stdout.split("\n").filter(Boolean);
  const filtered = prefix
    ? lines.filter((l) => l === prefix || l.startsWith(`${prefix}/`))
    : lines;
  const entries = [];
  const seen = new Set();
  for (const line of filtered) {
    const parts = line.split("/").filter(Boolean);
    if (!parts.length) continue;
    const top = prefix ? parts.slice(prefix.split("/").filter(Boolean).length) : parts;
    if (!top.length) continue;
    const node = top[0];
    const key = prefix ? `${prefix}/${node}` : node;
    if (seen.has(key)) continue;
    seen.add(key);
    const isDir = line.endsWith("/") || filtered.some((l) => l.startsWith(`${line}/`));
    entries.push({
      path: key,
      name: node,
      type: isDir ? "dir" : "file",
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  emit({ ok: true, archive: path.basename(archive), prefix: prefix || "/", entries: entries.slice(0, 500) });
}

export async function backupRestoreFile(domain, name, relPath) {
  const d = String(domain).trim().toLowerCase();
  const { user, home } = await resolveDomainUser(d);
  const archive = await resolveExistingBackup(home, d, name);
  if (!archive) fail(`Backup not found: ${name}`);
  const rel = safeRelativePath(relPath);
  if (!rel.startsWith("public_html/")) {
    fail("Clients may only restore files under public_html/");
  }
  const staging = `/tmp/qadbak-partial-${user}-${Date.now()}`;
  await mkdir(staging, { recursive: true });
  await exec("tar", ["-xzf", archive, "-C", staging, rel], { timeout: 300_000 });
  const src = path.join(staging, rel);
  if (!(await fileExists(src))) fail(`Path not in backup: ${rel}`);
  const dest = path.join(home, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  const st = await stat(src);
  if (st.isDirectory()) {
    await exec("rsync", ["-a", `${src}/`, `${dest}/`], { timeout: 300_000 });
  } else {
    await cp(src, dest);
  }
  await exec("chown", ["-R", `${user}:${user}`, path.join(home, "public_html")], {
    timeout: 120_000,
  }).catch(() => {});
  await rm(staging, { recursive: true, force: true });
  emit({ ok: true, restored: rel, archive: path.basename(archive) });
}

export async function backupRestoreDatabase(domain, name, dbName) {
  const d = String(domain).trim().toLowerCase();
  const { user, home } = await resolveDomainUser(d);
  const archive = await resolveExistingBackup(home, d, name);
  if (!archive) fail(`Backup not found: ${name}`);
  const db = String(dbName || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!db) fail("database name required");
  const prefix = `${user}_`;
  if (!db.startsWith(prefix) && db !== user.replace(/-/g, "_")) {
    fail("Database not owned by this domain");
  }
  const staging = `/tmp/qadbak-db-restore-${user}-${Date.now()}`;
  await mkdir(staging, { recursive: true });
  const sqlMember = `mysql/${db}.sql`;
  await exec("tar", ["-xzf", archive, "-C", staging, sqlMember], { timeout: 300_000 });
  const sqlPath = path.join(staging, sqlMember);
  if (!(await fileExists(sqlPath))) fail(`No dump for database ${db} in this backup`);
  await exec(
    "bash",
    ["-c", `mysql ${db} < ${JSON.stringify(sqlPath)}`],
    { timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
  );
  await rm(staging, { recursive: true, force: true });
  emit({ ok: true, database: db, archive: path.basename(archive) });
}
