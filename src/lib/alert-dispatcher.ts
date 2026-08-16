import { execFile } from "child_process";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { getHostMetrics } from "./host-metrics";
import { loadAlertSettings, type AlertRule } from "./alert-rules";
import { dmAllLinkedSubscribers } from "./discord-notify";
import { runProvisioningHelper } from "./provisioner/native-exec";
import { nativeFeatureEnabled } from "./provisioner/native-features";

const execFileAsync = promisify(execFile);

export type EvaluateAlertsResult = {
  fired: string[];
  skipped?: string;
  notified: string[];
};

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  if (!to.trim()) return false;
  await execFileAsync(
    "bash",
    [
      "-c",
      `printf %s ${JSON.stringify(body)} | mail -s ${JSON.stringify(subject)} ${JSON.stringify(to)}`,
    ],
    { timeout: 30_000 },
  );
  return true;
}

async function sendWebhook(url: string, payload: object): Promise<boolean> {
  if (!url.trim()) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

function webhookForRule(
  rule: AlertRule,
  settings: Awaited<ReturnType<typeof loadAlertSettings>>,
): string {
  if (rule.channel === "email") return rule.target || settings.emailTo || "";
  if (rule.channel === "slack") return rule.target || settings.slackWebhook || "";
  if (rule.channel === "telegram") return rule.target || settings.telegramWebhook || "";
  return "";
}

function rootDiskUsePct(
  disks: { mount: string; usePct: number }[],
): { usePct: number; mount: string } | null {
  const root = disks.find((d) => d.mount === "/");
  if (root) return { usePct: root.usePct, mount: "/" };
  if (disks.length === 0) return null;
  const busiest = disks.reduce((a, b) => (b.usePct > a.usePct ? b : a));
  return { usePct: busiest.usePct, mount: busiest.mount };
}

export async function evaluateAlerts(): Promise<EvaluateAlertsResult> {
  const settings = await loadAlertSettings();
  const fired: string[] = [];
  const notified: string[] = [];
  let metrics;
  try {
    metrics = await getHostMetrics();
  } catch (e) {
    return {
      fired: [],
      notified: [],
      skipped:
        e instanceof Error
          ? `Could not read host metrics: ${e.message}`
          : "Could not read host metrics.",
    };
  }

  const disk = rootDiskUsePct(metrics.disks);

  for (const rule of settings.rules) {
    if (!rule.enabled) continue;
    let hit = false;
    let msg = "";
    if (rule.metric === "disk" && disk) {
      hit = disk.usePct >= rule.threshold;
      msg = `Disk ${disk.mount} at ${disk.usePct}% (threshold ${rule.threshold}%)`;
    } else if (rule.metric === "memory") {
      hit = metrics.memory.usePct >= rule.threshold;
      msg = `Memory ${metrics.memory.usePct}% (threshold ${rule.threshold}%)`;
    } else if (rule.metric === "load") {
      hit = metrics.loadAvg[0] >= rule.threshold;
      msg = `Load ${metrics.loadAvg[0]} (threshold ${rule.threshold})`;
    } else if (rule.metric === "ssl_expiry") {
      const days = await minSslDaysLeft();
      if (days !== null) {
        hit = days <= rule.threshold;
        msg = `SSL expires in ${days} day(s) (threshold ${rule.threshold})`;
      }
    } else if (rule.metric === "backup_age" && nativeFeatureEnabled("backup")) {
      const age = await maxBackupAgeDays();
      if (age !== null) {
        hit = age >= rule.threshold;
        msg = `Oldest recent backup is ${age} day(s) old (threshold ${rule.threshold})`;
      }
    }
    if (!hit) continue;

    const subject = `[Qadbak] Alert: ${rule.id}`;
    const dest = webhookForRule(rule, settings);
    let delivered = false;
    try {
      if (rule.channel === "email") {
        delivered = await sendEmail(dest, subject, msg);
      } else if (rule.channel === "slack" || rule.channel === "telegram") {
        delivered = await sendWebhook(dest, { text: msg });
      } else if (rule.channel === "discord") {
        const dm = await dmAllLinkedSubscribers(`${subject}\n${msg}`);
        delivered = dm.sent > 0;
      }
    } catch {
      delivered = false;
    }

    const line = `${rule.id}: ${msg}`;
    fired.push(line);
    if (delivered) notified.push(line);
  }

  return { fired, notified };
}

async function minSslDaysLeft(): Promise<number | null> {
  try {
    const domainsDir = path.join(process.cwd(), "data", "domains");
    const names = await readdir(domainsDir).catch(() => []);
    let min: number | null = null;
    for (const d of names) {
      try {
        const certs = await runProvisioningHelper("ssl-list", d);
        for (const c of (certs.certs as { expiry?: string }[]) ?? []) {
          if (!c.expiry) continue;
          const days = Math.ceil(
            (new Date(c.expiry).getTime() - Date.now()) / 86_400_000,
          );
          if (min === null || days < min) min = days;
        }
      } catch {
        /* skip domain */
      }
    }
    return min;
  } catch {
    return null;
  }
}

async function maxBackupAgeDays(): Promise<number | null> {
  try {
    const reg = await readFile(
      path.join(process.cwd(), "data", "native-domains.json"),
      "utf8",
    ).catch(() => "[]");
    const domains = JSON.parse(reg) as { name: string }[];
    let maxAge = 0;
    let any = false;
    for (const { name } of domains) {
      try {
        const bl = await runProvisioningHelper("backup-list", name);
        const files = (bl.backups as { modified?: string }[]) ?? [];
        if (!files.length) continue;
        const newest = files.sort((a, b) =>
          String(b.modified).localeCompare(String(a.modified)),
        )[0];
        const age = Math.floor(
          (Date.now() - new Date(String(newest.modified)).getTime()) / 86_400_000,
        );
        if (age > maxAge) maxAge = age;
        any = true;
      } catch {
        /* skip */
      }
    }
    return any ? maxAge : null;
  } catch {
    return null;
  }
}
