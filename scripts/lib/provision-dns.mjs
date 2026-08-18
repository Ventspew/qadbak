import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  emit,
  fail,
  resolveDomainUser,
  fileExists,
  loadRegistry,
  QADBAK_DIR,
} from "./provisioning-common.mjs";
import { validateDnsRecord } from "./validate-dns-record.mjs";
import { assertDomainName, escapeShellSingle } from "./security-utils.mjs";
import {
  deleteZoneText,
  mapNameFromParentZone,
  mapNameToParentZone,
  parseZone,
  subLabelForParent,
  upsertZoneText,
} from "./dns-zone-edit.mjs";

const exec = promisify(execFile);

async function zoneFromRegistry(domain) {
  const rows = await loadRegistry();
  const hit = rows.find((r) => String(r.name).toLowerCase() === domain.toLowerCase());
  return hit?.zoneFile || hit?.zonePath || null;
}

async function zoneFromLegacyHostCli(domain) {
  const bin = process.env.QADBAK_LEGACY_HOST_BIN?.trim();
  if (!bin) return null;
  try {
    const { stdout } = await exec(
      bin,
      ["list-domains", "--domain", domain, "--multiline"],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(?:DNS zone file|Zone file|Master file):\s*(.+)$/i);
      if (m?.[1]) {
        const p = m[1].trim();
        if (await fileExists(p)) return p;
      }
    }
  } catch {
    /* no CLI */
  }
  return null;
}

