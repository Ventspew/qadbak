import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import {
  emit,
  fail,
  loadRegistry,
  saveRegistry,
  domainConfigDir,
  readDomainConfigJson,
  writeDomainConfigJson,
  QADBAK_DIR,
  nginxCustomerConfPaths,
} from "./provisioning-common.mjs";
import { ensureDomainMailSetup, ensureNativeMailStack } from "./mail-sync.mjs";
import { dnsAdd, ensureBindZone, locateZonePath } from "./provision-dns.mjs";
import { pruneOrphanBindChildZones, removeBindZone } from "./bind-zone-remove.mjs";
import { parseZone } from "./dns-zone-edit.mjs";
import { jstep, jinfo } from "./journal-emit.mjs";
import { chpasswdSafe } from "./chpasswd-safe.mjs";
import { syncPhpFpmAndNginx } from "./provision-php.mjs";
import { applyOsDiskQuota } from "./os-disk-quota.mjs";
import { syncDovecotQuota } from "./dovecot-quota.mjs";

const exec = promisify(execFile);

function defaultUser(domain) {
  return (domain.split(".")[0] ?? "site")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32) || "site";
}

function parseOpts(extraJson) {
  if (!extraJson) return {};
  try {
    const o = JSON.parse(extraJson);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

async function reloadNginx(domain, user) {
  const script = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  await exec("bash", [script, domain, user], { timeout: 120_000 });
}

async function writeLandingPage(home, user, domain) {
  const script = path.join(QADBAK_DIR, "scripts", "lib", "qadbak-landing-html.sh");
  await exec(
    "bash",
    ["-c", `source "${script}" && write_qadbak_landing "${home}/public_html" "${domain}" "${user}:${user}"`],
    { timeout: 30_000 },
  ).catch(() => {});
}

async function ensureUnixUser(user) {
  try {
    await exec("id", [user]);
    return false;
  } catch {
    /* create below */
  }
  const baseArgs = ["-m", "-s", "/bin/bash"];
  try {
    await exec("useradd", [...baseArgs, user]);
    return true;
  } catch (e1) {
    const msg = e1 instanceof Error ? e1.message : String(e1);
    if (/group .* exists/i.test(msg)) {
      await exec("useradd", [...baseArgs, "-g", user, user]);
      return true;
    }
    throw e1;
  }
}

export async function domainCreate(domain, pass, userOpt, extraJson) {
  const name = String(domain).trim().toLowerCase();
  const opts = parseOpts(extraJson);
  const type = String(opts.type || "top").toLowerCase();
  const parent = String(opts.parent || "").trim().toLowerCase();
  const plan = String(opts.plan || "Default").trim() || "Default";

  const rows = await loadRegistry();
  if (rows.some((r) => r.name === name)) fail(`Domain already exists: ${name}`);

  let user = userOpt?.trim() || defaultUser(name);
  let parentUser = null;

  if (type === "sub" || type === "alias") {
    if (!parent) fail("parent domain required for sub/alias.");
    const prow = rows.find((r) => r.name === parent);
    if (!prow?.user) fail(`Unknown parent domain: ${parent}`);
    parentUser = prow.user;
    if (type === "alias") user = parentUser;
    else if (!userOpt?.trim()) user = parentUser;
  }

  const home = `/home/${user}`;
  const ownedByQadbak = type === "top" || (type === "sub" && user !== parentUser);

  jinfo(`Resolved domain '${name}' (type=${type}, user=${user})`);

  if (ownedByQadbak) {
    const t0 = Date.now();
    const userExisted = !(await ensureUnixUser(user));
    if (!userExisted) {
      jstep("shell", `Created unix user '${user}'`, {
        command: `useradd -m -s /bin/bash ${user}`,
        durationMs: Date.now() - t0,
      });
      if (pass) {
        await chpasswdSafe(user, pass);
        jstep("shell", `Set unix password for '${user}'`);
      }
    } else {
      jinfo(`Unix user '${user}' already existed`);
    }
    await mkdir(path.join(home, "public_html"), { recursive: true });
    await mkdir(path.join(home, "backups"), { recursive: true });
    jstep("file-write", `Created ${home}/public_html and ${home}/backups`, {
      filePath: home,
    });
    await writeFile(path.join(home, ".qadbak-domain"), `${name}\n`, "utf8");
    jstep("file-write", `Wrote ${home}/.qadbak-domain`, {
      filePath: `${home}/.qadbak-domain`,
      byteSize: name.length + 1,
    });
    await exec("chown", ["-R", `${user}:${user}`, path.join(home, "public_html")]);
    await exec("chown", ["-R", `${user}:${user}`, path.join(home, "backups")]);
    await exec("chown", [`${user}:${user}`, path.join(home, ".qadbak-domain")]).catch(() => {});
    jstep("shell", `Took ownership of public_html and backups for ${user}`, {
      command: `chown ${user}:${user} public_html backups`,
    });
    await writeLandingPage(home, user, name);
    jinfo(`Wrote Qadbak landing page in ${home}/public_html`);
  }

  if (type === "alias" && parentUser) {
    await reloadNginx(name, parentUser);
  } else {
    await reloadNginx(name, user);
  }
  jstep("service-reload", `Applied nginx vhost for ${name}`, {
    command: `bash scripts/apply-domain-nginx.sh ${name} ${user}`,
    filePath: `/etc/nginx/sites-available/qadbak-customer-${name.replace(/\./g, "_")}.conf`,
  });

  const resellerTag = String(opts.reseller || "").trim();
  rows.push({
    name,
    user,
    disabled: false,
    plan,
    type,
    parent: parent || undefined,
    ...(resellerTag ? { reseller: resellerTag } : {}),
    isDefault: rows.length === 0,
  });
  await saveRegistry(rows);
  jstep("file-write", `Added '${name}' to native-domains.json registry`, {
    filePath: `${QADBAK_DIR}/data/native-domains.json`,
  });

  if (type === "top") {
    try {
      await ensureBindZone(name);
      jstep("service-reload", `Created BIND9 zone for ${name}`, {
        filePath: `/etc/bind/zones/db.${name}`,
      });
    } catch (e) {
      jinfo(
        `WARN: BIND zone for ${name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else if (type === "sub" && parent) {
    const label = name.endsWith(`.${parent}`)
      ? name.slice(0, -(parent.length + 1))
      : name.split(".")[0];
    let originIp = process.env.QADBAK_ORIGIN_IP?.trim() || "";
    if (!originIp) {
      try {
        const zonePath = await locateZonePath(parent);
        if (zonePath) {
          const recs = parseZone(await readFile(zonePath, "utf8"), parent);
          const apex = recs.find(
            (r) => r.name === "@" && String(r.type).toUpperCase() === "A",
          );
          originIp = String(apex?.value || "").trim();
        }
      } catch {
        originIp = "";
      }
    }
    if (originIp && label) {
      try {
        await dnsAdd(parent, { name: label, type: "A", value: originIp });
        jstep("service-reload", `Added ${label} A on parent zone ${parent}`, {
          filePath: `/etc/bind/zones/db.${parent}`,
        });
      } catch (e) {
        jinfo(
          `WARN: could not add ${label} A on ${parent}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      jinfo(`Skipped parent-zone A for ${name} (no origin IP)`);
    }
    try {
      await removeBindZone(name);
      jinfo(`Removed leftover child BIND zone for ${name} (uses parent ${parent})`);
    } catch {
      /* no child zone */
    }
  }

  if (ownedByQadbak && type !== "alias") {
    await writeDomainConfigJson(name, "php.json", {
      defaultVersion: "8.2",
      directories: [{ dir: "public_html", version: "8.2", mode: "fpm" }],
    });
    jstep("file-write", `Wrote per-domain PHP config (8.2 + FPM)`, {
      filePath: `${QADBAK_DIR}/data/domain-config/${name}/php.json`,
    });
    try {
      await syncPhpFpmAndNginx(name);
      jstep("service-reload", `Applied PHP-FPM pool(s) for ${name}`, {
        command: `php-sync-fpm ${name}`,
      });
    } catch (e) {
      jinfo(
        `WARN: PHP-FPM sync for ${name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (type !== "alias") {
    await ensureNativeMailStack();
    await ensureDomainMailSetup(name, user);
    jstep("service-reload", `Configured Postfix + Dovecot for ${name}`, {
      command: `mail-sync (Postfix virtual maps + Dovecot LDA for ${name})`,
    });
  }

  if (ownedByQadbak && type !== "alias") {
    const repairScript = path.join(QADBAK_DIR, "scripts", "fix-domain-website.sh");
    try {
      const t0 = Date.now();
      const { stdout, stderr } = await exec("bash", [repairScript, name], {
        timeout: 300_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      jstep("shell", `Website live for ${name} (fix-domain-website)`, {
        command: `fix-domain-website.sh ${name}`,
        durationMs: Date.now() - t0,
        output: [stdout, stderr].filter(Boolean).join("\n"),
      });
    } catch (err) {
      const message = err?.stderr || err?.stdout || err?.message || String(err);
      jstep("shell", `fix-domain-website.sh non-fatal failure for ${name}`, {
        command: `fix-domain-website.sh ${name}`,
        ok: false,
        output: message,
        errorMessage:
          "Website repair failed during create — use Overview → Repair or: " +
          `sudo bash ${repairScript} ${name}`,
      });
    }
  }

  await bootstrapDomainServices(name, type);

  emit({ ok: true, domain: name, user, home, type, parent: parent || null, plan });
}

async function bootstrapDomainServices(name, type) {
  if (type === "alias") return;
  try {
    const { setupBackupSchedule } = await import("./provision-backup.mjs");
    await setupBackupSchedule(name, { forceEnable: true, runIfStale: true });
    jinfo(`Automatic backup enabled for ${name}`);
  } catch (err) {
    jstep("shell", `Backup schedule setup non-fatal for ${name}`, {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const { sslIssue } = await import("./provision-ssl.mjs");
    await sslIssue(name, name);
    jinfo(`SSL certificate requested for ${name}`);
  } catch (err) {
    jstep("shell", `SSL issue non-fatal for ${name} (DNS may not be live yet)`, {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

async function removeApacheVhostForDomain(domain) {
  const name = String(domain).trim().toLowerCase();
  const candidates = new Set([
    `/etc/apache2/sites-available/qadbak-${name}.conf`,
  ]);
  try {
    const { stdout } = await exec("bash", [
      "-c",
      `grep -rl 'ServerName[[:space:]].*${name}' /etc/apache2/sites-available/ 2>/dev/null || true`,
    ]);
    for (const line of stdout.split("\n")) {
      const p = line.trim();
      if (p) candidates.add(p);
    }
  } catch {
    /* no matches */
  }
  for (const conf of candidates) {
    try {
      const base = path.basename(conf);
      await exec("a2dissite", [base]).catch(() => {});
      await exec("rm", ["-f", conf, `/etc/apache2/sites-enabled/${base}`]).catch(() => {});
    } catch {
      /* */
    }
  }
  await exec("apache2ctl", ["configtest"]).catch(() => {});
  await exec("systemctl", ["reload", "apache2"]).catch(() => {});
}

export async function domainDelete(domain) {
  const name = String(domain).trim().toLowerCase();
  const rows = await loadRegistry();
  const hit = rows.find((r) => r.name === name);
  const user = hit?.user ?? defaultUser(name);

  await removeApacheVhostForDomain(name);

  const { available, enabled } = nginxCustomerConfPaths(name);
  await exec("rm", ["-f", enabled, available]).catch(() => {});
  await exec("rm", ["-f", `/etc/nginx/qadbak-php/${name.replace(/\./g, "_")}.conf`]).catch(
    () => {},
  );
  const othersShareUser = rows.some(
    (r) => r.name !== name && String(r.user) === String(user),
  );
  if (!othersShareUser) {
    const removePool = path.join(QADBAK_DIR, "scripts", "remove-php-fpm-pool.sh");
    await exec("bash", [removePool, user], { timeout: 60_000 }).catch(() => {});
  }

  const cfgDir = domainConfigDir(name);
  await rm(cfgDir, { recursive: true, force: true }).catch(() => {});

  const marker = `/home/${user}/.qadbak-domain`;
  try {
    const { stdout } = await exec("cat", [marker]);
    if (stdout.trim() === name) {
      await exec("userdel", ["-r", user]).catch(() => {});
    }
  } catch {
    /* no marker — keep unix user */
  }

  try {
    await exec("nginx", ["-t"]);
    await exec("systemctl", ["reload", "nginx"]);
  } catch {
    /* */
  }

  await saveRegistry(rows.filter((r) => r.name !== name));
  try {
    await removeBindZone(name);
  } catch {
    /* */
  }
  try {
    await pruneOrphanBindChildZones();
  } catch {
    /* */
  }
  if (othersShareUser) {
    try {
      await applyOsDiskQuota(user);
    } catch {
      /* */
    }
  }
  try {
    await syncDovecotQuota();
  } catch {
    /* */
  }
  emit({ ok: true, domain: name, user, removedUser: true });
}
