import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readMailSettingsCatchAllEntries } from "./mail-settings-catchall.mjs";
import {
  loadRegistry,
  QADBAK_DIR,
  fileExists,
  resolveDomainUser,
  readDomainConfigJson,
} from "./provisioning-common.mjs";
import {
  ensureMaildir,
  chownMaildirTree,
  discoverMailLayout,
  listMailboxesFromLayout,
  writeVirtualMapFile,
  readMapFile,
  writeVirtualDomainsFile,
  postmapReloadAll,
  resolveMailboxMaildir,
  resolveUnixIds,
  toPostfixVmailboxPath,
  fromPostfixVmailboxPath,
  QADBAK_POSTFIX_VIRTUAL,
  QADBAK_POSTFIX_DOMAINS,
  QADBAK_POSTFIX_VMAILBOX,
  QADBAK_POSTFIX_VMAILBOX_UID,
  QADBAK_POSTFIX_VMAILBOX_GID,
} from "./mail-layout.mjs";
import { ensureInboundMailDns, mailDnsHints } from "./mail-dns.mjs";
import { deliverLocalMessage } from "./mail-queue.mjs";

const exec = promisify(execFile);

const MAIL_CONFIGURED_STAMP = "/var/lib/qadbak/native-mail-configured";
let stackConfigured = false;

export async function syncVirtualDomainsFile() {
  const rows = await loadRegistry();
  const domains = [
    ...new Set(
      rows
        .filter((r) => r.name && !r.disabled && r.type !== "alias")
        .map((r) => String(r.name).toLowerCase()),
    ),
  ].sort();
  await writeVirtualDomainsFile(domains);
  return domains;
}

/** Rebuild Postfix virtual_mailbox_maps (direct Maildir delivery — no LMTP). */
export async function rebuildPostfixMailboxMaps() {
  const rows = await loadRegistry();
  const vmailbox = new Map();
  const vuids = new Map();
  const vgids = new Map();

  for (const row of rows) {
    if (!row.name || row.disabled || row.type === "alias" || !row.user) continue;
    const domain = String(row.name).toLowerCase();
    const owner = row.user;
    let home = `/home/${owner}`;
    try {
      const resolved = await resolveDomainUser(domain);
      home = resolved.home || home;
    } catch {
      /* */
    }

    const layout = await discoverMailLayout(domain, owner, home);
    const mailboxes = await listMailboxesFromLayout(layout);

    const addBox = async (local) => {
      const email = `${local}@${domain}`;
      const destUser = local === owner ? owner : local;
      const maildir = await resolveMailboxMaildir(layout, local, owner, home);
      await ensureMaildir(maildir, destUser);
      vmailbox.set(email, toPostfixVmailboxPath(maildir));
      const ids = await resolveUnixIds(destUser);
      if (ids) {
        vuids.set(email, ids.uid);
        vgids.set(email, ids.gid);
      }
    };

    await addBox(owner);
    const ownerIds = await resolveUnixIds(owner);
    const ownerMaildir = await resolveMailboxMaildir(layout, owner, owner, home);
    if (ownerIds) {
      vmailbox.set(`postmaster@${domain}`, toPostfixVmailboxPath(ownerMaildir));
      vuids.set(`postmaster@${domain}`, ownerIds.uid);
      vgids.set(`postmaster@${domain}`, ownerIds.gid);
    }
    for (const m of mailboxes) {
      const local = String(m.user || "").toLowerCase();
      if (!local || local === owner) continue;
      await addBox(local);
    }
  }

  const toRows = (map) =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([address, destination]) => ({ address, destination }));

  await writeVirtualMapFile(QADBAK_POSTFIX_VMAILBOX, toRows(vmailbox));
  await writeVirtualMapFile(QADBAK_POSTFIX_VMAILBOX_UID, toRows(vuids));
  await writeVirtualMapFile(QADBAK_POSTFIX_VMAILBOX_GID, toRows(vgids));

  const vmboxRows = await readMapFile(QADBAK_POSTFIX_VMAILBOX);
  const absolute = vmboxRows.filter((r) => r.destination.trim().startsWith("/"));
  if (absolute.length > 0) {
    const sample = absolute.slice(0, 3).map((r) => r.address).join(", ");
    throw new Error(
      `qadbak-vmailbox paths must be relative to virtual_mailbox_base=/ (absolute entries: ${sample})`,
    );
  }

  return { count: vmailbox.size, emails: new Set(vmailbox.keys()) };
}

