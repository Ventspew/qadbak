import fs from "fs/promises";
import path from "path";
import { RECOMMENDED_ALERT_RULES } from "./alert-rules-presets";

export { RECOMMENDED_ALERT_RULES } from "./alert-rules-presets";

const RULES_PATH = path.join(process.cwd(), "data", "alert-rules.json");

export interface AlertRule {
  id: string;
  enabled: boolean;
  metric: "disk" | "memory" | "load" | "backup_age" | "ssl_expiry";
  threshold: number;
  channel: "email" | "slack" | "telegram" | "discord";
  target: string;
}

export interface AlertSettings {
  emailTo?: string;
  slackWebhook?: string;
  telegramWebhook?: string;
  rules: AlertRule[];
}

const DEFAULTS: AlertSettings = {
  emailTo: "",
  rules: RECOMMENDED_ALERT_RULES.map((r) => ({ ...r, enabled: r.id === "disk-85" })),
};

const VALID_METRICS = new Set<AlertRule["metric"]>([
  "disk",
  "memory",
  "load",
  "backup_age",
  "ssl_expiry",
]);
const VALID_CHANNELS = new Set<AlertRule["channel"]>([
  "email",
  "slack",
  "telegram",
  "discord",
]);

function normalizeRule(raw: unknown): AlertRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const metric = String(o.metric ?? "");
  const channel = String(o.channel ?? "");
  if (!VALID_METRICS.has(metric as AlertRule["metric"])) return null;
  if (!VALID_CHANNELS.has(channel as AlertRule["channel"])) return null;
  const threshold = Number(o.threshold);
  if (!Number.isFinite(threshold)) return null;
  return {
    id: String(o.id ?? "").trim() || `rule-${metric}`,
    enabled: Boolean(o.enabled),
    metric: metric as AlertRule["metric"],
    threshold,
    channel: channel as AlertRule["channel"],
    target: String(o.target ?? ""),
  };
}

/** Validate and coerce alert settings before load/save. */
export function normalizeAlertSettings(input: unknown): AlertSettings {
  const base = { ...DEFAULTS };
  if (!input || typeof input !== "object") return base;
  const o = input as Record<string, unknown>;
  const rulesRaw = o.rules;
  const rules = Array.isArray(rulesRaw)
    ? rulesRaw.map(normalizeRule).filter((r): r is AlertRule => r !== null)
    : base.rules;
  return {
    emailTo: typeof o.emailTo === "string" ? o.emailTo : base.emailTo,
    slackWebhook:
      typeof o.slackWebhook === "string" ? o.slackWebhook : base.slackWebhook,
    telegramWebhook:
      typeof o.telegramWebhook === "string" ? o.telegramWebhook : base.telegramWebhook,
    rules: rules.length > 0 ? rules : base.rules,
  };
}

export async function loadAlertSettings(): Promise<AlertSettings> {
  try {
    const raw = await fs.readFile(RULES_PATH, "utf8");
    return normalizeAlertSettings({ ...DEFAULTS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveAlertSettings(settings: AlertSettings): Promise<void> {
  const normalized = normalizeAlertSettings(settings);
  await fs.mkdir(path.dirname(RULES_PATH), { recursive: true });
  await fs.writeFile(RULES_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
