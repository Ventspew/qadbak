import { readFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileExists } from "./provisioning-common.mjs";

const exec = promisify(execFile);

/** Qadbak-owned Postfix maps (hash format — avoids legacy hosting API path conflicts). */
export const QADBAK_POSTFIX_VIRTUAL = "/etc/postfix/qadbak-virtual";
export const QADBAK_POSTFIX_DOMAINS = "/etc/postfix/qadbak-domains";
export const QADBAK_POSTFIX_VMAILBOX = "/etc/postfix/qadbak-vmailbox";
export const QADBAK_POSTFIX_VMAILBOX_UID = "/etc/postfix/qadbak-vmailbox-uid";
export const QADBAK_POSTFIX_VMAILBOX_GID = "/etc/postfix/qadbak-vmailbox-gid";

/** @typedef {{ domain: string, owner: string, home: string, aliasMap?: string, mailboxMap?: string, mailboxBase?: string, homesDir?: string, primaryMaildir?: string }} MailLayout */

export async function discoverMailLayout(domain, owner, home) {
  const layout = {
    domain,
    owner,
    home,
    homesDir: undefined,
    primaryMaildir: undefined,
    aliasMap: undefined,
    mailboxMap: undefined,
    mailboxBase: undefined,
  };

  if (await fileExists(path.join(home, "Maildir"))) {
    layout.primaryMaildir = path.join(home, "Maildir");
  }
  const homesDir = path.join(home, "homes");
  if (await fileExists(homesDir)) {
    layout.homesDir = homesDir;
  }

  try {
    const { stdout } = await exec(
      "postconf",
      ["-n", "virtual_alias_maps", "virtual_mailbox_maps", "virtual_mailbox_base"],
      { timeout: 15_000 },
    );
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(\w+)\s*=\s*(.*)$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^hash:|^regexp:|^static:/, "");
      if (m[1] === "virtual_alias_maps" && val && !val.startsWith("$")) {
        layout.aliasMap = val.split(",")[0].trim();
      }
      if (m[1] === "virtual_mailbox_maps" && val && !val.startsWith("$")) {
        layout.mailboxMap = val.split(",")[0].trim();
      }
      if (m[1] === "virtual_mailbox_base") layout.mailboxBase = val;
    }
  } catch {
    /* postconf unavailable */
  }

  for (const candidate of [
    layout.mailboxMap,
    QADBAK_POSTFIX_VMAILBOX,
    layout.aliasMap,
    QADBAK_POSTFIX_VIRTUAL,
    "/etc/postfix/virtual",
    "/etc/postfix/vmailbox",
  ]) {
    if (candidate && (await fileExists(candidate))) {
      if (!layout.mailboxMap && (candidate === QADBAK_POSTFIX_VMAILBOX || candidate.includes("vmailbox"))) {
        layout.mailboxMap = candidate;
      }
      if (!layout.aliasMap && candidate !== QADBAK_POSTFIX_VMAILBOX) {
        layout.aliasMap = candidate;
      }
    }
  }

  return layout;
}

/** Parse hash: map source file (pre-postmap). */
export async function readMapFile(mapPath) {
  if (!(await fileExists(mapPath))) return [];
  const text = await readFile(mapPath, "utf8");
  const rows = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    rows.push({ address: parts[0], destination: parts.slice(1).join(" ") });
  }
  return rows;
}

export async function listMailboxesFromLayout(layout) {
  const domain = layout.domain;
  const mailboxes = [];
  const seen = new Set();

  const add = (user, real) => {
    const key = user.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mailboxes.push({
      user,
      name: user,
      real: real || user,
      email: `${user}@${domain}`,
    });
  };

  if (layout.primaryMaildir) {
    add(layout.owner, layout.owner);
  }

  if (layout.homesDir) {
    try {
      for (const name of await readdir(layout.homesDir)) {
        if (name.startsWith(".")) continue;
        const sub = path.join(layout.homesDir, name);
        try {
          await access(sub);
          add(name, name);
        } catch {
          /* */
        }
      }
    } catch {
      /* */
    }
  }

  if (layout.mailboxMap) {
    const rows = await readMapFile(layout.mailboxMap);
    for (const { address } of rows) {
      const addr = address.toLowerCase();
      if (!addr.endsWith(`@${domain}`)) continue;
      const local = addr.split("@")[0];
      if (local) add(local, local);
    }
  }

  return mailboxes;
}