/** Remove mailbox addresses from qadbak-virtual (alias map wins over vmailbox in Postfix). */
export async function stripVirtualAliasMailboxConflicts(mailboxEmails) {
  const rows = await readMapFile(QADBAK_POSTFIX_VIRTUAL);
  const blocked = mailboxEmails instanceof Set ? mailboxEmails : new Set(mailboxEmails);
  const filtered = rows.filter((r) => {
    if (r.address.startsWith("@")) return true;
    return !blocked.has(r.address.toLowerCase());
  });
  if (filtered.length !== rows.length) {
    await writeVirtualMapFile(QADBAK_POSTFIX_VIRTUAL, filtered);
  }
  return rows.length - filtered.length;
}

/** Email forwards only (virtual_alias_maps — must not overlap mailbox addresses). */
export async function rebuildVirtualAliasMap() {
  const rows = await loadRegistry();
  const entries = new Map();

  for (const row of rows) {
    if (!row.name || row.disabled || row.type === "alias") continue;
    const domain = String(row.name).toLowerCase();
    const aliases = await readDomainConfigJson(domain, "aliases.json", []);
    for (const a of aliases) {
      if (!a.from || !a.to) continue;
      entries.set(String(a.from).toLowerCase(), String(a.to).trim());
    }
  }

  for (const { address, destination } of await readMailSettingsCatchAllEntries(
    rows,
  )) {
    entries.set(address.toLowerCase(), destination);
  }

  const sorted = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b));
  await writeVirtualMapFile(
    QADBAK_POSTFIX_VIRTUAL,
    sorted.map(([address, destination]) => ({ address, destination })),
  );
  return sorted.length;
}

export async function ensureDomainMailSetup(domain, owner) {
  const d = String(domain).trim().toLowerCase();
  const u = String(owner).trim();
  if (!d || !u) return;

  const home = `/home/${u}`;
  await ensureMaildir(path.join(home, "Maildir"), u);
  const { emails } = await rebuildPostfixMailboxMaps();
  await rebuildVirtualAliasMap();
  await stripVirtualAliasMailboxConflicts(emails);
  await syncVirtualDomainsFile();
  await postmapReloadAll();
  await ensureInboundMailDns(d).catch(() => {});
}

let stackConfiguring = false;

