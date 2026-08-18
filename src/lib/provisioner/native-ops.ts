import type { Role, HostedDatabase, HostedMailbox } from "../types";
import type {
  CronJob,
  DnsRecord,
  ScheduledBackup,
  SslCert,
  CreateDomainInput,
} from "../hosting-remote";
import { assertActorDomainAccess } from "../rbac";
import { loadNativeDomainRegistry } from "./native-domains";
import { runProvisioningHelper, type HelperResult } from "./native-exec";

type Actor = { role: Role; domains: string[] };

function aliasBlockedService(cmd: string): string | null {
  if (cmd.startsWith("ssl-")) return "SSL";
  if (cmd.startsWith("dns-")) return "DNS";
  if (cmd.startsWith("mail-") || cmd.startsWith("imap-") || cmd.startsWith("newsletter-"))
    return "mail";
  if (cmd.startsWith("backup-")) return "backups";
  if (cmd.startsWith("alias-")) return "aliases";
  return null;
}

async function refuseAliasIfNeeded(domain: string, cmd: string): Promise<void> {
  const service = aliasBlockedService(cmd);
  if (!service) return;
  const rows = await loadNativeDomainRegistry();
  const hit = rows.find((r) => r.name.toLowerCase() === domain.toLowerCase());
  if (String(hit?.type || "").toLowerCase() === "alias") {
    throw Object.assign(
      new Error(`Alias domains have no ${service}. Use the parent domain.`),
      { status: 400 },
    );
  }
}

function requireAdminActor(actor: Actor): void {
  if (actor.role !== "admin") {
    throw new Error("Only administrators may perform this action.");
  }
}

async function runDomainHelper(
  actor: Actor,
  domain: string,
  cmd: string,
  ...args: string[]
): Promise<HelperResult> {
  assertActorDomainAccess(actor, domain);
  await refuseAliasIfNeeded(domain, cmd);
  return runProvisioningHelper(cmd, domain, ...args);
}

async function runAdminHelper(
  actor: Actor,
  cmd: string,
  ...args: string[]
): Promise<HelperResult> {
  requireAdminActor(actor);
  return runProvisioningHelper(cmd, ...args);
}

export async function listSslCertsNative(
  domain: string,
  actor: Actor,
): Promise<SslCert[]> {
  const r = await runDomainHelper(actor, domain, "ssl-list");
  return (r.certs as SslCert[]) ?? [];
}

export async function requestLetsEncryptNative(
  domain: string,
  host: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "ssl-issue", host || domain);
}

export async function getDnsNative(
  domain: string,
  actor: Actor,
): Promise<{ records: DnsRecord[]; raw: unknown }> {
  const r = await runDomainHelper(actor, domain, "dns-get");
  return { records: (r.records as DnsRecord[]) ?? [], raw: r };
}

export async function addDnsRecordNative(
  domain: string,
  record: DnsRecord,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "dns-add", JSON.stringify(record));
}

export async function deleteDnsRecordNative(
  domain: string,
  record: DnsRecord,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "dns-del", JSON.stringify(record));
}

export async function listMailboxesNative(
  domain: string,
  actor: Actor,
): Promise<HostedMailbox[]> {
  const r = await runDomainHelper(actor, domain, "mail-list");
  return (
    (r.mailboxes as { user: string; real?: string; quota?: string; quotaUsedMb?: string }[]) ??
    []
  ).map((m) => ({
    user: m.user,
    name: m.user,
    real: m.real,
    quota: m.quotaUsedMb ?? m.quota ?? "0",
    quotaUsedMb: m.quotaUsedMb ?? m.quota,
  })) as HostedMailbox[];
}

export async function createMailboxNative(
  domain: string,
  user: string,
  pass: string,
  real: string | undefined,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain,
    "mail-create",
    user,
    pass,
    real ?? "",
  );
}

export async function updateMailboxPasswordNative(
  domain: string,
  user: string,
  pass: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "mail-pass", user, pass);
}

export async function deleteMailboxNative(
  domain: string,
  user: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "mail-delete", user);
}

export async function listDatabasesNative(
  domain: string,
  actor: Actor,
): Promise<HostedDatabase[]> {
  const r = await runDomainHelper(actor, domain, "db-list");
  return (r.databases as HostedDatabase[]) ?? [];
}

