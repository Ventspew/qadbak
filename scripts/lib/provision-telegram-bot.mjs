import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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

function sanitizeUsername(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 32);
}

function httpPortForDomain(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i += 1) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return 18700 + (h % 800);
}

function inviteUrl(username) {
  const name = sanitizeUsername(username);
  if (!name) return "";
  return `https://t.me/${encodeURIComponent(name)}?startgroup=1`;
}

function statusToken() {
  const secret = process.env.SESSION_SECRET?.trim() || "";
  if (secret.length < 16) return "";
  return createHmac("sha256", secret).update("qadbak-discord-bot-status-v1").digest("hex");
}

async function fetchBotUsername(token) {
  if (!token) return "";
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      headers: { "User-Agent": "QadbakTelegramProvision/1.0" },
    });
    if (!res.ok) return "";
    const body = await res.json();
    return sanitizeUsername(body?.result?.username || "");
  } catch {
    return "";
  }
}

const TELEGRAM_TASK_TYPES = new Set([
  "qadbak.alerts",
  "qadbak.status",
  "qadbak.help",
  "qadbak.uptime",
  "minecraft.status",
  "command.reply",
  "keyword.reply",
  "scheduled.post",
  "welcome",
]);

function commandName(raw, fallback) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 32);
  return s || fallback;
}

function defaultTasks(botName) {
  return {
    botName: String(botName || "Qadbak").trim().slice(0, 80) || "Qadbak",
    tasks: [
      { id: "alerts", enabled: true, type: "qadbak.alerts", params: {} },
      { id: "status", enabled: true, type: "qadbak.status", params: { name: "status" } },
      { id: "minecraft", enabled: true, type: "minecraft.status", params: { name: "minecraft" } },
      { id: "help", enabled: true, type: "qadbak.help", params: { name: "help" } },
      { id: "uptime", enabled: true, type: "qadbak.uptime", params: { name: "uptime" } },
    ],
  };
}