export async function writeVirtualMapFile(mapPath, rows) {
  const body = rows
    .map(({ address, destination }) => `${address}\t${destination}\n`)
    .join("");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(mapPath, body, "utf8");
}

export async function appendMapEntry(mapPath, address, destination) {
  const rows = await readMapFile(mapPath);
  const needle = address.toLowerCase();
  const filtered = rows.filter((r) => r.address.toLowerCase() !== needle);
  filtered.push({ address, destination });
  const body = filtered.map((r) => `${r.address}\t${r.destination}\n`).join("");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(mapPath, body, "utf8");
}

export async function removeMapEntry(mapPath, address) {
  const rows = await readMapFile(mapPath);
  const needle = address.toLowerCase();
  const filtered = rows.filter((r) => r.address.toLowerCase() !== needle);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    mapPath,
    filtered.map((r) => `${r.address}\t${r.destination}\n`).join(""),
    "utf8",
  );
}

export async function postmapReload(mapPath) {
  await exec("postmap", [mapPath], { timeout: 30_000 });
  await reloadPostfix();
}

export async function postmapReloadAll() {
  for (const mapPath of [
    QADBAK_POSTFIX_VIRTUAL,
    QADBAK_POSTFIX_DOMAINS,
    QADBAK_POSTFIX_VMAILBOX,
    QADBAK_POSTFIX_VMAILBOX_UID,
    QADBAK_POSTFIX_VMAILBOX_GID,
  ]) {
    if (await fileExists(mapPath)) {
      await exec("postmap", [mapPath], { timeout: 30_000 });
    }
  }
  await reloadPostfix();
}

async function reloadPostfix() {
  try {
    await exec("systemctl", ["reload", "postfix"], { timeout: 30_000 });
  } catch {
    await exec("postfix", ["reload"], { timeout: 30_000 }).catch(() => {});
  }
}

/** Enable hash:qadbak-virtual when the map has rows (catch-all / forwards). */
export async function ensureVirtualAliasMapsEnabled() {
  const rows = await readMapFile(QADBAK_POSTFIX_VIRTUAL);
  const has = rows.some((r) => r.address?.trim() && r.destination?.trim());
  if (!has) {
    try {
      await exec("postconf", ["-X", "virtual_alias_maps"], { timeout: 15_000 });
    } catch {
      /* */
    }
    return false;
  }
  await exec(
    "postconf",
    ["-e", `virtual_alias_maps = hash:${QADBAK_POSTFIX_VIRTUAL}`],
    { timeout: 15_000 },
  );
  return true;
}

/** Write virtual_mailbox_domains hash source: "domain.tld OK" per line. */
export async function writeVirtualDomainsFile(domains) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir("/etc/postfix", { recursive: true }).catch(() => {});
  const body = domains.map((d) => `${d} OK\n`).join("");
  await writeFile(QADBAK_POSTFIX_DOMAINS, body, "utf8");
  await exec("postmap", [QADBAK_POSTFIX_DOMAINS], { timeout: 30_000 });
}

export async function ensureMaildir(dir, unixUser) {
  const { mkdir } = await import("node:fs/promises");
  for (const sub of ["cur", "new", "tmp"]) {
    await mkdir(path.join(dir, sub), { recursive: true });
  }
  if (unixUser) await chownMaildirTree(dir, unixUser);
}

/**
 * Only Maildir trees (INBOX or .Sent / .Drafts / …). Never /home/<domain-user>
 * — extra mailboxes under homes/ keep their own UIDs.
 */