export async function createDatabaseNative(
  domain: string,
  name: string,
  pass: string,
  type: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "db-create", name, pass, type || "mysql");
}

export async function updateDatabasePasswordNative(
  domain: string,
  name: string,
  pass: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "db-pass", name, pass);
}

export async function createDomainNative(
  input: CreateDomainInput,
  actor: Actor,
): Promise<void> {
  const type =
    input.type ?? (input.alias ? "alias" : input.subdom ? "sub" : "top");
  const extra = JSON.stringify({
    type,
    parent: input.parent,
    plan: input.plan,
    reseller: input.reseller,
  });
  await runDomainHelper(actor, input.domain,
    "domain-create",
    input.pass,
    input.user?.trim() || "",
    extra,
  );
  if (input.plan?.trim()) {
    await runDomainHelper(actor, input.domain, "plan-apply", input.plan.trim());
  }
}

export async function deleteDomainNative(
  domain: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "domain-delete");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function listScheduledBackupsNative(
  domain: string,
  actor: Actor,
): Promise<ScheduledBackup[]> {
  const r = await runDomainHelper(actor, domain, "backup-list");
  const files =
    (r.backups as {
      name: string;
      sizeBytes?: number;
      modified?: string;
      kind?: string;
      components?: string[];
      mailAccounts?: number;
    }[]) ?? [];
  const sched = r.schedule as
    | { schedule?: string; enabled?: boolean; retain?: number }
    | undefined;
  const rows: ScheduledBackup[] = [];
  if (sched) {
    rows.push({
      id: "schedule",
      schedule: sched.schedule ?? "0 3 * * *",
      dest: `Automatic · keep ${sched.retain ?? 7} backups`,
      enabled: sched.enabled ? "1" : "0",
    });
  }
  for (const f of files) {
    const parts = [formatBytes(f.sizeBytes ?? 0)];
    if (f.components?.length) parts.push(f.components.join(", "));
    else if (f.mailAccounts && f.mailAccounts > 0) {
      parts.push(`mail (${f.mailAccounts} accounts)`);
    }
    parts.push(f.name);
    rows.push({
      id: f.name,
      schedule: f.kind === "scheduled" ? "Scheduled" : "Manual",
      dest: parts.join(" · "),
      enabled: "1",
    });
  }
  return rows;
}

export async function startBackupNative(
  domain: string,
  actor: Actor,
): Promise<{ file?: string; components?: string[] }> {
  requireAdminActor(actor);
  const r = await runDomainHelper(actor, domain, "backup-create", "full");
  return {
    file: r.file as string | undefined,
    components: r.components as string[] | undefined,
  };
}

export async function restoreDomainNative(
  domain: string,
  source: string,
  opts: { test?: boolean; allFeatures?: boolean },
  actor: Actor,
): Promise<{
  restored?: string[];
  preview?: string[];
  test?: boolean;
  entries?: number;
  mailAccounts?: { user?: string; email?: string }[];
  components?: string[];
  settingsFiles?: string[];
}> {
  const r = await runDomainHelper(actor, domain,
    "backup-restore",
    source,
    opts.test ? "true" : "false",
  );
  return {
    restored: r.restored as string[] | undefined,
    preview: r.preview as string[] | undefined,
    test: Boolean(r.test),
    entries: r.entries as number | undefined,
    mailAccounts: r.mailAccounts as { user?: string; email?: string }[] | undefined,
    components: r.components as string[] | undefined,
    settingsFiles: r.settingsFiles as string[] | undefined,
  };
}

export async function modifyScheduledBackupNative(
  domain: string,
  id: string,
  opts: { enabled?: boolean },
  actor: Actor,
): Promise<void> {
  if (id === "schedule") {
    await runDomainHelper(actor, domain,
    "backup-schedule-toggle",
      opts.enabled ? "true" : "false",
    );
    return;
  }
  throw new Error("Only the automatic schedule can be enabled or disabled.");
}

export async function deleteBackupNative(
  domain: string,
  name: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "backup-delete", name);
}

export async function setBackupScheduleNative(
  domain: string,
  schedule: { schedule?: string; enabled?: boolean; retain?: number },
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain,
    "backup-schedule-set",
    JSON.stringify(schedule),
  );
}

