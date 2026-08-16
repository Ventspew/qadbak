import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { dnsAdd } from "./provision-dns.mjs";
import { sslIssue } from "./provision-ssl.mjs";
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
    `&permissions=85056&scope=bot%20applications.commands`
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
    };
  } catch {
    return { botToken: "", clientId: "", clientSecret: "", invite: "" };
  }
}

async function loadPanelRecipes() {
  try {
    const raw = await readFile(path.join(QADBAK_DIR, "data", "discord-bot.json"), "utf8");
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
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
  if (!(await access(script).catch(() => false))) fail(`Missing ${script}`);
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
  const host = `${subPrefix}.${parentDomain}`;
  const rows = await loadRegistry();
  if (rows.some((r) => r.name === host)) return host;
  const parentRow = rows.find((r) => r.name === parentDomain);
  if (!parentRow) fail(`Unknown parent domain: ${parentDomain}`);
  rows.push({
    name: host,
    user,
    disabled: false,
    plan: parentRow.plan || "Default",
    type: "sub",
    parent: parentDomain,
    isDefault: false,
  });
  await saveRegistry(rows);
  const home = `/home/${user}`;
  await mkdir(domainConfigDir(host), { recursive: true });
  await mkdir(path.join(home, "public_html"), { recursive: true });
  await reloadNginx(host, user);
  return host;
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
      DISCORD_BOT_TOKEN: ${yamlQuote(discordBotToken)}
      DISCORD_CLIENT_ID: ${yamlQuote(discordClientId)}
      DISCORD_CLIENT_SECRET: ${yamlQuote(discordClientSecret)}
      DISCORD_GUILD_INVITE: ${yamlQuote(discordInvite)}
      SESSION_SECRET: ${yamlQuote(sessionSecret)}
      SUBSCRIBERS_PATH: /data/discord-subscribers.json
      TASKS_PATH: /data/tasks.json
      STATUS_URL: "http://host.docker.internal:3000/api/internal/discord-status"
      STATUS_TOKEN: ${yamlQuote(statusTokenValue)}
    volumes:
      - ${dataDir}:/data
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
    sanitizeSecret(payload.discordBotToken) ||
    panelDiscord.botToken ||
    existing?.discordBotToken ||
    "";
  const discordClientId =
    sanitizeSecret(payload.discordClientId) ||
    panelDiscord.clientId ||
    existing?.discordClientId ||
    "";
  const discordClientSecret =
    sanitizeSecret(payload.discordClientSecret) ||
    panelDiscord.clientSecret ||
    existing?.discordClientSecret ||
    "";
  const discordInvite =
    sanitizeSecret(payload.discordInvite) ||
    panelDiscord.invite ||
    existing?.discordInvite ||
    "";

  const panelRecipes = await loadPanelRecipes();
  const recipes =
    panelRecipes?.tasks?.length > 0
      ? { botName: panelRecipes.botName || botName, tasks: panelRecipes.tasks }
      : seedTasks(payload, botName);
  await writeFile(path.join(dataDir, "tasks.json"), `${JSON.stringify(recipes, null, 2)}\n`);
  await writeFile(
    path.join(QADBAK_DIR, "data", "discord-bot.json"),
    `${JSON.stringify(recipes, null, 2)}\n`,
  );

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
  await writeDomainConfigJson(botHost, "website.json", {
    webRoot: path.join(appsDir, "www"),
    mode: "static",
    wwwRedirect: "none",
  });
  await mkdir(path.join(appsDir, "www"), { recursive: true });
  await upsertProxy(botHost, "/", `http://127.0.0.1:${httpPort}/`);
  await reloadNginx(botHost, user);
  await sslIssue(botHost, botHost).catch(() => {});

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
      .filter((t) => t.enabled !== false && ["qadbak.status", "minecraft.status", "slash.reply"].includes(t.type))
      .map((t) => `/${t.params?.name || t.type}`),
    postInstall: [
      botInvite
        ? `Add the bot to Discord (one click): ${botInvite}`
        : "Paste a bot token + OAuth client id/secret on /admin/discord, then re-run this install or click Invite.",
      `Public page: ${publicUrl}`,
      `Assign slash commands and replies without code at the panel: /admin/discord`,
      `Player/admin OAuth redirect: ${publicUrl}auth/callback`,
      "In Discord Developer Portal enable Message Content + Server Members intents for keyword replies and welcomes.",
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
  const recipesPath = path.join(QADBAK_DIR, "data", "discord-bot.json");
  let body;
  try {
    body = `${JSON.stringify(JSON.parse(await readFile(recipesPath, "utf8")), null, 2)}\n`;
  } catch {
    fail("No discord-bot.json recipes yet.");
  }
  const dir = path.join(QADBAK_DIR, "data", "domain-config");
  let domains = [];
  try {
    domains = await readdir(dir);
  } catch {
    emit({ ok: true, synced: 0 });
    return;
  }
  let synced = 0;
  for (const name of domains) {
    const cfg = await readDomainConfigJson(name, "discord-bot.json", null);
    if (!cfg?.dataDir) continue;
    await mkdir(cfg.dataDir, { recursive: true });
    await writeFile(path.join(cfg.dataDir, "tasks.json"), body, "utf8");
    synced += 1;
  }
  emit({ ok: true, synced });
}
