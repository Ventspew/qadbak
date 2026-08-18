import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emit, QADBAK_DIR } from "./provisioning-common.mjs";

const exec = promisify(execFile);

function yamlQuote(s) {
  return JSON.stringify(String(s ?? ""));
}

function loadEnvLocal(root) {
  const env = { ...process.env };
  try {
    const raw = readFileSync(path.join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (env[key] === undefined) env[key] = val;
    }
  } catch {
    /* missing .env.local */
  }
  return env;
}

function statusToken(secret) {
  const s = String(secret || "").trim();
  if (s.length < 16) return "";
  return createHmac("sha256", s).update("qadbak-discord-bot-status-v1").digest("hex");
}

function buildCompose({
  appDir,
  dataDir,
  tasksFile,
  subsFile,
  token,
  clientId,
  clientSecret,
  invite,
  channelId,
  botName,
  sessionSecret,
  statusTokenValue,
}) {
  return `services:
  bot:
    build: ${appDir}
    container_name: qadbak-discord-bot-host
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "127.0.0.1:12787:8787"
    environment:
      BIND: "0.0.0.0"
      PUBLIC_URL: "http://127.0.0.1:12787"
      BOT_NAME: ${yamlQuote(botName)}
      QADBAK_HOST_GATEWAY: "1"
      QADBAK_GATEWAY: "1"
      DISCORD_BOT_TOKEN: ${yamlQuote(token)}
      DISCORD_CLIENT_ID: ${yamlQuote(clientId)}
      DISCORD_CLIENT_SECRET: ${yamlQuote(clientSecret)}
      DISCORD_GUILD_INVITE: ${yamlQuote(invite)}
      DISCORD_UPDATES_CHANNEL: ${yamlQuote(channelId)}
      SESSION_SECRET: ${yamlQuote(sessionSecret)}
      SUBSCRIBERS_PATH: /data/discord-subscribers.json
      TASKS_PATH: /data/tasks.json
      WATCH_STATE_PATH: /data/state/host-watch.json
      STATUS_URL: "http://host.docker.internal:3000/api/internal/discord-status"
      STATUS_TOKEN: ${yamlQuote(statusTokenValue)}
    volumes:
      - ${yamlQuote(`${tasksFile}:/data/tasks.json:ro`)}
      - ${yamlQuote(`${subsFile}:/data/discord-subscribers.json`)}
      - ${yamlQuote(`${dataDir}:/data/state`)}
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/status', timeout=3)"]
      interval: 15s
      timeout: 5s
      retries: 8
      start_period: 20s
`;
}

/** Panel operator Discord gateway — commands without a public bot.* page. */
export async function ensureHostDiscordBot() {
  const root = QADBAK_DIR;
  const env = loadEnvLocal(root);
  const dir = path.join(root, "data", "host-discord-bot");
  const appDir = path.join(dir, "app");
  const dataDir = path.join(dir, "data");
  const composePath = path.join(dir, "docker-compose.yml");
  await mkdir(dataDir, { recursive: true });
  await mkdir(appDir, { recursive: true });

  let notify = {};
  try {
    notify = JSON.parse(await readFile(path.join(root, "data", "discord-notify.json"), "utf8"));
  } catch {
    notify = {};
  }
  const token = String(notify.botToken || "").trim();
  const clientId = String(notify.clientId || "").trim();
  const clientSecret = String(notify.clientSecret || "").trim();
  const invite = String(notify.invite || "").trim();
  const channelId = String(notify.updatesChannelId || "").trim();
  const enabled = notify.enabled !== false;

  const down = async () => {
    try {
      await exec("docker", ["compose", "-f", composePath, "down"], { timeout: 120_000 });
    } catch {
      /* not running */
    }
  };

  if (!token || !enabled) {
    await down();
    emit({ ok: true, running: false, reason: "no host bot token" });
    return;
  }

  const tasksFile = path.join(root, "data", "discord-bot.json");
  let recipes = { botName: "Qadbak", tasks: [] };
  try {
    recipes = JSON.parse(await readFile(tasksFile, "utf8"));
  } catch {
    recipes = { botName: "Qadbak", tasks: [] };
    await writeFile(tasksFile, `${JSON.stringify(recipes, null, 2)}\n`);
  }
  const subsFile = path.join(root, "data", "discord-subscribers.json");
  try {
    await readFile(subsFile);
  } catch {
    await writeFile(subsFile, '{"users":{}}\n');
  }

  const src = path.join(root, "integrations", "discord-bot");
  await cp(src, appDir, { recursive: true, force: true });

  const sessionSecret = String(env.SESSION_SECRET || "").trim();
  const compose = buildCompose({
    appDir,
    dataDir,
    tasksFile,
    subsFile,
    token,
    clientId,
    clientSecret,
    invite,
    channelId,
    botName: String(recipes.botName || "Qadbak").slice(0, 80) || "Qadbak",
    sessionSecret,
    statusTokenValue: statusToken(sessionSecret),
  });
  await writeFile(composePath, compose, "utf8");

  try {
    await exec("docker", ["compose", "-f", composePath, "build", "bot"], {
      timeout: 600_000,
    });
    await exec("docker", ["compose", "-f", composePath, "up", "-d"], {
      timeout: 180_000,
    });
  } catch (e) {
    emit({
      ok: false,
      running: false,
      error: `host discord bot docker: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }
  emit({
    ok: true,
    running: true,
    container: "qadbak-discord-bot-host",
    hint: "Type !ping in a DM with the bot, or /ping in a server after Invite.",
  });
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  await ensureHostDiscordBot();
}