export async function ensureNativeMailStack() {
  if (stackConfigured || stackConfiguring || (await fileExists(MAIL_CONFIGURED_STAMP))) {
    stackConfigured = true;
    return;
  }
  const script = path.join(QADBAK_DIR, "scripts", "configure-native-mail.sh");
  if (!(await fileExists(script))) return;
  stackConfiguring = true;
  try {
    await exec("bash", [script, "--force"], { timeout: 180_000 });
    stackConfigured = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Native mail stack setup failed: ${msg}`);
  } finally {
    stackConfiguring = false;
  }
}

export async function mailSyncAll() {
  await ensureNativeMailStack();
  const rows = await loadRegistry();

  for (const row of rows) {
    if (!row.name || row.disabled || row.type === "alias" || !row.user) continue;
    const home = `/home/${row.user}`;
    await ensureHomesTraversal(row.user);
    await ensureMaildir(path.join(home, "Maildir"), row.user);
    try {
      const layout = await discoverMailLayout(row.name, row.user, home);
      const mailboxes = await listMailboxesFromLayout(layout);
      for (const m of mailboxes) {
        const local = m.user;
        const isOwner = local === row.user;
        const maildir = isOwner
          ? path.join(home, "Maildir")
          : await resolveMailboxMaildir(layout, local, row.user, home);
        await ensureMaildir(maildir, isOwner ? row.user : local);
        await ensureMailboxOwnership(local, row.user, maildir, isOwner);
      }
    } catch {
      /* per-domain */
    }
  }

  const { emails } = await rebuildPostfixMailboxMaps();
  await rebuildVirtualAliasMap();
  await stripVirtualAliasMailboxConflicts(emails);
  await syncVirtualDomainsFile();
  await postmapReloadAll();

  for (const row of rows) {
    if (!row.name || row.disabled || row.type === "alias") continue;
    await ensureInboundMailDns(row.name).catch(() => {});
  }
}

async function countInboxMessages(maildirRoot) {
  const { readdir } = await import("node:fs/promises");
  let n = 0;
  for (const sub of ["cur", "new"]) {
    try {
      const files = await readdir(path.join(maildirRoot, sub));
      n += files.filter((f) => !f.startsWith(".")).length;
    } catch {
      /* */
    }
  }
  return n;
}

async function ensureMailboxOwnership(local, owner, maildirRoot, isOwner) {
  const target = isOwner ? owner : local;
  await chownMaildirTree(maildirRoot, target);
}

async function ensureHomesTraversal(owner) {
  const home = `/home/${owner}`;
  const homes = `${home}/homes`;
  for (const p of [home, homes]) {
    try {
      await exec("chmod", ["u+rx,g+rx", p], { timeout: 5000 });
    } catch {
      /* */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mailReceiveTest(domain, localUser) {
  const { user: owner, home } = await resolveDomainUser(domain);
  const local = String(localUser || owner).trim().toLowerCase();
  const layout = await discoverMailLayout(domain, owner, home);
  const mailboxes = await listMailboxesFromLayout(layout);
  if (!mailboxes.some((m) => m.user.toLowerCase() === local)) {
    throw new Error(`Unknown mailbox user: ${local}`);
  }

  const to = `${local}@${domain}`;
  const maildirRoot = await resolveMailboxMaildir(layout, local, owner, home);
  await ensureMailboxOwnership(local, owner, maildirRoot, local === owner);

  const before = await countInboxMessages(maildirRoot);
  const subject = "Qadbak inbound test";
  const body = "Inbound mail delivery test.";

  let inject;
  try {
    inject = await deliverLocalMessage(to, subject, body, "postmaster@localhost");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }

  let after = before;
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    after = await countInboxMessages(maildirRoot);
    if (after > before) break;
  }

  const delivered = after > before;
  let mailLogHint = "";
  if (!delivered) {
    try {
      const probe = maildirRoot.replace(/\/$/, "");
      const destUser = local === owner ? owner : local;
      await exec("bash", [`${QADBAK_DIR}/scripts/probe-postfix-maildir-write.sh`, probe, destUser], {
        timeout: 10_000,
      }).catch((e) => {
        mailLogHint = e instanceof Error ? e.message : String(e);
      });
    } catch {
      /* */
    }
    if (!mailLogHint) {
      try {
        const { stdout } = await exec(
          "bash",
          [
            "-c",
            `grep -iE 'postfix|${to.replace(/'/g, "")}|apparmor|DENIED|status=' /var/log/mail.log /var/log/syslog 2>/dev/null | tail -12`,
          ],
          { timeout: 5000 },
        );
        mailLogHint = stdout.trim();
      } catch {
        /* */
      }
    }
  }
  return {
    to,
    maildir: maildirRoot,
    newMessages: Math.max(0, after - before),
    delivered,
    injectMethod: inject.method,
    mailLogHint: mailLogHint || undefined,
  };
}

/** SMTP RCPT probe — verifies Postfix accepts mail for mailbox@domain. */
export async function smtpInboundProbe(domain, localUser) {
  const to = `${String(localUser).toLowerCase()}@${String(domain).toLowerCase()}`;
  const script = `
import socket, sys
to = sys.argv[1]
s = socket.create_connection(("127.0.0.1", 25), timeout=8)
def rd():
    return s.recv(4096).decode(errors="replace")
def wr(m):
    s.sendall((m + "\\r\\n").encode())
rd()
wr("HELO qadbak-probe")
rd()
wr("MAIL FROM:<probe@qadbak.local>")
rd()
wr("RCPT TO:<" + to + ">")
r = rd()
wr("QUIT")
print(r.strip())
sys.exit(0 if r.startswith("250") else 1)
`;
  try {
    const { stdout, stderr } = await exec("python3", ["-c", script, to], {
      timeout: 15_000,
    });
    const line = stdout.trim() || stderr.trim();
    const ok = line.startsWith("250");
    return { ok, response: line, recipient: to };
  } catch (e) {
    const err = e;
    const detail =
      err && typeof err === "object" && "stdout" in err
        ? String(err.stdout || err.stderr || "").trim()
        : e instanceof Error
          ? e.message
          : String(e);
    return { ok: false, response: detail || "SMTP probe failed", recipient: to };
  }
}