export async function listCronJobsNative(
  domain: string,
  actor: Actor,
): Promise<CronJob[]> {
  const r = await runDomainHelper(actor, domain, "cron-list");
  return ((r.jobs as { schedule: string; command: string }[]) ?? []).map(
    (j, i) => ({
      id: String(i),
      schedule: j.schedule,
      command: j.command,
      active: true,
    }),
  );
}

export async function createCronJobNative(
  domain: string,
  schedule: string,
  command: string,
  _user: string | undefined,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "cron-create", schedule, command);
}

export async function deleteCronJobNative(
  domain: string,
  id: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "cron-delete", id);
}

export async function listAliasesNative(
  domain: string,
  actor: Actor,
): Promise<{ from: string; to: string }[]> {
  const r = await runDomainHelper(actor, domain, "alias-list");
  return (r.aliases as { from: string; to: string }[]) ?? [];
}

export async function createAliasNative(
  domain: string,
  from: string,
  to: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "alias-create", from, to);
}

export async function deleteAliasNative(
  domain: string,
  from: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "alias-delete", from);
}

export async function listRedirectsNative(
  domain: string,
  actor: Actor,
): Promise<{ path: string; dest: string; type?: string }[]> {
  const r = await runDomainHelper(actor, domain, "redirect-list");
  return (r.redirects as { path: string; dest: string; type?: string }[]) ?? [];
}

export async function createRedirectNative(
  domain: string,
  path: string,
  dest: string,
  type: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "redirect-create", path, dest, type || "301");
}

export async function deleteRedirectNative(
  domain: string,
  path: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "redirect-delete", path);
}

export async function listDomainFeaturesNative(
  domain: string,
  actor: Actor,
): Promise<{ feature: string; enabled: boolean; label?: string }[]> {
  const r = await runDomainHelper(actor, domain, "feature-list");
  return (r.features as { feature: string; enabled: boolean; label?: string }[]) ?? [];
}

export async function setDomainFeatureNative(
  domain: string,
  feature: string,
  enabled: boolean,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "feature-set", feature, enabled ? "true" : "false");
}

export async function getWebsiteLogsNative(
  domain: string,
  logType: "access" | "error",
  actor: Actor,
): Promise<string> {
  const r = await runDomainHelper(actor, domain, "logs-tail", logType);
  return String(r.log ?? "");
}

export async function listPhpVersionsNative(
  domain: string,
  actor: Actor,
): Promise<{ version: string; id?: string }[]> {
  const r = await runDomainHelper(actor, domain, "php-versions");
  return (r.versions as { version: string; id?: string }[]) ?? [];
}

export async function listPhpDirectoriesNative(
  domain: string,
  actor: Actor,
): Promise<{ dir: string; version?: string; mode?: string }[]> {
  const r = await runDomainHelper(actor, domain, "php-directories");
  return (r.directories as { dir: string; version?: string; mode?: string }[]) ?? [];
}

export async function listPhpIniNative(
  domain: string,
  version: string | undefined,
  actor: Actor,
): Promise<{ name: string; value: string }[]> {
  const r = await runDomainHelper(actor, domain, "php-ini", version ?? "");
  return (r.ini as { name: string; value: string }[]) ?? [];
}

export async function setPhpDirectoryNative(
  domain: string,
  dir: string,
  version: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "php-set-directory", dir, version);
}

export async function modifyPhpIniNative(
  domain: string,
  name: string,
  value: string,
  version: string | undefined,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain,
    "php-modify-ini",
    name,
    value,
    version ?? "",
  );
}

export async function deletePhpDirectoryNative(
  domain: string,
  dir: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "php-delete-directory", dir);
}

export async function listFtpAccountsSafeNative(
  domain: string,
  actor: Actor,
): Promise<{ user: string; dir?: string; quota?: string }[]> {
  const r = await runDomainHelper(actor, domain, "ftp-list");
  return (r.accounts as { user: string; dir?: string; quota?: string }[]) ?? [];
}

export async function createFtpAccountNative(
  domain: string,
  user: string,
  pass: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "ftp-create", user, pass);
}

export async function updateFtpPasswordNative(
  domain: string,
  user: string,
  pass: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "ftp-pass", user, pass);
}

export async function deleteFtpAccountNative(
  domain: string,
  user: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "ftp-delete", user);
}