function normalizeRecipes(input, fallbackName = "Qadbak") {
  const o = input && typeof input === "object" ? input : {};
  const tasksRaw = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks = [];
  for (const row of tasksRaw) {
    if (!row || typeof row !== "object") continue;
    const type = String(row.type || "");
    if (!TELEGRAM_TASK_TYPES.has(type)) continue;
    const paramsIn = row.params && typeof row.params === "object" ? row.params : {};
    const params = {};
    for (const [k, v] of Object.entries(paramsIn)) {
      if (typeof v === "string") params[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") params[k] = String(v);
    }
    if (type === "qadbak.status") params.name = commandName(params.name, "status");
    if (type === "minecraft.status") params.name = commandName(params.name, "minecraft");
    if (type === "qadbak.help") params.name = commandName(params.name, "help");
    if (type === "qadbak.uptime") params.name = commandName(params.name, "uptime");
    if (type === "command.reply") params.name = commandName(params.name, "");
    const id = String(row.id || "").trim() || `task-${type.replace(".", "-")}`;
    tasks.push({
      id: id.slice(0, 64),
      enabled: row.enabled !== false,
      type,
      params,
    });
  }
  const botName =
    typeof o.botName === "string" && o.botName.trim()
      ? o.botName.trim().slice(0, 80)
      : fallbackName;
  return tasks.length > 0 ? { botName, tasks } : defaultTasks(botName);
}

function commandsFromRecipes(recipes) {
  const out = [{ command: "start", description: "Link this chat" }];
  const used = new Set(["start"]);
  for (const task of recipes.tasks || []) {
    if (!task.enabled) continue;
    let name = "";
    let description = "Qadbak command";
    if (task.type === "qadbak.status") {
      name = commandName(task.params?.name, "status");
      description = "Server status";
    } else if (task.type === "minecraft.status") {
      name = commandName(task.params?.name, "minecraft");
      description = "Minecraft status";
    } else if (task.type === "qadbak.help") {
      name = commandName(task.params?.name, "help");
      description = "List bot commands";
    } else if (task.type === "qadbak.uptime") {
      name = commandName(task.params?.name, "uptime");
      description = "Bot uptime";
    } else if (task.type === "command.reply") {
      name = commandName(task.params?.name, "");
      description = String(task.params?.text || "Custom reply").slice(0, 256);
    }
    if (!name || used.has(name)) continue;
    used.add(name);
    out.push({ command: name, description: description.slice(0, 256) });
  }
  return out.slice(0, 100);
}

async function setBotCommands(token, recipes) {
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "QadbakTelegramProvision/1.0",
      },
      body: JSON.stringify({ commands: commandsFromRecipes(recipes) }),
    });
  } catch (e) {
    emit(`WARN: setMyCommands: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function resolveTelegramParent(domain) {
  const name = String(domain || "").trim().toLowerCase();
  if (!name) fail("domain required");
  const rows = await loadRegistry();
  const row = rows.find((r) => String(r.name).toLowerCase() === name);
  return row?.parent ? String(row.parent).toLowerCase() : name;
}

async function inspectContainer(parent) {
  try {
    const { user } = await resolveDomainUser(parent);
    const { stdout } = await exec(
      "docker",
      ["inspect", "-f", "{{.State.Status}}", `qadbak-telegram-bot-${user}`],
      { timeout: 15_000 },
    );
    return stdout.trim() || "unknown";
  } catch {
    return "not_found";
  }
}

async function readRecipes(cfg) {
  const fallback = defaultTasks(cfg?.botName || "Qadbak");
  if (!cfg?.dataDir) return fallback;
  try {
    const raw = await readFile(path.join(cfg.dataDir, "tasks.json"), "utf8");
    return normalizeRecipes(JSON.parse(raw), cfg.botName || "Qadbak");
  } catch {
    return fallback;
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
      params: { name: "status" },
    });
  }
  if (parseBool(payload.taskMinecraft, true)) {
    tasks.push({
      id: "minecraft",
      enabled: true,
      type: "minecraft.status",
      params: { name: "minecraft" },
    });
  }
  if (parseBool(payload.taskHelp, true)) {
    tasks.push({
      id: "help",
      enabled: true,
      type: "qadbak.help",
      params: { name: "help" },
    });
  }
  if (parseBool(payload.taskUptime, true)) {
    tasks.push({
      id: "uptime",
      enabled: true,
      type: "qadbak.uptime",
      params: { name: "uptime" },
    });
  }
  if (tasks.length === 0) {
    tasks.push({ id: "alerts", enabled: true, type: "qadbak.alerts", params: {} });
  }
  return { botName, tasks };
}

async function copyBotApp(dest) {
  const src = path.join(QADBAK_DIR, "integrations", "telegram-bot");
  if (!(await access(src).then(() => true).catch(() => false))) {
    fail(`Missing ${src}`);
  }
  await mkdir(dest, { recursive: true });
  await exec("cp", ["-a", `${src}/.`, dest], { timeout: 30_000 });
}

async function ensureDocker() {
  const script = path.join(QADBAK_DIR, "scripts", "lib", "ensure-docker.sh");
  if (!(await access(script).then(() => true).catch(() => false))) {
    fail(`Missing ${script}`);
  }
  try {
    await exec("bash", [script], { timeout: 600_000 });
  } catch (e) {
    fail(`Docker is required for the Telegram bot: ${e instanceof Error ? e.message : String(e)}`);
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
  telegramBotToken,
  telegramChatId,
  statusTokenValue,
}) {
  return `services:
  bot:
    build: ${appDir}
    container_name: qadbak-telegram-bot-${user}
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "127.0.0.1:${httpPort}:8788"
    environment:
      PUBLIC_URL: ${yamlQuote(publicUrl)}
      BOT_NAME: ${yamlQuote(botName)}
      TELEGRAM_BOT_TOKEN: ${yamlQuote(telegramBotToken)}
      TELEGRAM_CHAT_ID: ${yamlQuote(telegramChatId)}
      SUBSCRIBERS_PATH: /data/telegram-subscribers.json
      TASKS_PATH: /data/tasks.json
      STATUS_URL: "http://host.docker.internal:3000/api/internal/discord-status"
      STATUS_TOKEN: ${yamlQuote(statusTokenValue)}
    volumes:
      - ${dataDir}:/data
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8788/api/status', timeout=3)"]
      interval: 15s
      timeout: 5s
      retries: 8
      start_period: 20s
`;
}

export async function telegramBotInstall(domain, payloadJson) {
  const parent = String(domain || "").trim().toLowerCase();
  if (!parent) fail("domain required");
  const payload = parsePayload(payloadJson);
  const subPrefix = String(payload.subdomain || "tg").trim() || "tg";
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subPrefix)) {
    fail("Invalid subdomain prefix.");
  }
  const botName = String(payload.botName || "Qadbak").trim().slice(0, 80) || "Qadbak";
  const { user, home } = await resolveDomainUser(parent);
  const botHost = await ensureBotSubdomain(parent, user, subPrefix);

  const appsDir = path.join(home, "apps", "telegram-bot");
  const dataDir = path.join(appsDir, "data");
  const appDir = path.join(appsDir, "app");
  await mkdir(dataDir, { recursive: true });
  await mkdir(appDir, { recursive: true });

  const existing = await readDomainConfigJson(parent, "telegram-bot.json", null);
  const telegramBotToken =
    sanitizeSecret(payload.telegramBotToken) || existing?.telegramBotToken || "";
  const telegramChatId =
    sanitizeSecret(payload.telegramChatId) || existing?.telegramChatId || "";
  let telegramBotUsername =
    sanitizeUsername(payload.telegramBotUsername) ||
    sanitizeUsername(existing?.telegramBotUsername) ||
    "";

  if (!telegramBotToken) {
    fail(
      "Each Telegram Bot app needs its own BotFather token. " +
        "Create a bot at https://t.me/BotFather, then paste THAT token here. " +
        "Do not reuse a Discord token or another customer's Telegram bot.",
    );
  }

  if (!telegramBotUsername) {
    telegramBotUsername = await fetchBotUsername(telegramBotToken);
  }

  const recipes = normalizeRecipes(seedTasks(payload, botName), botName);
  await writeFile(path.join(dataDir, "tasks.json"), `${JSON.stringify(recipes, null, 2)}\n`);
  await setBotCommands(telegramBotToken, recipes);

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
    telegramBotToken,
    telegramChatId,
    statusTokenValue,
  });
  assertComposePolicyYaml(compose);
  await writeFile(composePath, compose, "utf8");
  await exec("chown", ["-R", `${user}:${user}`, appsDir], { timeout: 60_000 }).catch(() => {});

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
  await upsertProxy(botHost, "/", `http://127.0.0.1:${httpPort}`);
  await reloadNginx(botHost, user);
  await sslIssue(botHost, botHost).catch(() => {});

  const cfg = {
    parentDomain: parent,
    subdomain: botHost,
    subPrefix,
    botName,
    httpPort,
    telegramBotToken,
    telegramBotUsername,
    telegramChatId,
    telegramEnabled: Boolean(telegramBotToken),
    composePath,
    dataDir,
    installedAt: new Date().toISOString(),
  };
  await writeDomainConfigJson(parent, "telegram-bot.json", cfg);

  const installed = await readDomainConfigJson(parent, "scripts.json", []);
  const row = {
    name: "telegram-bot",
    path: "apps/telegram-bot",
    installedAt: cfg.installedAt,
    adminUrl: publicUrl,
  };
  const idx = installed.findIndex((s) => s.name === "telegram-bot");
  if (idx >= 0) installed[idx] = row;
  else installed.push(row);
  await writeDomainConfigJson(parent, "scripts.json", installed);

  const botInvite = inviteUrl(telegramBotUsername);
  const result = {
    ok: true,
    domain: parent,
    subdomain: botHost,
    adminUrl: publicUrl,
    botName,
    botUsername: telegramBotUsername,
    inviteUrl: botInvite,
    telegramEnabled: Boolean(telegramBotToken),
    commands: commandsFromRecipes(recipes).map((c) => `/${c.command}`),
    postInstall: [
      botInvite
        ? `Add THIS bot to YOUR Telegram group: ${botInvite}`
        : "Open Telegram, search the bot by the name you gave BotFather, then add it to your group.",
      `Public page for this domain: ${publicUrl}`,
      `Edit commands later in the panel: Domains → ${parent} → Telegram.`,
      "Every customer creates their own bot in BotFather — do not reuse another domain's token.",
      "In a group, grant the bot permission to send messages. Then send /start.",
    ],
  };
  emit(result);
  return result;
}

export async function telegramBotStatus(domain) {
  const parent = await resolveTelegramParent(domain);
  const cfg = await readDomainConfigJson(parent, "telegram-bot.json", null);
  if (!cfg) {
    emit({ ok: true, installed: false, parentDomain: parent });
    return;
  }
  emit({
    ok: true,
    installed: true,
    parentDomain: cfg.parentDomain,
    subdomain: cfg.subdomain,
    botName: cfg.botName,
    botUsername: cfg.telegramBotUsername || "",
    telegramEnabled: Boolean(cfg.telegramEnabled),
    containerStatus: await inspectContainer(parent),
    inviteUrl: inviteUrl(cfg.telegramBotUsername),
    installedAt: cfg.installedAt,
  });
}

export async function telegramBotGetTasks(domain) {
  const parent = await resolveTelegramParent(domain);
  const cfg = await readDomainConfigJson(parent, "telegram-bot.json", null);
  if (!cfg) {
    emit({
      ok: true,
      installed: false,
      parentDomain: parent,
      recipes: defaultTasks("Qadbak"),
      commands: commandsFromRecipes(defaultTasks("Qadbak")),
    });
    return;
  }
  const recipes = await readRecipes(cfg);
  emit({
    ok: true,
    installed: true,
    parentDomain: cfg.parentDomain || parent,
    subdomain: cfg.subdomain,
    publicUrl: cfg.subdomain ? `https://${cfg.subdomain}/` : "",
    botName: recipes.botName || cfg.botName,
    botUsername: cfg.telegramBotUsername || "",
    telegramEnabled: Boolean(cfg.telegramEnabled),
    containerStatus: await inspectContainer(parent),
    inviteUrl: inviteUrl(cfg.telegramBotUsername),
    installedAt: cfg.installedAt,
    recipes,
    commands: commandsFromRecipes(recipes),
  });
}

export async function telegramBotSaveTasks(domain, payloadJson) {
  const parent = await resolveTelegramParent(domain);
  const cfg = await readDomainConfigJson(parent, "telegram-bot.json", null);
  if (!cfg?.dataDir) fail("Telegram Bot is not installed on this domain.");
  const recipes = normalizeRecipes(parsePayload(payloadJson), cfg.botName || "Qadbak");
  await mkdir(cfg.dataDir, { recursive: true });
  await writeFile(path.join(cfg.dataDir, "tasks.json"), `${JSON.stringify(recipes, null, 2)}\n`);
  if (recipes.botName && recipes.botName !== cfg.botName) {
    await writeDomainConfigJson(parent, "telegram-bot.json", { ...cfg, botName: recipes.botName });
  }
  await setBotCommands(cfg.telegramBotToken, recipes);
  emit({
    ok: true,
    installed: true,
    parentDomain: cfg.parentDomain || parent,
    subdomain: cfg.subdomain,
    publicUrl: cfg.subdomain ? `https://${cfg.subdomain}/` : "",
    botName: recipes.botName,
    botUsername: cfg.telegramBotUsername || "",
    telegramEnabled: Boolean(cfg.telegramEnabled),
    containerStatus: await inspectContainer(parent),
    inviteUrl: inviteUrl(cfg.telegramBotUsername),
    recipes,
    commands: commandsFromRecipes(recipes),
  });
}
