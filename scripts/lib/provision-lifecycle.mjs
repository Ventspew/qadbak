import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { domainCreate } from "./provision-domain.mjs";
import {
  emit,
  fail,
  resolveDomainUser,
  loadRegistry,
  saveRegistry,
  fileExists,
  domainConfigDir,
  QADBAK_DIR,
  nginxCustomerConfPaths,
  writeJsonFileAtomic,
} from "./provisioning-common.mjs";

const exec = promisify(execFile);

async function setRegistryDisabled(domain, disabled) {
  const d = String(domain).toLowerCase();
  const rows = await loadRegistry();
  const idx = rows.findIndex((r) => String(r.name).toLowerCase() === d);
  if (idx < 0) return;
  rows[idx].disabled = disabled;
  await saveRegistry(rows);
}

async function otherEnabledDomainsShareUser(domain, user) {
  const d = String(domain).toLowerCase();
  const rows = await loadRegistry();
  return rows.some(
    (r) =>
      String(r.user) === user &&
      String(r.name).toLowerCase() !== d &&
      r.disabled !== true,
  );
}

export async function domainEnable(domain) {
  const { user } = await resolveDomainUser(domain);
  await exec("usermod", ["-U", user], { timeout: 15_000 }).catch(() => {});
  const { available, enabled } = nginxCustomerConfPaths(domain);
  await exec("ln", ["-sf", available, enabled], { timeout: 10_000 }).catch(() => {});
  try {
    await exec("nginx", ["-t"], { timeout: 15_000 });
    await exec("systemctl", ["reload", "nginx"], { timeout: 30_000 });
  } catch {
    /* */
  }
  await setRegistryDisabled(domain, false);
  emit({ ok: true, enabled: true });
}

export async function domainDisable(domain) {
  const { user } = await resolveDomainUser(domain);
  // Shared unix users (parent + subs) must stay unlocked so mail/SSH/FTP
  // on the other sites keep working. Only lock when this is the last enabled domain.
  if (!(await otherEnabledDomainsShareUser(domain, user))) {
    await exec("usermod", ["-L", user], { timeout: 15_000 }).catch(() => {});
  }
  const { enabled } = nginxCustomerConfPaths(domain);
  await exec("rm", ["-f", enabled], { timeout: 10_000 }).catch(() => {});
  try {
    await exec("systemctl", ["reload", "nginx"], { timeout: 30_000 });
  } catch {
    /* */
  }
  await setRegistryDisabled(domain, true);
  emit({ ok: true, enabled: false });
}

export async function domainValidate(domain) {
  const { user, home } = await resolveDomainUser(domain);
  const messages = [];
  let valid = true;
  try {
    await access(home);
    messages.push(`Home directory exists: ${home}`);
  } catch {
    valid = false;
    messages.push(`Missing home: ${home}`);
  }
  const pub = path.join(home, "public_html");
  if (await fileExists(pub)) {
    messages.push(`public_html present`);
  } else {
    messages.push(`public_html missing (optional)`);
  }
  const { enabled } = nginxCustomerConfPaths(domain);
  if (await fileExists(enabled)) {
    messages.push(`Nginx vhost enabled`);
  } else if (await fileExists(`/etc/apache2/sites-enabled/${domain}.conf`)) {
    messages.push(`Apache vhost present`);
  }
  const rows = await loadRegistry();
  const hit = rows.find((r) => String(r.name).toLowerCase() === domain.toLowerCase());
  if (hit?.disabled) {
    messages.push(`Domain marked disabled in registry`);
  }
  emit({ ok: true, valid, messages });
}

export async function domainClone(source, target, _pass) {
  const src = String(source).trim().toLowerCase();
  const tgt = String(target).trim().toLowerCase();
  if (!src || !tgt) fail("source and target domain required");
  if (src === tgt) fail("source and target must differ");

  const rows = await loadRegistry();
  const srow = rows.find((r) => String(r.name).toLowerCase() === src);
  if (!srow) fail(`Unknown source domain: ${src}`);
  if (rows.some((r) => String(r.name).toLowerCase() === tgt)) {
    fail(`Target domain already exists: ${tgt}`);
  }

  const plan = srow.plan || "Default";
  await domainCreate(tgt, "", "", JSON.stringify({ type: "top", plan }));

  const { home: srcHome } = await resolveDomainUser(src);
  const { home: dstHome } = await resolveDomainUser(tgt);
  const pubSrc = path.join(srcHome, "public_html");
  const pubDst = path.join(dstHome, "public_html");
  await mkdir(pubDst, { recursive: true });
  await exec(
    "rsync",
    ["-a", "--delete", `${pubSrc}/`, `${pubDst}/`],
    { timeout: 600_000 },
  );

  const srcCfg = domainConfigDir(src);
  const dstCfg = domainConfigDir(tgt);
  if (await fileExists(srcCfg)) {
    await cp(srcCfg, dstCfg, { recursive: true, force: true });
  }

  emit({ ok: true, domain: tgt, clonedFrom: src });
}

export async function domainMigrate(domain, destHost) {
  const d = String(domain).trim().toLowerCase();
  const host = String(destHost || "").trim();
  if (!d || !host) fail("domain and destHost required");

  const { user, home } = await resolveDomainUser(d);
  const dir = path.join(home, "backups");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archive = `${d}-migrate-to-${host.replace(/[^a-z0-9.-]/gi, "_")}-${stamp}.tar.gz`;
  const file = path.join(dir, archive);
  await exec(
    "tar",
    ["-czf", file, "-C", home, "public_html"],
    { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 },
  );
  await exec("chown", [`${user}:${user}`, file]);

  const messages = [
    `Backup: ${file}`,
    `Target: ${host}`,
    "1) Copy backup + Maildir/DNS zone to the target server",
    "2) On target: domain-create + restore files",
    "3) Update DNS A/AAAA to the new host",
    "legacy hosting API migrate-domain is not used in native mode.",
  ];
  emit({
    ok: true,
    domain: d,
    destHost: host,
    backup: archive,
    backupPath: file,
    messages,
  });
}

export async function domainTransfer(domain, newOwner) {
  const d = String(domain).trim().toLowerCase();
  const owner = String(newOwner || "").trim();
  if (!d || !owner) fail("domain and newOwner required");

  const rows = await loadRegistry();
  if (!rows.some((r) => String(r.name).toLowerCase() === d)) {
    fail(`Unknown domain: ${d}`);
  }

  const usersPath = path.join(QADBAK_DIR, "data", "users.json");
  const { readFile } = await import("node:fs/promises");
  let users;
  try {
    users = JSON.parse(await readFile(usersPath, "utf8"));
  } catch {
    fail("data/users.json missing");
  }
  if (!Array.isArray(users)) fail("invalid users.json");

  const target = users.find(
    (u) => String(u.username).toLowerCase() === owner.toLowerCase(),
  );
  if (!target) fail(`Panel user not found: ${owner}`);

  for (const u of users) {
    if (!Array.isArray(u.domains)) u.domains = [];
    u.domains = u.domains.filter((x) => String(x).toLowerCase() !== d);
  }
  if (!target.domains) target.domains = [];
  if (!target.domains.some((x) => String(x).toLowerCase() === d)) {
    target.domains.push(d);
  }
  await writeJsonFileAtomic(usersPath, users);
  emit({
    ok: true,
    domain: d,
    panelUser: target.username,
    note: "Panel access updated; unix system user unchanged.",
  });
}
