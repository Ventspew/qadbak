import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { access } from "node:fs/promises";
import { emit, fail, resolveDomainUser, assertNotAliasDomain } from "./provisioning-common.mjs";
import { assertCountCap } from "./domain-limits-cap.mjs";
import { RESERVED_MAILBOX_LOCALS } from "./mail-reserved.mjs";
import { chpasswdSafe } from "./chpasswd-safe.mjs";
import {
  discoverMailLayout,
  listMailboxesFromLayout,
  appendMapEntry,
  removeMapEntry,
  postmapReloadAll,
  ensureMaildir,
  QADBAK_POSTFIX_VIRTUAL,
  resolveMailboxMaildir,
  resolveUnixHome,
} from "./mail-layout.mjs";
import { ensureNativeMailStack, syncVirtualDomainsFile, rebuildPostfixMailboxMaps, rebuildVirtualAliasMap } from "./mail-sync.mjs";
import { ensureInboundMailDns } from "./mail-dns.mjs";
import { ensureStandardMailboxes } from "./mail-folders.mjs";
import { enrichMailboxesWithUsage } from "./mail-quota.mjs";
import { doveadmAvailable } from "./doveadm-util.mjs";

const exec = promisify(execFile);

async function layoutForDomain(domain) {
  const { user, home } = await resolveDomainUser(domain);
  return discoverMailLayout(domain, user, home);
}

async function unixUserExists(name) {
  try {
    await exec("id", ["-u", name], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function mailListDirect(domain) {
  await assertNotAliasDomain(domain, "mail");
  const layout = await layoutForDomain(domain);
  let mailboxes = await listMailboxesFromLayout(layout);
  mailboxes = await enrichMailboxesWithUsage(layout, mailboxes, domain);
  emit({ ok: true, mailboxes, source: "postfix-dovecot", layout: { aliasMap: layout.aliasMap } });
}

export async function mailCreateDirect(domain, localUser, pass, real) {
  await assertNotAliasDomain(domain, "mail");
  await ensureNativeMailStack();
  const { user: owner, home } = await resolveDomainUser(domain);
  const layout = await discoverMailLayout(domain, owner, home);
  const local = String(localUser || "").trim().toLowerCase();
  if (!local || local.includes("@")) fail("Invalid mailbox user name");
  if (RESERVED_MAILBOX_LOCALS.has(local)) {
    fail(
      `Mailbox name "${local}" is reserved (it collides with a panel mail page).`,
    );
  }
  const existing = await listMailboxesFromLayout(layout);
  await assertCountCap(domain, "mailboxes", existing.length);

  const email = `${local}@${domain}`;
  const isOwner = local === owner;
  let maildir;

  if (isOwner) {
    maildir = path.join(home, "Maildir");
    await ensureMaildir(maildir, owner);
    await exec("chown", ["-R", `${owner}:${owner}`, maildir], { timeout: 60_000 });
  } else {
    const homesDir = layout.homesDir || path.join(home, "homes");
    const userHome = path.join(homesDir, local);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(homesDir, { recursive: true });

    if (!(await unixUserExists(local))) {
      await exec(
        "useradd",
        [
          "-m",
          "-d",
          userHome,
          "-s",
          "/usr/sbin/nologin",
          "-g",
          owner,
          "-c",
          real || email,
          local,
        ],
        { timeout: 30_000 },
      );
    } else {
      await mkdir(userHome, { recursive: true });
    }
    maildir = await resolveMailboxMaildir(layout, local, owner, home);
    await ensureMaildir(maildir, local);
    const actualHome = (await resolveUnixHome(local)) || userHome;
    await exec("chown", ["-R", `${local}:${owner}`, actualHome], { timeout: 60_000 });
  }

  await ensureStandardMailboxes({
    authUser: email,
    maildirRoot: maildir,
    unixUser: isOwner ? owner : local,
    useDoveadm: await doveadmAvailable(),
  });

  await syncVirtualDomainsFile();
  await rebuildPostfixMailboxMaps();
  await rebuildVirtualAliasMap();
  await postmapReloadAll();
  await ensureInboundMailDns(domain).catch(() => {});

  if (pass) {
    const target = isOwner ? owner : local;
    await chpasswdSafe(target, pass);
  }

  emit({ ok: true, email, source: "postfix-dovecot" });
}

export async function mailDeleteDirect(domain, localUser) {
  const { user: owner, home } = await resolveDomainUser(domain);
  const layout = await discoverMailLayout(domain, owner, home);
  const local = String(localUser || "").trim().toLowerCase();
  const email = `${local}@${domain}`;

  const mapPath = layout.aliasMap || QADBAK_POSTFIX_VIRTUAL;
  await removeMapEntry(mapPath, email).catch(() => {});
  await rebuildPostfixMailboxMaps();
  await rebuildVirtualAliasMap();
  await postmapReloadAll();

  if (local !== owner && (await unixUserExists(local))) {
    const userHome = path.join(layout.homesDir || path.join(home, "homes"), local);
    try {
      await exec("userdel", ["-r", local], { timeout: 30_000 });
    } catch {
      await exec("userdel", [local], { timeout: 30_000 }).catch(() => {});
      const { rm } = await import("node:fs/promises");
      await rm(userHome, { recursive: true, force: true }).catch(() => {});
    }
  }

  emit({ ok: true, source: "postfix-dovecot" });
}

export async function mailPassDirect(domain, localUser, pass) {
  const { user: owner } = await resolveDomainUser(domain);
  const local = String(localUser || "").trim().toLowerCase();
  const target = local === owner ? owner : local;
  if (!(await unixUserExists(target))) fail(`Unix user ${target} not found`);
  await chpasswdSafe(target, pass);
  emit({ ok: true, source: "postfix-dovecot" });
}
