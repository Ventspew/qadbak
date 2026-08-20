import path from "node:path";
import { cp } from "node:fs/promises";
import { emit, fail, resolveDomainUser } from "./provisioning-common.mjs";
import { discoverMailLayout, resolveMailboxUnixUser } from "./mail-layout.mjs";
import {
  authUserCandidates,
  copyMailboxDoveadm,
  doveadmAvailable,
  fetchMessageInFolder,
  listDomainMailUsers,
  listMailboxesDoveadm,
  listMailboxesMaildir,
  listMessagesInFolder,
  resolveDovecotAuthUser,
  resolveMaildirRoot,
} from "./dovecot-imap.mjs";
import {
  ensureStandardMailboxes,
  mergeStandardMailboxes,
} from "./mail-folders.mjs";

async function imapSession(domain, localUser) {
  const { layout, owner, home } = await layoutForDomain(domain);
  const domainUsers = await listDomainMailUsers(layout);
  const local = String(localUser || "").trim().toLowerCase() || owner;
  const candidates = authUserCandidates(
    domain,
    local,
    owner,
    domainUsers.map((u) => ({ user: u.user })),
  );
  const maildirRoot = await resolveMaildirRoot(layout, local, owner, home);
  let authUser = local || owner;
  if (await doveadmAvailable()) {
    const resolved = await resolveDovecotAuthUser(candidates);
    if (resolved) authUser = resolved;
  }
  return { layout, owner, home, domainUsers, local, authUser, maildirRoot };
}

async function layoutForDomain(domain) {
  const { user, home } = await resolveDomainUser(domain);
  return { layout: await discoverMailLayout(domain, user, home), owner: user, home };
}

export async function imapList(domain, localUser) {
  const { layout, owner, home } = await layoutForDomain(domain);
  const domainUsers = await listDomainMailUsers(layout);
  const local = String(localUser || "").trim().toLowerCase();

  if (!local) {
    emit({
      ok: true,
      users: domainUsers,
      mailboxes: [],
      hint: "Pick a mailbox user and click Load.",
      source: (await doveadmAvailable()) ? "dovecot" : "maildir",
    });
    return;
  }

  const candidates = authUserCandidates(
    domain,
    local,
    owner,
    domainUsers.map((u) => ({ user: u.user })),
  );
  const useDoveadm = await doveadmAvailable();
  let authUser = null;
  let mailboxes = [];
  let source = "maildir";

  const maildirRoot = await resolveMaildirRoot(layout, local, owner, home);

  if (useDoveadm) {
    authUser = await resolveDovecotAuthUser(candidates);
  }
  if (!authUser) authUser = local ? `${local}@${domain}` : null;

  await ensureStandardMailboxes({
    authUser,
    maildirRoot,
    unixUser: await resolveMailboxUnixUser(local, owner),
    useDoveadm,
  });

  if (useDoveadm && authUser) {
    try {
      mailboxes = await listMailboxesDoveadm(authUser, maildirRoot);
      if (mailboxes.length) source = "doveadm";
    } catch {
      authUser = local || owner;
    }
  }

  if (!mailboxes.length) {
    authUser = authUser || local || owner;
    mailboxes = await listMailboxesMaildir(maildirRoot, authUser);
    source = "maildir";
  }

  mailboxes = mergeStandardMailboxes(
    mailboxes,
    authUser || `${local}@${domain}`,
  );

  emit({
    ok: true,
    users: domainUsers,
    authUser,
    maildirRoot,
    mailboxes,
    source,
  });
}

export async function imapCopy(domain, fromBox, toBox, localUser) {
  const { layout, owner, home } = await layoutForDomain(domain);
  const local = String(localUser || "").trim().toLowerCase() || owner;
  const domainUsers = await listDomainMailUsers(layout);
  const candidates = authUserCandidates(
    domain,
    local,
    owner,
    domainUsers.map((u) => ({ user: u.user })),
  );

  if (await doveadmAvailable()) {
    const authUser = await resolveDovecotAuthUser(candidates);
    if (authUser) {
      try {
        await copyMailboxDoveadm(authUser, fromBox, toBox);
        emit({ ok: true, authUser, source: "doveadm" });
        return;
      } catch (e) {
        fail(
          e instanceof Error
            ? e.message
            : "doveadm mailbox copy failed — use mailbox names like INBOX, not file paths.",
        );
      }
    }
  }

  const maildirRoot = await resolveMaildirRoot(layout, local, owner, home);
  const src = path.join(maildirRoot, fromBox.replace(/^INBOX\/?/, "").replace(/^\//, ""));
  const dst = path.join(maildirRoot, toBox.replace(/^INBOX\/?/, "").replace(/^\//, ""));
  await cp(src, dst, { recursive: true, force: false });
  emit({ ok: true, from: src, to: dst, source: "maildir" });
}

export async function imapMessages(domain, localUser, folder) {
  const { domainUsers, authUser, maildirRoot } = await imapSession(domain, localUser);
  const box = String(folder || "INBOX").trim() || "INBOX";
  const { messages, source } = await listMessagesInFolder(authUser, maildirRoot, box);
  emit({
    ok: true,
    users: domainUsers,
    authUser,
    maildirRoot,
    folder: box,
    messages,
    source,
  });
}

export async function imapFetch(domain, localUser, folder, messageId) {
  const { domainUsers, authUser, maildirRoot } = await imapSession(domain, localUser);
  const box = String(folder || "INBOX").trim() || "INBOX";
  const message = await fetchMessageInFolder(authUser, maildirRoot, box, messageId);
  emit({
    ok: true,
    users: domainUsers,
    authUser,
    folder: box,
    message,
  });
}
