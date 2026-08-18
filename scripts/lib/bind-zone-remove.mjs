import { readFile, writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileExists, loadRegistry, QADBAK_DIR } from "./provisioning-common.mjs";

const exec = promisify(execFile);

const NAMED_LOCAL = "/etc/bind/named.conf.local";

export function isQadbakZoneFile(domain, filePath) {
  const p = String(filePath || "");
  const d = String(domain || "");
  if (!p || !d) return false;
  return (
    p === `/var/lib/bind/${d}.hosts` ||
    p === `/var/lib/bind/${d}.host` ||
    p === `/var/lib/bind/${d}` ||
    p === `/var/lib/bind/db.${d}` ||
    p === `/etc/bind/zones/${d}` ||
    p === `/etc/bind/zones/db.${d}` ||
    p === `/etc/bind/${d}.zone` ||
    p === `/etc/bind/db.${d}` ||
    p.startsWith(`${QADBAK_DIR}/`)
  );
}

/** Remove `zone "name" { ... };` from named.conf.local text. */
export function stripNamedZoneBlock(text, domain) {
  const want = String(domain || "").toLowerCase();
  const re = /zone\s+"([^"]+)"\s*\{/gi;
  let out = "";
  let last = 0;
  let m;
  const src = String(text || "");
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    const start = m.index;
    if (name !== want) continue;
    let i = src.indexOf("{", start);
    if (i < 0) continue;
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          let end = i + 1;
          if (src[end] === ";") end++;
          while (src[end] === "\n" || src[end] === "\r") end++;
          out += src.slice(last, start);
          last = end;
          break;
        }
      }
    }
  }
  out += src.slice(last);
  return out;
}

export function listNamedLocalZones(text) {
  const rows = [];
  const re = /zone\s+"([^"]+)"\s*\{([\s\S]*?)\n\};/g;
  let m;
  const src = String(text || "");
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    const body = m[2];
    const fm = body.match(/\bfile\s+"([^"]+)"/i);
    rows.push({ name, file: fm?.[1] || "" });
  }
  return rows;
}

async function reloadNamed() {
  try {
    await exec("rndc", ["reload"], { timeout: 30_000 });
  } catch {
    await exec("systemctl", ["reload", "named"], { timeout: 30_000 }).catch(() => {});
    await exec("systemctl", ["reload", "bind9"], { timeout: 30_000 }).catch(() => {});
  }
}

export async function removeBindZone(domain) {
  const name = String(domain || "").trim().toLowerCase();
  if (!name) return { removed: false };
  const filePath = `/var/lib/bind/${name}.hosts`;

  let listedFile = "";
  let stripped = false;
  if (await fileExists(NAMED_LOCAL)) {
    const text = await readFile(NAMED_LOCAL, "utf8");
    const listed = listNamedLocalZones(text).find((z) => z.name === name);
    listedFile = listed?.file || "";
    if (listedFile && !isQadbakZoneFile(name, listedFile)) {
      return { removed: false, skipped: "not-qadbak-zone", file: listedFile };
    }
    const next = stripNamedZoneBlock(text, name);
    if (next !== text) {
      await writeFile(NAMED_LOCAL, next, "utf8");
      stripped = true;
    }
  }

  let deletedFile = false;
  const candidates = [
    listedFile,
    filePath,
    `/var/lib/bind/${name}.host`,
    `/var/lib/bind/db.${name}`,
    `/etc/bind/zones/db.${name}`,
    `/etc/bind/zones/${name}`,
    `/etc/bind/${name}.zone`,
  ].filter(Boolean);
  for (const p of [...new Set(candidates)]) {
    if (!isQadbakZoneFile(name, p)) continue;
    if (await fileExists(p)) {
      await unlink(p);
      deletedFile = true;
    }
  }

  if (stripped || deletedFile) await reloadNamed();
  return { removed: stripped || deletedFile, file: listedFile || filePath };
}

function isChildOf(name, parent) {
  return name.endsWith(`.${parent}`) && name !== parent;
}

/**
 * Delete BIND master zones Qadbak created that no longer belong:
 * - name not in the panel registry
 * - name is a panel subdomain (type=sub) that still has its own zone file
 */
export async function pruneOrphanBindChildZones() {
  const rows = await loadRegistry();
  const byName = new Map(
    rows.map((r) => [String(r.name || "").toLowerCase(), r]),
  );
  const tops = rows
    .filter((r) => String(r.type || "top").toLowerCase() === "top")
    .map((r) => String(r.name || "").toLowerCase())
    .filter(Boolean);

  let text = "";
  if (await fileExists(NAMED_LOCAL)) {
    text = await readFile(NAMED_LOCAL, "utf8");
  }
  const zones = listNamedLocalZones(text);
  const pruned = [];

  for (const z of zones) {
    if (!isQadbakZoneFile(z.name, z.file)) continue;
    const hit = byName.get(z.name);
    const type = String(hit?.type || "").toLowerCase();
    const orphanNotInPanel = !hit;
    const orphanSubHasOwnZone = type === "sub" || type === "alias";
    const childOfTop =
      !hit && tops.some((t) => isChildOf(z.name, t));
    if (orphanNotInPanel || orphanSubHasOwnZone || childOfTop) {
      await removeBindZone(z.name);
      pruned.push(z.name);
    }
  }

  return { pruned };
}
