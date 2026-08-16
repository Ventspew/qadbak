import "server-only";

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { auditRetentionConfig } from "./audit-retention";
import { countAuditActions } from "./audit-read";
import { listApiKeys } from "./api-keys";
import { loadUsers } from "./users";
import { getLicensePublicInfo } from "./qadbak-license";
import { licenseClientMeta } from "./license-client-meta";

export type PrivacyOutboundRow = {
  id: string;
  name: string;
  destination: string;
  purpose: string;
  when: string;
  enabled: boolean;
  dataSent: string[];
  optional: boolean;
};

export type PrivacyReport = {
  generatedAt: string;
  posture: "local-first" | "hybrid" | "mock";
  summary: string;
  staysOnVps: string[];
  outbound: PrivacyOutboundRow[];
  session: {
    cookieSecure: "auto" | "true" | "false";
    installSalt: boolean;
  };
  license: Awaited<ReturnType<typeof getLicensePublicInfo>>;
  storage: {
    auditLogPath: string;
    auditLogBytes: number | null;
    usersPath: string;
    licensePath: string;
    cloudCredentialsConfigured: boolean;
    alertRulesConfigured: boolean;
    apiKeysCount: number;
  };
  hardening: {
    loginRateLimit: boolean;
    apiKeysWithIpAllowlist: number;
    terminalWsLocalOnly: boolean;
    failedLogins24h: number;
    totpUsers: number;
  };
  auditRetention: ReturnType<typeof auditRetentionConfig>;
  envHints: { key: string; value: string; note: string }[];
  recommendations: string[];
};

