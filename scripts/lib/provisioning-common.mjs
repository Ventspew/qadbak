#!/usr/bin/env node
import { readFile, access, writeFile, mkdir } from "node:fs/promises";
import { writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export const QADBAK_DIR = process.env.QADBAK_DIR || "/opt/qadbak";
const REGISTRY = path.join(QADBAK_DIR, "data", "native-domains.json");

export function emit(obj) {
  const line = `${JSON.stringify(obj)}\n`;
  try {
    writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

export function fail(message, code = 1) {
  emit({ ok: false, error: String(message) });
  process.exit(code);
}

/** Nginx config filenames use underscores (dots break batch cleanup on some hosts). */
export function nginxCustomerConfSlug(domain) {
  return String(domain).replace(/\./g, "_");
}

export function nginxCustomerConfPaths(domain) {
  const slug = nginxCustomerConfSlug(domain);
  return {
    available: `/etc/nginx/sites-available/qadbak-customer-${slug}.conf`,
    enabled: `/etc/nginx/sites-enabled/qadbak-customer-${slug}.conf`,
  };
}

export async function loadRegistry() {
  try {
    const raw = await readFile(REGISTRY, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function saveRegistry(rows) {
  await mkdir(path.dirname(REGISTRY), { recursive: true });
  await writeFile(REGISTRY, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

export function unixUserExists(name) {
  const user = String(name || "").trim();
  if (!user) return false;
  return spawnSync("id", ["-u", user], { stdio: "ignore" }).status === 0;
}

export async function resolveDomainUser(domain) {
  const d = String(domain || "").trim().toLowerCase();
  const rows = await loadRegistry();
  const hit = rows.find((r) => String(r.name).toLowerCase() === d);
  if (hit?.user) return { domain: d, user: hit.user, home: `/home/${hit.user}` };
  const base = d.split(".")[0]?.replace(/[^a-z0-9_-]/g, "") || "site";
  const home = `/home/${base}`;
  try {
    await access(home);
    return { domain: d, user: base, home };
  } catch {
    fail(`Unknown domain ${domain} — run export-native-domains.sh or domain-create`);
  }
}

export async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function domainConfigDir(domain) {
  return path.join(QADBAK_DIR, "data", "domain-config", String(domain).toLowerCase());
}

export async function readDomainConfigJson(domain, filename, fallback) {
  const p = path.join(domainConfigDir(domain), filename);
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeDomainConfigJson(domain, filename, data) {
  const dir = domainConfigDir(domain);
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, filename);
  await writeFile(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return p;
}