export async function getDomainLimitsNative(
  domain: string,
  actor: Actor,
): Promise<{
  disk?: string;
  bandwidth?: string;
  mailboxes?: string;
  databases?: string;
}> {
  const r = await runDomainHelper(actor, domain, "limits-get");
  return (r.limits as {
    disk?: string;
    bandwidth?: string;
    mailboxes?: string;
    databases?: string;
  }) ?? {};
}

export async function updateDomainLimitsNative(
  domain: string,
  limits: {
    disk?: string;
    bandwidth?: string;
    mailboxes?: string;
    databases?: string;
  },
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "limits-set", JSON.stringify(limits));
}

export async function setDomainEnabledNative(
  domain: string,
  enabled: boolean,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(
    actor,
    domain,
    enabled ? "domain-enable" : "domain-disable",
  );
}

export async function validateDomainNative(
  domain: string,
  actor: Actor,
): Promise<{ valid: boolean; messages: string[] }> {
  const r = await runDomainHelper(actor, domain, "domain-validate");
  return {
    valid: Boolean(r.valid),
    messages: (r.messages as string[]) ?? [],
  };
}

export async function searchMailLogsNative(
  domain: string,
  query: string,
  actor: Actor,
): Promise<string[]> {
  const r = await runDomainHelper(actor, domain, "mail-logs-search", query);
  return (r.lines as string[]) ?? [];
}

export async function listImapMailboxesNative(
  domain: string,
  user: string | undefined,
  actor: Actor,
): Promise<{ user: string; folder: string; messages?: string; size?: string }[]> {
  const r = await runDomainHelper(actor, domain, "imap-list", user ?? "");
  return (r.mailboxes as { user: string; folder: string; messages?: string; size?: string }[]) ?? [];
}

export async function copyMailboxNative(
  domain: string,
  from: string,
  to: string,
  actor: Actor,
  mailboxUser?: string,
): Promise<void> {
  await runDomainHelper(actor, domain, "imap-copy", from, to, mailboxUser ?? "");
}

export async function listProtectedDirectoriesNative(
  domain: string,
  actor: Actor,
): Promise<{ path: string; id?: string }[]> {
  const r = await runDomainHelper(actor, domain, "protected-list");
  return (r.directories as { path: string; id?: string }[]) ?? [];
}

export async function createProtectedDirectoryNative(
  domain: string,
  dirPath: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "protected-create", dirPath);
}

export async function deleteProtectedDirectoryNative(
  domain: string,
  dirPath: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "protected-delete", dirPath);
}

export async function listProtectedUsersNative(
  domain: string,
  dirPath: string,
  actor: Actor,
): Promise<{ user: string; path?: string }[]> {
  const r = await runDomainHelper(actor, domain, "protected-users-list", dirPath);
  return (r.users as { user: string }[]) ?? [];
}

export async function createProtectedUserNative(
  domain: string,
  dirPath: string,
  user: string,
  pass: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "protected-user-create", dirPath, user, pass);
}

export async function deleteProtectedUserNative(
  domain: string,
  dirPath: string,
  user: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "protected-user-delete", dirPath, user);
}

export async function resendEmailNative(
  _domain: string,
  messageId: string,
  actor: Actor,
): Promise<void> {
  throw new Error(
    `Resend (${messageId}) is not available in native mail mode. Use your mail client, or requeue from the server with postqueue/postfix.`,
  );
}

export async function listSharedAddressesNative(
  domain: string,
  actor: Actor,
): Promise<{ address: string; users: string }[]> {
  const r = await runDomainHelper(actor, domain, "shared-list");
  return (r.addresses as { address: string; users: string }[]) ?? [];
}

export async function createSharedAddressNative(
  domain: string,
  address: string,
  users: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "shared-create", address, users);
}

export async function deleteSharedAddressNative(
  domain: string,
  address: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "shared-delete", address);
}

export async function getMailSettingsNative(
  domain: string,
  actor: Actor,
): Promise<{
  catchAll?: string;
  autoresponder?: string;
  autoresponderEnabled?: boolean;
}> {
  const r = await runDomainHelper(actor, domain, "mail-settings-get");
  return (r.settings as {
    catchAll?: string;
    autoresponder?: string;
    autoresponderEnabled?: boolean;
  }) ?? {};
}

export async function updateMailSettingsNative(
  domain: string,
  settings: {
    catchAll?: string;
    autoresponder?: string;
    autoresponderEnabled?: boolean;
  },
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "mail-settings-set", JSON.stringify(settings));
}

