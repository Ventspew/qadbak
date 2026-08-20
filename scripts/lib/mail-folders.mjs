/**
 * Standard IMAP folders for Qadbak webmail (Roundcube-style set).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import {
  discoverMailLayout,
  ensureMaildir,
  resolveMailboxMaildir,
  resolveMailboxUnixUser,
  chownMaildirTree,
  listMailboxesFromLayout,
} from "./mail-layout.mjs";
import { doveadmAvailable } from "./doveadm-util.mjs";
import { fileExists, resolveDomainUser } from "./provisioning-common.mjs";
import {
  authUserCandidates,
  resolveDovecotAuthUser,
} from "./dovecot-imap.mjs";

const exec = promisify(execFile);

/** Display order for webmail sidebar */
export const STANDARD_MAILBOX_FOLDERS = [
  "INBOX",
  "Sent",
  "Drafts",
  "Archive",
  "Junk",
  "Trash",
];

const FOLDER_ALIASES = {
  spam: "Junk",
  junk: "Junk",
  deleted: "Trash",
  trash: "Trash",
  "sent messages": "Sent",
  "sent items": "Sent",
  drafts: "Drafts",
  archive: "Archive",
  inbox: "INBOX",
};

/** Normalize Dovecot / Maildir folder names to our standard set. */
export function canonicalFolderName(name) {
  const raw = String(name || "").trim();
  if (!raw || raw === ".") return "INBOX";
  let f = raw.replace(/^INBOX[./]/i, "").replace(/^\//, "").trim();
  if (f.startsWith(".")) f = f.slice(1);
  if (!f) return "INBOX";
  const key = f.toLowerCase();
  return FOLDER_ALIASES[key] ?? f;
}

/** Dovecot maildir++ path for a standard subfolder (e.g. .Sent). */
export function maildirSubfolderPath(maildirRoot, folderName) {
  const f = String(folderName || "").trim();
  if (!f || f === "INBOX") return maildirRoot;
  if (f.startsWith(".")) return path.join(maildirRoot, f);
  return path.join(maildirRoot, `.${f}`);
}

/** Resolve on-disk Maildir path for a canonical folder name. */
export async function resolveFolderMaildirPath(maildirRoot, folder) {
  const canon = canonicalFolderName(folder);
  if (canon === "INBOX") return maildirRoot;

  const candidates = [
    maildirSubfolderPath(maildirRoot, canon),
    path.join(maildirRoot, canon),
    path.join(maildirRoot, "INBOX", canon),
  ];

  for (const p of candidates) {
    for (const sub of ["cur", "new", "tmp"]) {
      if (await fileExists(path.join(p, sub))) return p;
    }
  }

  const preferred = maildirSubfolderPath(maildirRoot, canon);
  const inferred = String(maildirRoot || "").match(
    /^\/home\/[^/]+\/homes\/([^/]+)\/Maildir\/?$/,
  );
  const ownerInbox = String(maildirRoot || "").match(/^\/home\/([^/]+)\/Maildir\/?$/);
  await ensureMaildir(preferred, inferred?.[1] || ownerInbox?.[1] || "");
  return preferred;
}

async function listDovecotMailboxNames(authUser) {
  try {
    const { stdout } = await exec(
      "doveadm",
      ["-f", "tab", "mailbox", "list", "-u", authUser],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const names = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^mailbox$/i.test(l));
    if (names.length) return names;
  } catch {
    /* */
  }
  try {
    const { stdout } = await exec(
      "doveadm",
      ["mailbox", "list", "-u", authUser],
      { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Map canonical folder (Sent, Drafts) to Dovecot mailbox name. */
export async function resolveDovecotMailboxName(authUser, canonical) {
  const want = canonicalFolderName(canonical);
  if (want === "INBOX") return "INBOX";
  if (!(await doveadmAvailable())) return want;

  const names = await listDovecotMailboxNames(authUser);
  if (!names.length) return want;

  for (const n of names) {
    if (canonicalFolderName(n) === want) return n;
  }
  for (const n of names) {
    const lower = n.toLowerCase();
    if (lower === want.toLowerCase() || lower.endsWith(`.${want.toLowerCase()}`)) {
      return n;
    }
  }
  return want;
}

async function resolveImapAuth(domain, localUser) {
  const local = String(localUser || "").trim().toLowerCase();
  if (!local) return { authUser: null, maildir: null };

  const { user: owner, home } = await resolveDomainUser(domain);
  const layout = await discoverMailLayout(domain, owner, home);
  const layoutUsers = await listMailboxesFromLayout(layout);
  const candidates = authUserCandidates(
    domain,
    local,
    owner,
    layoutUsers.map((m) => ({ user: m.user })),
  );

  let authUser = `${local}@${domain}`;
  if (await doveadmAvailable()) {
    const resolved = await resolveDovecotAuthUser(candidates);
    if (resolved) authUser = resolved;
  }

  const maildir = await resolveMailboxMaildir(layout, local, owner, home);
  return { authUser, maildir, layout, owner, home };
}

/**
 * Save a raw RFC822 message into a standard folder (Sent, Drafts, …).
 * @returns {{ ok: boolean, mailbox?: string, source?: string, error?: string }}
 */
export async function saveMailToFolder(domain, localUser, folderCanonical, rawMessage) {
  const local = String(localUser || "").trim().toLowerCase();
  if (!local) return { ok: false, error: "Missing mailbox user" };

  try {
    const { authUser, maildir, owner } = await resolveImapAuth(domain, local);
    const canon = canonicalFolderName(folderCanonical);
    const unixUser = await resolveMailboxUnixUser(local, owner);

    await ensureStandardMailboxes({
      authUser,
      maildirRoot: maildir,
      unixUser,
      useDoveadm: await doveadmAvailable(),
    });
    if (maildir) await chownMaildirTree(maildir, unixUser);

    const mailbox = authUser
      ? await resolveDovecotMailboxName(authUser, canon)
      : canon;

    if (authUser && (await doveadmAvailable())) {
      const tmp = path.join(
        "/tmp",
        `qadbak-save-${randomBytes(6).toString("hex")}.eml`,
      );
      await writeFile(tmp, rawMessage);
      try {
        await exec("doveadm", ["save", "-u", authUser, "-m", mailbox, tmp], {
          timeout: 30_000,
        });
        return { ok: true, mailbox, source: "doveadm" };
      } finally {
        await unlink(tmp).catch(() => {});
      }
    }

    const folderPath = await resolveFolderMaildirPath(maildir, canon);
    if (unixUser) await chownMaildirTree(folderPath, unixUser);
    const fname = `${Date.now()}.M${process.pid}P${randomBytes(4).toString("hex")}:2,${canon === "Drafts" ? "D" : "S"}`;
    await writeFile(path.join(folderPath, "cur", fname), rawMessage);
    if (unixUser) await chownMaildirTree(folderPath, unixUser);
    return { ok: true, mailbox: canon, source: "maildir" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Create standard Maildir subfolders and Dovecot mailboxes when missing.
 */
export async function ensureStandardMailboxes({
  authUser = null,
  maildirRoot = null,
  unixUser = null,
  useDoveadm = null,
} = {}) {
  const dove = useDoveadm ?? (await doveadmAvailable());

  if (maildirRoot) {
    await ensureMaildir(maildirRoot, unixUser);
    for (const name of STANDARD_MAILBOX_FOLDERS) {
      if (name === "INBOX") continue;
      await ensureMaildir(maildirSubfolderPath(maildirRoot, name), unixUser);
    }
    if (unixUser) await chownMaildirTree(maildirRoot, unixUser);
  }

  if (dove && authUser) {
    for (const name of STANDARD_MAILBOX_FOLDERS) {
      if (name === "INBOX") continue;
      try {
        await exec("doveadm", ["mailbox", "create", "-u", authUser, name], {
          timeout: 30_000,
        });
      } catch {
        /* already exists */
      }
    }
  }
}

/**
 * Merge listed folders with the standard set (empty folders shown as 0 messages).
 */
export function mergeStandardMailboxes(mailboxes, defaultUser = "") {
  const map = new Map();
  for (const m of mailboxes ?? []) {
    const folder = canonicalFolderName(m.folder);
    const prev = map.get(folder);
    if (!prev) {
      map.set(folder, { ...m, folder });
      continue;
    }
    const a = Number(prev.messages) || 0;
    const b = Number(m.messages) || 0;
    if (b > a) map.set(folder, { ...m, folder });
  }

  const out = [];
  for (const std of STANDARD_MAILBOX_FOLDERS) {
    if (map.has(std)) {
      out.push(map.get(std));
      map.delete(std);
    } else {
      out.push({
        user: defaultUser,
        folder: std,
        messages: "0",
        size: "0 B",
      });
    }
  }
  for (const m of map.values()) {
    out.push(m);
  }
  return out;
}

/** Store a copy of an outgoing message in the Sent folder. */
export async function saveSentCopy(domain, localUser, rawMessage) {
  return saveMailToFolder(domain, localUser, "Sent", rawMessage);
}