export async function mailDiagnose(domain, localUser) {
  const rows = await loadRegistry();
  const row = rows.find((r) => r.name === domain);
  const checks = [];

  async function ok(label, pass, detail = "") {
    checks.push({ label, ok: pass, detail });
  }

  try {
    const { stdout } = await exec("systemctl", ["is-active", "postfix"], { timeout: 5000 });
    await ok("postfix", stdout.trim() === "active", stdout.trim());
  } catch {
    await ok("postfix", false, "not active");
  }

  try {
    const { stdout } = await exec("systemctl", ["is-active", "dovecot"], { timeout: 5000 });
    await ok("dovecot", stdout.trim() === "active", stdout.trim());
  } catch {
    await ok("dovecot", false, "not active");
  }

  try {
    const { stdout } = await exec("ss", ["-tln"], { timeout: 5000 });
    await ok("smtp port 25", stdout.includes(":25 "), "listening");
  } catch {
    await ok("smtp port 25", false, "check failed");
  }

  try {
    const { stdout } = await exec("postconf", ["-n", "myhostname", "myorigin", "append_at_myorigin"], {
      timeout: 8000,
    });
    const hostLine = stdout.split("\n").find((l) => l.startsWith("myhostname"));
    const hostVal = hostLine?.split("=")[1]?.trim() || "";
    const ipHost = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostVal);
    await ok(
      "postfix myhostname (FQDN, not IP)",
      !ipHost && hostVal.includes("."),
      stdout.replace(/\n/g, " "),
    );
  } catch {
    await ok("postfix myhostname", false, "postconf failed");
  }

  try {
    const { stdout } = await exec("postconf", ["-n", "virtual_mailbox_domains", "virtual_mailbox_maps", "virtual_mailbox_base", "virtual_transport"], {
      timeout: 8000,
    });
    await ok(
      "postfix config",
      stdout.includes("qadbak-domains") &&
        stdout.includes("qadbak-vmailbox") &&
        /virtual_mailbox_base\s*=\s*\//.test(stdout) &&
        stdout.includes("virtual_transport = virtual"),
      stdout.replace(/\n/g, " "),
    );
  } catch {
    await ok("postfix config", false, "postconf failed");
  }

  await ok("qadbak-virtual map", await fileExists(QADBAK_POSTFIX_VIRTUAL), QADBAK_POSTFIX_VIRTUAL);
  await ok("qadbak-domains map", await fileExists(QADBAK_POSTFIX_DOMAINS), QADBAK_POSTFIX_DOMAINS);

  const vmboxRows = await readMapFile(QADBAK_POSTFIX_VMAILBOX);
  const absVmbox = vmboxRows.filter((r) => r.destination.trim().startsWith("/"));
  await ok(
    "qadbak-vmailbox paths (relative)",
    absVmbox.length === 0,
    absVmbox.length
      ? `absolute paths break delivery — run mail-sync: ${absVmbox.map((r) => r.address).join(", ")}`
      : `${vmboxRows.length} mailbox(es)`,
  );

  const domains = await syncVirtualDomainsFile();
  await ok(
    "virtual domains",
    domains.includes(String(domain).toLowerCase()),
    domains.join(", ") || "(none)",
  );

  let probeUser = String(localUser || "").trim().toLowerCase();
  if (!probeUser) {
    try {
      const { user: owner, home } = await resolveDomainUser(domain);
      const layout = await discoverMailLayout(domain, owner, home);
      const mailboxes = await listMailboxesFromLayout(layout);
      const infoBox = mailboxes.find((m) => m.user.toLowerCase() === "info");
      probeUser = infoBox?.user || mailboxes[0]?.user || row?.user || "info";
    } catch {
      probeUser = row?.user || "info";
    }
  }

  const probeEmail = `${probeUser}@${String(domain).toLowerCase()}`;
  const vmboxHit = vmboxRows.find((r) => r.address.toLowerCase() === probeEmail);
  if (vmboxHit) {
    const resolved = fromPostfixVmailboxPath(vmboxHit.destination);
    await ok(
      `vmailbox resolves to ${resolved}`,
      resolved.startsWith("/home/") && resolved.endsWith("/Maildir"),
      vmboxHit.destination,
    );
  }

  const probe = await smtpInboundProbe(domain, probeUser);
  await ok(
    `SMTP RCPT TO ${probe.recipient}`,
    probe.ok,
    probe.response,
  );

  try {
    const delivery = await mailReceiveTest(domain, probeUser);
    await ok(
      `Maildir delivery → ${delivery.maildir}`,
      delivery.delivered,
      delivery.delivered
        ? `${delivery.newMessages} new message(s)`
        : "no message in Maildir cur/new after 10s — run: sudo bash scripts/repair-maildir-inbox.sh DOMAIN USER",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ok("Maildir delivery", false, msg);
  }

  const hints = await mailDnsHints(domain);
  await ok("dns hints", true, JSON.stringify(hints.records));

  return checks;
}

export { mailDnsHints, ensureInboundMailDns };
