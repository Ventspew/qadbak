import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "path";
import { promisify } from "util";
import { getHostMetrics } from "./host-metrics";

const execFileAsync = promisify(execFile);

export type DiscordStatusSnapshot = {
  hostname: string;
  loadAvg: [number, number, number];
  memoryUsePct: number;
  disks: Array<{ mount: string; usePct: number }>;
  docker: Array<{ name: string; state: string }>;
  minecraft: {
    installed: boolean;
    online: boolean;
    joinAddress?: string;
    players: string[];
  } | null;
};

async function dockerPs(): Promise<Array<{ name: string; state: string }>> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "-a", "--format", "{{.Names}}\t{{.State}}"],
      { timeout: 8000 },
    );
    const rows: Array<{ name: string; state: string }> = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [name, state] = line.split("\t");
      if (name) rows.push({ name, state: (state || "unknown").trim() });
    }
    return rows;
  } catch {
    return [];
  }
}

function onlinePlayersFromLog(raw: string): string[] {
  const online = new Set<string>();
  const joinRe = /: ([^\[\]\s:]+) joined the game/;
  const leaveRe = /: ([^\[\]\s:]+) left the game/;
  for (const line of raw.split("\n")) {
    const join = joinRe.exec(line);
    if (join) {
      online.add(join[1]);
      continue;
    }
    const leave = leaveRe.exec(line);
    if (leave) online.delete(leave[1]);
  }
  return [...online].slice(0, 40);
}

async function minecraftSnapshot(
  docker: Array<{ name: string; state: string }>,
): Promise<DiscordStatusSnapshot["minecraft"]> {
  const dir = path.join(process.cwd(), "data", "domain-config");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name, "minecraft.json"), "utf8");
      const cfg = JSON.parse(raw) as {
        subdomain?: string;
        port?: number;
        dataDir?: string;
        parentDomain?: string;
      };
      if (!cfg.dataDir && !cfg.subdomain) continue;
      const mcName = docker.find((d) => d.name.startsWith("qadbak-mc-") && !d.name.includes("notify"));
      const online = mcName?.state === "running";
      const join =
        cfg.port && cfg.port !== 25565 && cfg.subdomain
          ? `${cfg.subdomain}:${cfg.port}`
          : cfg.subdomain;
      let players: string[] = [];
      if (cfg.dataDir) {
        try {
          const log = await readFile(path.join(cfg.dataDir, "logs", "latest.log"), "utf8");
          players = onlinePlayersFromLog(log.slice(-80_000));
        } catch {
          players = [];
        }
      }
      return {
        installed: true,
        online: Boolean(online),
        joinAddress: join,
        players,
      };
    } catch {
      /* next */
    }
  }
  return null;
}

export async function getDiscordStatusSnapshot(): Promise<DiscordStatusSnapshot> {
  let metrics;
  try {
    metrics = await getHostMetrics();
  } catch {
    metrics = null;
  }
  const docker = await dockerPs();
  const minecraft = await minecraftSnapshot(docker);
  return {
    hostname: metrics?.hostname || "qadbak",
    loadAvg: metrics?.loadAvg ?? [0, 0, 0],
    memoryUsePct: metrics?.memory.usePct ?? 0,
    disks: (metrics?.disks ?? []).map((d) => ({ mount: d.mount, usePct: d.usePct })),
    docker: docker.slice(0, 40),
    minecraft,
  };
}