export async function listProxiesNative(
  domain: string,
  actor: Actor,
): Promise<{ path: string; dest: string; type?: string }[]> {
  const r = await runDomainHelper(actor, domain, "proxy-list");
  return (r.proxies as { path: string; dest: string; type?: string }[]) ?? [];
}

export async function createProxyNative(
  domain: string,
  path: string,
  dest: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "proxy-create", path, dest, "proxy");
}

export async function deleteProxyNative(
  domain: string,
  path: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "proxy-delete", path);
}

export async function listAvailableScriptsNative(
  domain: string,
  actor: Actor,
): Promise<{ name: string; desc?: string; version?: string }[]> {
  const r = await runDomainHelper(actor, domain, "script-available");
  return (r.available as { name: string; desc?: string; version?: string }[]) ?? [];
}

export async function listInstalledScriptsNative(
  domain: string,
  actor: Actor,
): Promise<{ name: string; version?: string; path?: string; url?: string }[]> {
  const r = await runDomainHelper(actor, domain, "script-list");
  return ((r.installed as { name: string; path?: string }[]) ?? []).map((s) => ({
    name: s.name,
    path: s.path,
    version: "native",
  }));
}

export async function installScriptNative(
  domain: string,
  script: string,
  installPath: string | undefined,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "script-install", script, installPath ?? "public_html");
}

export async function deleteInstalledScriptNative(
  domain: string,
  script: string,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "script-delete", script);
}

export async function getRuntimesNative(domain: string, actor: Actor) {
  const r = await runDomainHelper(actor, domain, "runtimes-get");
  return {
    runtimes: (r.runtimes as { apps?: unknown[] }) ?? { apps: [] },
    phpFpmSocket: String(r.phpFpmSocket ?? ""),
  };
}

export async function installNodeRuntimeNative(
  domain: string,
  name: string,
  port: number,
  subpath: string | undefined,
  actor: Actor,
) {
  return runDomainHelper(
    actor,
    domain,
    "runtimes-node-install",
    name,
    String(port),
    subpath ?? "/",
  );
}

export async function installPythonRuntimeNative(
  domain: string,
  name: string,
  port: number,
  actor: Actor,
) {
  return runDomainHelper(
    actor,
    domain,
    "runtimes-python-install",
    name,
    String(port),
  );
}

export async function installDockerRuntimeNative(
  domain: string,
  name: string,
  actor: Actor,
) {
  return runDomainHelper(actor, domain, "runtimes-docker-install", name);
}

export async function getMailSecurityNative(
  domain: string,
  actor: Actor,
): Promise<{ spamEnabled?: boolean; dkimEnabled?: boolean }> {
  const r = await runDomainHelper(actor, domain, "security-get");
  return (r.settings as { spamEnabled?: boolean; dkimEnabled?: boolean }) ?? {};
}

export async function setSpamFilterNative(
  domain: string,
  enabled: boolean,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "security-spam", enabled ? "true" : "false");
}

export async function setDkimNative(
  domain: string,
  enabled: boolean,
  actor: Actor,
): Promise<void> {
  await runDomainHelper(actor, domain, "security-dkim", enabled ? "true" : "false");
}

export async function listResellersNative(
  actor: Actor,
): Promise<{ name: string; domains?: string; limit?: string }[]> {
  const r = await runAdminHelper(actor, "reseller-list");
  return (r.resellers as { name: string; domains?: string; limit?: string }[]) ?? [];
}

export async function createResellerNative(
  name: string,
  pass: string,
  actor: Actor,
): Promise<void> {
  await runAdminHelper(actor, "reseller-create", name, pass);
}

export async function deleteResellerNative(
  name: string,
  actor: Actor,
): Promise<void> {
  await runAdminHelper(actor, "reseller-delete", name);
}

export async function listPlansNative(
  actor: Actor,
): Promise<{ name: string; id?: string; quota?: string }[]> {
  const r = await runAdminHelper(actor, "plan-list");
  return (r.plans as { name: string; id?: string; quota?: string }[]) ?? [];
}

export async function createPlanNative(
  name: string,
  actor: Actor,
): Promise<void> {
  await runAdminHelper(actor, "plan-create", name);
}

export async function deletePlanNative(
  name: string,
  actor: Actor,
): Promise<void> {
  await runAdminHelper(actor, "plan-delete", name);
}
