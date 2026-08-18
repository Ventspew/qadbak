import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { access, mkdir, readdir, rm, cp } from "node:fs/promises";
import {
  discoverMailLayout,
  listMailboxesFromLayout,
  resolveMailboxMaildir,
} from "./mail-layout.mjs";

const exec = promisify(execFile);

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Relative path under domain home for a Maildir (or null if outside home). */
function relUnderHome(home, absMaildir) {
  const h = String(home || "").replace(/\/+$/, "");
  const a = String(absMaildir || "").replace(/\/+$/, "");
  if (!h || !a) return null;
  if (a === h) return "";
  if (!a.startsWith(`${h}/`)) return null;
  return a.slice(h.length + 1);
}

/**
 * All Maildir trees to include in a full backup.
 * @returns {{ entries: { rel: string, abs: string, user: string }[], accounts: { user: string, email: string, rel: string }[] }}
 */
export async function collectMailBackupEntries(domain, owner, home) {
  const layout = await discoverMailLayout(domain, owner, home);
  const mailboxes = await listMailboxesFromLayout(layout);
  const byRel = new Map();

  const add = (rel, abs, user) => {
    const r = String(rel || "").replace(/^\/+/, "");
    const a = String(abs || "").replace(/\/+$/, "");
    if (!r || !a || !(a.endsWith("/Maildir") || a.includes("/Maildir"))) return;
    if (!byRel.has(r)) byRel.set(r, { rel: r, abs: a, user });
  };

  const ownerMd = path.join(home, "Maildir");
  if (await fileExists(ownerMd)) {
    add("Maildir", ownerMd, owner);
  }

  for (const m of mailboxes) {
    const local = String(m.user || m.name || "").trim().toLowerCase();
    if (!local) continue;
    let abs;
    try {
      abs = await resolveMailboxMaildir(layout, local, owner, home);
    } catch {
      continue;
    }
    if (!(await fileExists(abs))) continue;

    const rel = relUnderHome(home, abs);
    if (rel === "Maildir" || rel?.endsWith("/Maildir")) {
      add(rel, abs, local);
    } else if (rel?.startsWith("homes/") && rel.endsWith("/Maildir")) {
      add(rel, abs, local);
    } else {
      add(`extra/${local}/Maildir`, abs, local);
    }
  }

  const entries = [...byRel.values()];
  const accounts = entries.map((e) => ({
    user: e.user,
    email: `${e.user}@${domain}`,
    rel: e.rel,
    abs: e.abs,
  }));

  return { entries, accounts, layout };
}

export async function backupMailToStaging(stagingMailRoot, domain, owner, home) {
  const { entries, accounts } = await collectMailBackupEntries(domain, owner, home);
  if (entries.length === 0) {
    return { included: false, accounts: [], entries: [] };
  }

  await mkdir(stagingMailRoot, { recursive: true });

  for (const { rel, abs } of entries) {
    const dest = path.join(stagingMailRoot, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await exec("cp", ["-a", abs, dest], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
  }

  return {
    included: true,
    accounts,
    entries: entries.map((e) => e.rel),
  };
}

/** Restore mail from staging (new layout mail/… or legacy Maildir at archive root). */
export async function restoreMailFromHome(home, staging, owner) {
  const restored = [];
  const legacyRoot = path.join(staging, "Maildir");
  const mailRoot = path.join(staging, "mail");

  async function chownMailboxPath(local, dest) {
    const who = local && local !== owner ? local : owner;
    await exec("chown", ["-R", `${who}:${owner}`, dest], { timeout: 120_000 }).catch(
      () => {},
    );
  }

  async function restoreTree(relPath, srcDir) {
    const rel = String(relPath || "").replace(/^\/+/, "");
    const dest =
      rel === "Maildir" || rel.endsWith("/Maildir")
        ? rel.startsWith("homes/")
          ? path.join(home, rel)
          : rel === "Maildir"
            ? path.join(home, "Maildir")
            : path.join(home, rel)
        : path.join(home, rel);

    await mkdir(path.dirname(dest), { recursive: true });
    await rm(dest, { recursive: true, force: true }).catch(() => {});
    await cp(srcDir, dest, { recursive: true });
    const mailboxLocal = rel.startsWith("homes/") ? rel.split("/")[1] : owner;
    await chownMailboxPath(mailboxLocal, dest);
    if (rel.startsWith("homes/")) {
      const parts = rel.split("/");
      if (parts.length >= 2) {
        await chownMailboxPath(parts[1], path.join(home, "homes", parts[1]));
      }
    }
    restored.push(rel);
  }

  if (await fileExists(legacyRoot)) {
    await restoreTree("Maildir", legacyRoot);
    return { restored, accounts: [] };
  }

  if (!(await fileExists(mailRoot))) {
    return { restored, accounts: [] };
  }

  const ownerMail = path.join(mailRoot, "Maildir");
  if (await fileExists(ownerMail)) {
    await restoreTree("Maildir", ownerMail);
  }

  const homesStaging = path.join(mailRoot, "homes");
  if (await fileExists(homesStaging)) {
    for (const name of await readdir(homesStaging)) {
      if (name.startsWith(".")) continue;
      const md = path.join(homesStaging, name, "Maildir");
      if (await fileExists(md)) {
        await restoreTree(`homes/${name}/Maildir`, md);
      }
    }
  }

  let accounts = [];
  const metaPath = path.join(staging, "mail-accounts.json");
  if (await fileExists(metaPath)) {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(metaPath, "utf8");
      const data = JSON.parse(raw);
      accounts = Array.isArray(data.accounts) ? data.accounts : [];
    } catch {
      /* */
    }
  }

  const extraStaging = path.join(mailRoot, "extra");
  if (await fileExists(extraStaging)) {
    for (const name of await readdir(extraStaging)) {
      if (name.startsWith(".")) continue;
      const md = path.join(extraStaging, name, "Maildir");
      if (!(await fileExists(md))) continue;

      const meta = accounts.find(
        (a) => String(a.user || "").toLowerCase() === name.toLowerCase(),
      );
      const absDest = meta?.abs ? String(meta.abs).replace(/\/+$/, "") : "";
      if (absDest && !absDest.startsWith(`${home}/`)) {
        await mkdir(path.dirname(absDest), { recursive: true });
        await rm(absDest, { recursive: true, force: true }).catch(() => {});
        await cp(md, absDest, { recursive: true });
        await exec("chown", ["-R", `${name}:${owner}`, absDest], {
          timeout: 120_000,
        }).catch(() => {});
        restored.push(absDest);
        continue;
      }

      const dest = path.join(home, "homes", name, "Maildir");
      await mkdir(path.dirname(dest), { recursive: true });
      await rm(dest, { recursive: true, force: true }).catch(() => {});
      await cp(md, dest, { recursive: true });
      await exec("chown", ["-R", `${name}:${owner}`, dest], { timeout: 120_000 }).catch(
        () => {},
      );
      restored.push(`homes/${name}/Maildir`);
    }
  }

  return { restored, accounts };
}
