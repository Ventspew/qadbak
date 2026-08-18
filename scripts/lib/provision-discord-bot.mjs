import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { dnsAdd } from "./provision-dns.mjs";
import { sslIssueBestEffort } from "./provision-ssl.mjs";
import { ensureSharedSubdomain, publishSharedSubDocroot } from "./ensure-shared-subdomain.mjs";
import {
  emit,
  fail,
  loadRegistry,
  saveRegistry,
  resolveDomainUser,
  domainConfigDir,
  readDomainConfigJson,
  writeDomainConfigJson,
  QADBAK_DIR,
} from "./provisioning-common.mjs";
import { assertComposePolicyYaml } from "./compose-policy.mjs";

const exec = promisify(execFile);

function parsePayload(payloadJson) {
  if (!payloadJson) return {};
  try {
    const o = JSON.parse(payloadJson);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function yamlQuote(s) {
  return JSON.stringify(String(s ?? ""));
}

function parseBool(v, fallback = true) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function sanitizeSecret(raw) {
  return String(raw || "").trim().replace(/[\r\n]/g, "");
}

function httpPortForDomain(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i += 1) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return 17900 + (h % 800);
}

function inviteUrl(clientId) {
  const id = String(clientId || "").trim();
  if (!id) return "";
  return (
    `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(id)}` +
    `&permissions=85056&integration_type=0&scope=bot%20applications.commands`
  );
}

function statusToken() {
  const secret = process.env.SESSION_SECRET?.trim() || "";
  if (secret.length < 16) return "";
  return createHmac("sha256", secret).update("qadbak-discord-bot-status-v1").digest("hex");
}

async function loadPanelDiscordNotify() {
  try {
    const raw = await readFile(path.join(QADBAK_DIR, "data", "discord-notify.json"), "utf8");
    const o = JSON.parse(raw);
    return {
      botToken: String(o.botToken || "").trim(),
      clientId: String(o.clientId || "").trim(),
      clientSecret: String(o.clientSecret || "").trim(),
      invite: String(o.invite || "").trim(),
      updatesChannelId: String(o.updatesChannelId || "").trim(),
    };
  } catch {
    return {
      botToken: "",
      clientId: "",
      clientSecret: "",
      invite: "",
      updatesChannelId: "",
    };
  }
}

function seedTasks(payload, botName) {
  const tasks = [];
  if (parseBool(payload.taskAlerts, true)) {
    tasks.push({ id: "alerts", enabled: true, type: "qadbak.alerts", params: {} });
  }
  if (parseBool(payload.taskStatus, true)) {
    tasks.push({
      id: "status",
      enabled: true,
      type: "qadbak.status",
      params: { name: "status", description: "Qadbak server status" },
    });
  }
  if (parseBool(payload.taskMinecraft, true)) {
    tasks.push({
      id: "minecraft",
      enabled: true,
      type: "minecraft.status",
      params: { name: "minecraft", description: "Minecraft server status" },
    });
  }
  if (parseBool(payload.taskHelp, true)) {
    tasks.push({
      id: "help",
      enabled: true,
      type: "qadbak.help",
      params: { name: "help", description: "List bot commands" },
    });
  }
  if (parseBool(payload.taskUptime, true)) {
    tasks.push({
      id: "uptime",
      enabled: true,
      type: "qadbak.uptime",
      params: { name: "uptime", description: "Bot and host uptime" },
    });
  }
  if (tasks.length === 0) {
    tasks.push({ id: "alerts", enabled: true, type: "qadbak.alerts", params: {} });
  }
  return { botName, tasks };
}

async function copyBotApp(dest) {
  const src = path.join(QADBAK_DIR, "integrations", "discord-bot");
  if (!(await access(src).then(() => true).catch(() => false))) {
    fail(`Missing ${src}`);
  }
  await mkdir(dest, { recursive: true });
  await exec("cp", ["-a", `${src}/.`, dest], { timeout: 30_000 });
}

async function uidGid(user) {
  const { stdout: uid } = await exec("id", ["-u", user]);
  const { stdout: gid } = await exec("id", ["-g", user]);
  return { uid: uid.trim(), gid: gid.trim() };
}

async function ensureDocker() {
  const script = path.join(QADBAK_DIR, "scripts", "lib", "ensure-docker.sh");
  if (!(await access(script).then(() => true).catch(() => false))) {
    fail(`Missing ${script}`);
  }
  try {
    await exec("bash", [script], { timeout: 600_000 });
  } catch (e) {
    fail(`Docker is required for the Discord bot: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function reloadNginx(domain, user) {
  const script = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  await exec("bash", [script, domain, user], { timeout: 120_000 });
}

async function upsertProxy(domain, loc, dest) {
  const proxies = await readDomainConfigJson(domain, "proxies.json", []);
  let pathKey = String(loc || "/").trim();
  if (!pathKey.startsWith("/")) pathKey = `/${pathKey}`;
  if (pathKey !== "/") pathKey = `${pathKey.replace(/\/+$/, "")}/`;
  const idx = proxies.findIndex((p) => p.path === pathKey);
  const row = { path: pathKey, dest: String(dest).trim(), type: "proxy" };
  if (idx >= 0) proxies[idx] = row;
  else proxies.push(row);
  await writeDomainConfigJson(domain, "proxies.json", proxies);
}

async function ensureBotSubdomain(parentDomain, user, subPrefix) {
  return ensureSharedSubdomain(parentDomain, user, subPrefix);
}

function buildCompose({
  user,
  appDir,
  dataDir,
  httpPort,
  publicUrl,
  botName,
  discordBotToken,
  discordClientId,
  discordClientSecret,
  discordInvite,
  sessionSecret,
  statusTokenValue,
  updatesChannelId,
  hostDiscordClientId,
}) {
  return `services:
  bot:
    build: ${appDir}
    container_name: qadbak-discord-bot-${user}
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "127.0.0.1:${httpPort}:8787"
    environment:
      PUBLIC_URL: ${yamlQuote(publicUrl)}
      BOT_NAME: ${yamlQuote(botName)}
      HOST_DISCORD_CLIENT_ID: ${yamlQuote(hostDiscordClientId)}
      DISCORD_BOT_TOKEN: ${yamlQuote(discordBotToken)}
      DISCORD_CLIENT_ID: ${yamlQuote(discordClientId)}
      DISCORD_CLIENT_SECRET: ${yamlQuote(discordClientSecret)}
      DISCORD_GUILD_INVITE: ${yamlQuote(discordInvite)}
      SESSION_SECRET: ${yamlQuote(sessionSecret)}
      SUBSCRIBERS_PATH: /data/discord-subscribers.json
      TASKS_PATH: /data/tasks.json
      DISCORD_UPDATES_CHANNEL: ${yamlQuote(updatesChannelId)}
      STATUS_URL: "http://host.docker.internal:3000/api/internal/discord-status"
      STATUS_TOKEN: ${yamlQuote(statusTokenValue)}
    volumes:
      - ${dataDir}:/data
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/status', timeout=3)"]
      interval: 15s
      timeout: 5s
      retries: 8
      start_period: 20s
`;
}

export async function discordBotInstall(domain, payloadJson) {
  const parent = String(domain || "").trim().toLowerCase();
  if (!parent) fail("domain required");
  const payload = parsePayload(payloadJson);
  const subPrefix = String(payload.subdomain || "bot").trim() || "bot";
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subPrefix)) {
    fail("Invalid subdomain prefix.");
  }
  const botName = String(payload.botName || "Qadbak").trim().slice(0, 80) || "Qadbak";
  const { user, home } = await resolveDomainUser(parent);
  const botHost = await ensureBotSubdomain(parent, user, subPrefix);

  const appsDir = path.join(home, "apps", "discord-bot");
  const dataDir = path.join(appsDir, "data");
  const appDir = path.join(appsDir, "app");
  await mkdir(dataDir, { recursive: true });
  await mkdir(appDir, { recursive: true });

  const existing = await readDomainConfigJson(parent, "discord-bot.json", null);
  const sessionSecret = existing?.sessionSecret || randomBytes(24).toString("hex");
  const panelDiscord = await loadPanelDiscordNotify();
  const discordBotToken =
    sanitizeSecret(payload.discordBotToken) || existing?.discordBotToken || "";
  const discordClientId =
    sanitizeSecret(payload.discordClientId) || existing?.discordClientId || "";
  const discordClientSecret =
    sanitizeSecret(payload.discordClientSecret) || existing?.discordClientSecret || "";
  const discordInvite =
    sanitizeSecret(payload.discordInvite) || existing?.discordInvite || "";
  const updatesChannelId =
    sanitizeSecret(payload.updatesChannelId) || existing?.updatesChannelId || "";

  if (!discordBotToken || !discordClientId) {
    fail(
      "Each Discord Bot app needs its own Developer Portal application. " +
        "Paste that app's bot token and client ID (not the panel host bot). " +
        "Create one at https://discord.com/developers/applications — Bot + OAuth2.",
    );
  }
  if (
    (panelDiscord.clientId && discordClientId === panelDiscord.clientId) ||
    (panelDiscord.botToken && discordBotToken === panelDiscord.botToken)
  ) {
    fail(
      "That Discord application is the panel host bot (Server → Discord). " +
        "Customer bots must use a different application. Create one at " +
        "https://discord.com/developers/applications and invite that bot to YOUR server.",
    );
  }

  const recipes = seedTasks(payload, botName);
  await writeFile(path.join(dataDir, "tasks.json"), `${JSON.stringify(recipes, null, 2)}\n`);

  await copyBotApp(appDir);
  const httpPort = existing?.httpPort || httpPortForDomain(parent);
  const publicUrl = `https://${botHost}`;
  const statusTokenValue = statusToken();
  const composePath = path.join(appsDir, "docker-compose.yml");
  const compose = buildCompose({
    user,
    appDir,
    dataDir,
    httpPort,
    publicUrl,
    botName,
    discordBotToken,
    discordClientId,
    discordClientSecret,
    discordInvite,
    sessionSecret,
    statusTokenValue,
    updatesChannelId,
    hostDiscordClientId: panelDiscord.clientId || "",
  });
  assertComposePolicyYaml(compose);
  await writeFile(composePath, compose, "utf8");
  const { uid, gid } = await uidGid(user);
  await exec("chown", ["-R", `${user}:${user}`, appsDir], { timeout: 60_000 }).catch(() => {});
  void uid;
  void gid;

  await ensureDocker();
  await exec("docker", ["compose", "-f", composePath, "build", "bot"], {
    timeout: 600_000,
  }).catch((e) => emit(`WARN: bot build: ${e instanceof Error ? e.message : String(e)}`));
  await exec("docker", ["compose", "-f", composePath, "up", "-d"], {
    timeout: 600_000,
  });

  const originIp = process.env.QADBAK_ORIGIN_IP?.trim() || "";
  if (originIp) {
    await dnsAdd(parent, { name: subPrefix, type: "A", value: originIp }).catch(() => {});
  }
  await publishSharedSubDocroot(home, botHost, user, path.join(appsDir, "www"));
  await upsertProxy(botHost, "/", `http://127.0.0.1:${httpPort}`);
  await reloadNginx(botHost, user);
  await sslIssueBestEffort(botHost, botHost);

  const cfg = {
    parentDomain: parent,
    subdomain: botHost,
    subPrefix,
    botName,
    httpPort,
    sessionSecret,
    discordBotToken,
    discordClientId,
    discordClientSecret,
    discordInvite,
    discordEnabled: Boolean(discordBotToken && discordClientId && discordClientSecret),
    composePath,
    dataDir,
    installedAt: new Date().toISOString(),
  };
  await writeDomainConfigJson(parent, "discord-bot.json", cfg);

  const installed = await readDomainConfigJson(parent, "scripts.json", []);
  const row = {
    name: "discord-bot",
    path: "apps/discord-bot",
    installedAt: cfg.installedAt,
    adminUrl: publicUrl,
  };
  const idx = installed.findIndex((s) => s.name === "discord-bot");
  if (idx >= 0) installed[idx] = row;
  else installed.push(row);
  await writeDomainConfigJson(parent, "scripts.json", installed);

  const botInvite = inviteUrl(discordClientId);
  const result = {
    ok: true,
    domain: parent,
    subdomain: botHost,
    adminUrl: publicUrl,
    botName,
    inviteUrl: botInvite,
    discordEnabled: Boolean(discordBotToken && discordClientId && discordClientSecret),
    discordLogin: `${publicUrl}/login`,
    botRedirectUri: `${publicUrl}/auth/callback`,
    slashCommands: (recipes.tasks || [])
      .filter((t) => t.enabled !== false && ["qadbak.status", "qadbak.help", "qadbak.uptime", "minecraft.status", "slash.reply", "slash.embed", "poll.create"].includes(t.type))
      .map((t) => `!${t.params?.name || t.type.replace(/^qadbak\./, "").replace(/^minecraft\./, "").replace(/^slash\./, "")}`),
    postInstall: [
      botInvite
        ? `Invite THIS app's bot to YOUR Discord server: ${botInvite}`
        : "Paste a bot token + client ID from your own Discord application, then re-run.",
      `Public page for this domain: ${publicUrl}`,
      `Add OAuth redirect: ${publicUrl}/auth/callback in that same Discord application.`,
      "Do not reuse the panel host bot — every customer creates their own Discord application.",
      "Type !status in Discord. Enable Message Content Intent for !commands in a server (DMs work without it).",
    ],
  };
  emit(result);
  return result;
}

export async function discordBotStatus(domain) {
  const name = String(domain || "").trim().toLowerCase();
  if (!name) fail("domain required");
  const rows = await loadRegistry();
  const row = rows.find((r) => String(r.name).toLowerCase() === name);
  const parent = row?.parent ? String(row.parent).toLowerCase() : name;
  const cfg = await readDomainConfigJson(parent, "discord-bot.json", null);
  if (!cfg) {
    emit({ ok: true, installed: false, parentDomain: parent });
    return;
  }
  let containerStatus = "unknown";
  try {
    const { user } = await resolveDomainUser(parent);
    const { stdout } = await exec(
      "docker",
      ["inspect", "-f", "{{.State.Status}}", `qadbak-discord-bot-${user}`],
      { timeout: 15_000 },
    );
    containerStatus = stdout.trim() || "unknown";
  } catch {
    containerStatus = "not_found";
  }
  emit({
    ok: true,
    installed: true,
    parentDomain: cfg.parentDomain,
    subdomain: cfg.subdomain,
    botName: cfg.botName,
    discordEnabled: Boolean(cfg.discordEnabled),
    containerStatus,
    inviteUrl: inviteUrl(cfg.discordClientId),
    installedAt: cfg.installedAt,
  });
}

export async function discordBotSyncTasks() {
  // Host recipes stay on the operator gateway (bind-mounted discord-bot.json).
  // Customer installs never inherit the panel bot's tasks or token.
  emit({ ok: true, synced: 0 });
}