async function fileSize(p: string): Promise<number | null> {
  try {
    const s = await stat(p);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

function envFlag(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function heartbeatIntervalHours(): number {
  const env = process.env.QADBAK_HEARTBEAT_INTERVAL_HOURS?.trim();
  const hours = env ? Number(env) : 6;
  return Number.isFinite(hours) && hours > 0 ? hours : 6;
}

export async function buildPrivacyReport(): Promise<PrivacyReport> {
  const root = process.cwd();
  const license = await getLicensePublicInfo();
  const meta = licenseClientMeta();
  const licenseServer =
    process.env.QADBAK_LICENSE_SERVER?.replace(/\/$/, "") ||
    "https://license.inveil.dev";
  const mock = process.env.QADBAK_LEGACY_API_MOCK === "true";
  const hybrid =
    process.env.QADBAK_PROVISIONER === "hybrid" ||
    process.env.QADBAK_LEGACY_API_FALLBACK === "true";
  const posture: PrivacyReport["posture"] = mock
    ? "mock"
    : hybrid
      ? "hybrid"
      : "local-first";

  const heartbeatDisabled = envFlag("QADBAK_DISABLE_HEARTBEAT_SCHEDULER");
  const hbHours = heartbeatIntervalHours();
  const premiumActive = license.status === "active";

  const outbound: PrivacyOutboundRow[] = [
    {
      id: "license-heartbeat",
      name: "Premium license heartbeat",
      destination: licenseServer,
      purpose: "Validate subscription and refresh Premium module list",
      when: heartbeatDisabled
        ? "Only when you click Heartbeat now (scheduler off)"
        : `About every ${hbHours}h while Premium is active`,
      enabled: premiumActive && !mock,
      dataSent: [
        "License token (not the full QAD- key)",
        "Instance ID",
        "Panel hostname",
        "Panel version",
        "Optional install fingerprint tag",
      ],
      optional: false,
    },
  ];

  if (!envFlag("QADBAK_DISABLE_LEGACY_PANEL")) {
    outbound.push({
      id: "legacy-panel-embed",
      name: "Legacy panel embed (optional)",
      destination: process.env.QADBAK_LEGACY_PANEL_URL?.trim() || "legacy hosting :10000",
      purpose: "Break-glass server admin login links only",
      when: "When an admin opens legacy embed routes",
      enabled: Boolean(process.env.QADBAK_LEGACY_PANEL_URL?.trim()),
      dataSent: ["Session handoff via create-login-link — no customer mail/sites"],
      optional: true,
    });
  }

  const alertPath = path.join(root, "data", "alert-rules.json");
  if (existsSync(alertPath)) {
    outbound.push({
      id: "alert-webhooks",
      name: "Alert notifications",
      destination: "Slack / Telegram / email / Discord (your rules)",
      purpose: "Disk or service alerts you configured",
      when: "When alert rules fire",
      enabled: true,
      dataSent: ["Alert text and metrics snippets — per your rules"],
      optional: true,
    });
  }

  if (existsSync(path.join(root, "data", "discord-notify.json"))) {
    outbound.push({
      id: "discord-notify",
      name: "Discord bot DMs",
      destination: "Discord API (bot DMs and slash commands)",
      purpose: "Host health, panel events, and no-code bot tasks you opted into",
      when: "When Discord is enabled and an event or command fires",
      enabled: true,
      dataSent: ["Short status text — Discord user ids of people who linked"],
      optional: true,
    });
  }

  if (existsSync(path.join(root, "data", "cloud-credentials.json"))) {
    outbound.push({
      id: "offsite-backup",
      name: "Offsite backups",
      destination: "Your S3 / B2 / GCS bucket",
      purpose: "Encrypted backup upload after local archive",
      when: "When offsite policy runs on a domain",
      enabled: true,
      dataSent: ["Backup archive bytes — only domains you enable"],
      optional: true,
    });
  }

  const failedLogins24h = await countAuditActions(
    "login-failed",
    Date.now() - 24 * 60 * 60 * 1000,
  ).catch(() => 0);

  const users = await loadUsers();
  const totpUsers = users.filter((u) => u.totpSecret).length;

  const apiKeys = await listApiKeys();
  const apiKeysCount = apiKeys.length;
  const apiKeysWithIpAllowlist = apiKeys.filter(
    (k) => k.ipAllowlist.length > 0,
  ).length;
  const terminalHost =
    process.env.QADBAK_TERMINAL_WS_HOST?.trim() || "127.0.0.1";
  const terminalWsLocalOnly =
    terminalHost === "127.0.0.1" || terminalHost === "localhost";

  const staysOnVps = [
    "Customer websites, mailboxes, and databases",
    "DNS zones under /var/lib/bind (native mode)",
    "Panel users and domain settings (data/users.json, data/native-domains.json)",
    "Action journal and audit log on disk",
    "TLS certificates on this server (Let's Encrypt)",
  ];

  const recommendations: string[] = [
    "Keep QADBAK_PROVISIONER=native and QADBAK_LEGACY_API_FALLBACK=false so hosting stays on the VPS.",
    "Bind legacy server admin to 127.0.0.1 only (see docs/FRONT-DOOR.md).",
    "Use HTTPS for the panel; avoid QADBAK_COOKIE_SECURE=false except on isolated HTTP :11000.",
  ];

  if (premiumActive && hbHours < 12) {
    recommendations.push(
      `Raise QADBAK_HEARTBEAT_INTERVAL_HOURS (now ${hbHours}h) to 12–24 for fewer license server contacts.`,
    );
  }

  if (!heartbeatDisabled && premiumActive) {
    recommendations.push(
      "To pause background heartbeats during maintenance: QADBAK_DISABLE_HEARTBEAT_SCHEDULER=true",
    );
  }

  const envHints = [
    {
      key: "QADBAK_PROVISIONER",
      value: process.env.QADBAK_PROVISIONER ?? "native",
      note: "native = no remote hosting API for daily ops",
    },
    {
      key: "QADBAK_LEGACY_API_FALLBACK",
      value: process.env.QADBAK_LEGACY_API_FALLBACK ?? "false",
      note: "true sends some calls to legacy hosting API",
    },
    {
      key: "QADBAK_HEARTBEAT_INTERVAL_HOURS",
      value: String(hbHours),
      note: "Premium heartbeat frequency",
    },
    {
      key: "QADBAK_DISABLE_HEARTBEAT_SCHEDULER",
      value: heartbeatDisabled ? "true" : "false",
      note: "true = manual heartbeat only",
    },
    {
      key: "QADBAK_PUBLIC_HOST",
      value: meta.publicHost,
      note: "Sent to license server on heartbeat",
    },
    {
      key: "QADBAK_AUDIT_MAX_LINES",
      value: String(auditRetentionConfig().maxLines),
      note: "Local audit.log line cap",
    },
    {
      key: "QADBAK_AUDIT_RETENTION_DAYS",
      value: String(auditRetentionConfig().retentionDays || "off"),
      note: "Drop audit entries older than N days",
    },
  ];

  let cookieSecure: PrivacyReport["session"]["cookieSecure"] = "auto";
  if (process.env.QADBAK_COOKIE_SECURE === "true") cookieSecure = "true";
  if (process.env.QADBAK_COOKIE_SECURE === "false") cookieSecure = "false";

  const summary =
    posture === "mock"
      ? "Development mock mode — no real customer data."
      : outbound.filter((o) => o.enabled && !o.optional).length === 0
        ? "Core mode: hosting data stays on this VPS; no Premium heartbeat."
        : premiumActive
          ? `Hosting stays on this VPS. One small outbound heartbeat to ${licenseServer} for Premium.`
          : "Hosting stays on this VPS. Activate Premium only if you accept the license heartbeat.";

  return {
    generatedAt: new Date().toISOString(),
    posture,
    summary,
    staysOnVps,
    outbound,
    session: {
      cookieSecure,
      installSalt: Boolean(process.env.QADBAK_INSTALL_SALT?.trim()),
    },
    license,
    storage: {
      auditLogPath: "data/audit.log",
      auditLogBytes: await fileSize(path.join(root, "data", "audit.log")),
      usersPath: "data/users.json",
      licensePath: "data/license.json",
      cloudCredentialsConfigured: existsSync(
        path.join(root, "data", "cloud-credentials.json"),
      ),
      alertRulesConfigured: existsSync(alertPath),
      apiKeysCount,
    },
    hardening: {
      loginRateLimit: true,
      apiKeysWithIpAllowlist,
      terminalWsLocalOnly,
      failedLogins24h,
      totpUsers,
    },
    auditRetention: auditRetentionConfig(),
    envHints,
    recommendations,
  };
}

export function privacyPostureLabel(posture: PrivacyReport["posture"]): string {
  if (posture === "local-first") return "Local-first";
  if (posture === "hybrid") return "Hybrid (some legacy API)";
  return "Mock / dev";
}