async function zoneFromNamedConf(domain) {
  const safeDomain = assertDomainName(domain);
  const zoneNeedle = `zone "${safeDomain}"`;
  const confs = [
    "/etc/bind/named.conf.local",
    "/etc/bind/named.conf",
    "/etc/named.conf",
  ];
  for (const conf of confs) {
    if (!(await fileExists(conf))) continue;
    const text = await readFile(conf, "utf8");
    const idx = text.indexOf(zoneNeedle);
    if (idx < 0) continue;
    const slice = text.slice(idx, idx + 4096);
    const fileIdx = slice.search(/\bfile\s+"/i);
    if (fileIdx < 0) continue;
    const after = slice.slice(fileIdx);
    const openQuote = after.indexOf('"');
    const closeQuote = openQuote >= 0 ? after.indexOf('"', openQuote + 1) : -1;
    if (closeQuote < 0) continue;
    let p = after.slice(openQuote + 1, closeQuote).trim();
    if (!p.startsWith("/")) p = path.join("/etc/bind", p);
    if (await fileExists(p)) return p;
  }
  return null;
}

async function zoneFromFind(domain) {
  const safeDomain = assertDomainName(domain);
  const names = [
    `${safeDomain}.hosts`,
    `${safeDomain}.host`,
    `${safeDomain}.zone`,
    safeDomain,
    `db.${safeDomain}`,
  ];
  try {
    const { stdout } = await exec(
      "bash",
      [
        "-c",
        `find /var/lib/bind /etc/bind -maxdepth 4 -type f \\( ${names.map((n) => `-name ${escapeShellSingle(n)}`).join(" -o ")} \\) 2>/dev/null | head -1`,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const p = stdout.trim().split("\n")[0];
    if (p && (await fileExists(p))) return p;
  } catch {
    /* */
  }
  return null;
}

export async function locateZonePath(domain) {
  const cached = await zoneFromRegistry(domain);
  if (cached && (await fileExists(cached))) return cached;

  const candidates = [
    `/var/lib/bind/${domain}.hosts`,
    `/var/lib/bind/${domain}.host`,
    `/var/lib/bind/${domain}`,
    `/var/lib/bind/db.${domain}`,
    `/etc/bind/${domain}.zone`,
    `/etc/bind/zones/${domain}`,
    `/etc/bind/domains/${domain}`,
    `/etc/bind/db.${domain}`,
  ];
  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }

  const vm = await zoneFromLegacyHostCli(domain);
  if (vm) return vm;

  const named = await zoneFromNamedConf(domain);
  if (named) return named;

  const found = await zoneFromFind(domain);
  if (found) return found;

  return null;
}

async function domainInRegistry(domain) {
  const rows = await loadRegistry();
  return rows.some((r) => String(r.name).toLowerCase() === domain.toLowerCase());
}

export async function dnsZoneContext(domain) {
  const want = String(domain || "")
    .trim()
    .toLowerCase();
  const rows = await loadRegistry();
  const hit = rows.find((r) => String(r.name).toLowerCase() === want);
  const type = String(hit?.type || "top").toLowerCase();
  if (type === "alias") {
    fail("Alias domains have no DNS zone. Use the parent domain.");
  }
  if (type === "sub" && hit?.parent) {
    const origin = String(hit.parent).toLowerCase();
    const label = subLabelForParent(want, origin);
    if (label) return { origin, label, type };
  }
  return { origin: want, label: "", type: type || "top" };
}

/** Create BIND zone for a panel domain (idempotent). Requires root (provisioning helper). */
export async function ensureBindZone(domain) {
  const existing = await locateZonePath(domain);
  if (existing) return existing;

  const script = path.join(QADBAK_DIR, "scripts", "create-bind-zone.sh");
  if (!(await fileExists(script))) {
    fail(`Missing ${script} — git pull Qadbak`);
  }
  await exec("bash", [script, domain], { timeout: 120_000 });

  const created = await locateZonePath(domain);
  if (!created) {
    fail(`BIND zone creation failed for ${domain}`);
  }
  return created;
}

export async function findZonePath(domain) {
  const hit = await locateZonePath(domain);
  if (hit) return hit;

  if (await domainInRegistry(domain)) {
    return ensureBindZone(domain);
  }

  fail(
    `No BIND zone file for ${domain}. Add the domain in the panel first, or run: sudo bash ${QADBAK_DIR}/scripts/create-bind-zone.sh ${domain}`,
  );
}

async function reloadZone(origin) {
  try {
    await exec("rndc", ["reload", origin], { timeout: 30_000 });
    return;
  } catch {
    /* try unscoped */
  }
  try {
    await exec("rndc", ["reload"], { timeout: 30_000 });
  } catch {
    await exec("systemctl", ["reload", "named"], { timeout: 30_000 }).catch(() => {});
  }
}

async function commitZone(zonePath, origin, nextText) {
  const tmp = `${zonePath}.qadbak-tmp`;
  await writeFile(tmp, nextText, "utf8");
  try {
    await exec("named-checkzone", [origin, tmp], { timeout: 15_000 });
  } catch (e) {
    await unlink(tmp).catch(() => {});
    const code = e && typeof e === "object" && "code" in e ? e.code : "";
    if (code === "ENOENT") {
      fail(
        `named-checkzone not installed — refusing to write ${origin} without a zone check`,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    fail(`Zone check failed for ${origin}: ${msg.slice(0, 400)}`);
  }
  await rename(tmp, zonePath);
  await reloadZone(origin);
}

export async function dnsGet(domain) {
  await resolveDomainUser(domain);
  const ctx = await dnsZoneContext(domain);
  const zonePath = await findZonePath(ctx.origin);
  const text = await readFile(zonePath, "utf8");
  let records = parseZone(text, ctx.origin);
  if (ctx.label) {
    records = records.flatMap((r) => {
      const name = mapNameFromParentZone(r.name, ctx.label);
      return name == null ? [] : [{ ...r, name }];
    });
  }
  emit({ ok: true, records, zonePath, origin: ctx.origin });
}

export async function dnsAdd(domain, record) {
  await resolveDomainUser(domain);
  const ctx = await dnsZoneContext(domain);
  const safe = validateDnsRecord({
    ...record,
    name: mapNameToParentZone(record?.name, ctx.label),
  });
  const zonePath = await findZonePath(ctx.origin);
  const text = await readFile(zonePath, "utf8");
  await commitZone(zonePath, ctx.origin, upsertZoneText(text, safe, ctx.origin));
  emit({ ok: true, zonePath });
}

export async function dnsDel(domain, record) {
  await resolveDomainUser(domain);
  const ctx = await dnsZoneContext(domain);
  const mapped = {
    ...record,
    name: mapNameToParentZone(record?.name, ctx.label),
  };
  const zonePath = await findZonePath(ctx.origin);
  const text = await readFile(zonePath, "utf8");
  await commitZone(zonePath, ctx.origin, deleteZoneText(text, mapped, ctx.origin));
  emit({ ok: true });
}
