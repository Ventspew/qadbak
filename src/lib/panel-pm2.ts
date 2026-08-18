import "server-only";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requirePremiumFeature } from "./premium/guard";

const execFileAsync = promisify(execFile);

export const PANEL_PM2_WRAPPER =
  process.env.QADBAK_PANEL_PM2_WRAPPER ?? "/opt/qadbak/scripts/run-panel-pm2.sh";

export type Pm2Process = {
  name: string;
  status: string;
  memory?: number;
  cpu?: number;
};

export async function probePanelPm2Sudo(): Promise<boolean> {
  await requirePremiumFeature("dashboard-panel-control");
  try {
    await access(PANEL_PM2_WRAPPER);
    await execFileAsync("sudo", ["-n", PANEL_PM2_WRAPPER, "__probe__"], {
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function listPanelPm2Processes(): Promise<Pm2Process[]> {
  await requirePremiumFeature("dashboard-panel-control");
  const { stdout } = await execFileAsync(
    "sudo",
    ["-n", PANEL_PM2_WRAPPER, "status"],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const raw = stdout.trim();
  try {
    const parsed = JSON.parse(raw) as Array<{
      name?: string;
      pm2_env?: { status?: string };
      monit?: { memory?: number; cpu?: number };
    }>;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p) => p.name?.startsWith("qadbak"))
        .map((p) => ({
          name: p.name ?? "unknown",
          status: p.pm2_env?.status ?? "unknown",
          memory: p.monit?.memory,
          cpu: p.monit?.cpu,
        }));
    }
  } catch {
    /* text fallback below */
  }
  const lines = raw.split("\n").filter((l) => /qadbak/i.test(l));
  return lines.map((line) => {
    const parts = line.trim().split(/\s+/);
    return {
      name: parts[0] ?? "qadbak",
      status: parts[15] ?? parts[parts.length - 2] ?? "unknown",
    };
  });
}

export async function runPanelPm2Action(
  action: "restart" | "stop" | "start" | "restart-terminal" | "restart-all",
): Promise<string> {
  await requirePremiumFeature("dashboard-panel-control");
  const { stdout, stderr } = await execFileAsync(
    "sudo",
    ["-n", PANEL_PM2_WRAPPER, action],
    { timeout: 300_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}