export function isSafeMaildirChownPath(dir) {
  const d = path.resolve(String(dir || ""));
  if (!d.startsWith("/home/")) return false;
  const parts = d.split("/").filter(Boolean);
  if (parts.length < 3) return false;
  return parts.includes("Maildir");
}

/** chown a Maildir folder to the mailbox unix user (not the domain account home). */
export async function chownMaildirTree(dir, unixUser) {
  const u = String(unixUser || "").trim();
  const d = path.resolve(String(dir || ""));
  if (!u || !isSafeMaildirChownPath(d)) return;
  const ids = await resolveUnixIds(u);
  if (!ids) return;
  let group = ids.gid;
  try {
    const { stdout } = await exec("id", ["-gn", u], { timeout: 5000 });
    if (stdout.trim()) group = stdout.trim();
  } catch {
    /* numeric gid */
  }
  await exec("chown", ["-R", `${u}:${group}`, d], { timeout: 60_000 }).catch(() => {});
  await exec("chmod", ["-R", "u+rwX,g+rwX", d], { timeout: 60_000 }).catch(() => {});
}

/** Unix account that Dovecot uses for this mailbox (local user if it exists). */
export async function resolveMailboxUnixUser(localPart, owner) {
  const local = String(localPart || "").trim();
  const own = String(owner || "").trim();
  if (local && (await resolveUnixIds(local))) return local;
  return own;
}

/** uid/gid/home from /etc/passwd. */
export async function resolveUnixIds(username) {
  const u = String(username || "").trim();
  if (!u) return null;
  try {
    const { stdout } = await exec("getent", ["passwd", u], { timeout: 5000 });
    const p = stdout.trim().split(":");
    if (p.length < 7) return null;
    return { uid: p[2], gid: p[3], home: p[5] };
  } catch {
    return null;
  }
}

export async function resolveUnixHome(username) {
  const ids = await resolveUnixIds(username);
  return ids?.home || null;
}

/** Postfix virtual_mailbox_maps path relative to virtual_mailbox_base=/ */
export function toPostfixVmailboxPath(absoluteMaildir) {
  return `${String(absoluteMaildir).replace(/\/+$/, "").replace(/^\//, "")}/`;
}

/** Resolve on-disk Maildir from a qadbak-vmailbox map value (relative or legacy absolute). */
export function fromPostfixVmailboxPath(vmailboxPath) {
  const rel = String(vmailboxPath || "").trim().replace(/\/+$/, "");
  if (!rel) return "";
  return rel.startsWith("/") ? rel : `/${rel.replace(/^\//, "")}`;
}

/** Maildir path for a mailbox — prefers Postfix vmailbox map, then passwd home. */
export async function resolveMailboxMaildir(layout, localPart, owner, ownerHome) {
  const local = String(localPart || owner).trim().toLowerCase();
  const domain = String(layout.domain || "").toLowerCase();
  const email = local && domain ? `${local}@${domain}` : "";

  const mapPaths = [
    layout.mailboxMap,
    QADBAK_POSTFIX_VMAILBOX,
    "/etc/postfix/vmailbox",
  ].filter(Boolean);

  if (email) {
    for (const mapPath of mapPaths) {
      if (!(await fileExists(mapPath))) continue;
      const rows = await readMapFile(mapPath);
      for (const { address, destination } of rows) {
        if (address.toLowerCase() !== email) continue;
        const abs = fromPostfixVmailboxPath(destination);
        if (abs && (await fileExists(abs))) {
          return abs.replace(/\/+$/, "") || abs;
        }
      }
    }
  }

  const home = ownerHome || layout.home || `/home/${owner}`;
  if (!local || local === owner) {
    const ownerUnixHome = (await resolveUnixHome(owner)) || home;
    return layout.primaryMaildir || path.join(ownerUnixHome, "Maildir");
  }
  const unixHome = await resolveUnixHome(local);
  if (unixHome) return path.join(unixHome, "Maildir");
  const homes = layout.homesDir || path.join(home, "homes");
  return path.join(homes, local, "Maildir");
}
