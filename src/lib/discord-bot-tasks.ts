import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import fs from "fs/promises";
import path from "path";

const TASKS_PATH = path.join(process.cwd(), "data", "discord-bot.json");
const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "QadbakNotify/1.0";

export const DISCORD_BOT_TASK_TYPES = [
  "qadbak.alerts",
  "qadbak.status",
  "qadbak.help",
  "qadbak.uptime",
  "qadbak.disk",
  "qadbak.docker",
  "qadbak.load",
  "qadbak.ping",
  "qadbak.about",
  "qadbak.invite",
  "minecraft.status",
  "slash.reply",
  "slash.embed",
  "poll.create",
  "scheduled.post",
  "auto.role",
  "keyword.reply",
  "welcome",
  "announce",
] as const;

export type DiscordBotTaskType = (typeof DISCORD_BOT_TASK_TYPES)[number];

export interface DiscordBotTask {
  id: string;
  enabled: boolean;
  type: DiscordBotTaskType;
  params: Record<string, string>;
}

export interface DiscordBotRecipes {
  botName: string;
  tasks: DiscordBotTask[];
}

export interface PublicDiscordBotInstall {
  parentDomain: string;
  subdomain: string;
  botName: string;
  publicUrl: string;
  inviteUrl: string;
  botRedirectUri: string;
}

const TYPE_SET = new Set<string>(DISCORD_BOT_TASK_TYPES);

export function discordBotInviteUrl(clientId: string): string {
  const id = clientId.trim();
  if (!id) return "";
  return (
    `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(id)}` +
    `&permissions=85056&integration_type=0&scope=bot%20applications.commands`
  );
}

function slashName(raw: string, fallback: string): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 32);
  return s || fallback;
}

export function defaultDiscordBotTasks(): DiscordBotTask[] {
  return [
    { id: "alerts", enabled: true, type: "qadbak.alerts", params: {} },
    {
      id: "status",
      enabled: true,
      type: "qadbak.status",
      params: { name: "status", description: "RAM, disk, load, Docker" },
    },
    {
      id: "disk",
      enabled: true,
      type: "qadbak.disk",
      params: { name: "disk", description: "Disk usage per mount" },
    },
    {
      id: "docker",
      enabled: true,
      type: "qadbak.docker",
      params: { name: "docker", description: "Docker container states" },
    },
    {
      id: "load",
      enabled: true,
      type: "qadbak.load",
      params: { name: "load", description: "CPU load averages" },
    },
    {
      id: "ping",
      enabled: true,
      type: "qadbak.ping",
      params: { name: "ping", description: "Check that the bot is online" },
    },
    {
      id: "about",
      enabled: true,
      type: "qadbak.about",
      params: { name: "about", description: "What this bot does" },
    },
    {
      id: "invite",
      enabled: true,
      type: "qadbak.invite",
      params: { name: "invite", description: "Invite this bot to a server" },
    },
    {
      id: "minecraft",
      enabled: true,
      type: "minecraft.status",
      params: { name: "minecraft", description: "Minecraft server status" },
    },
    {
      id: "help",
      enabled: true,
      type: "qadbak.help",
      params: { name: "help", description: "List bot commands" },
    },
    {
      id: "uptime",
      enabled: true,
      type: "qadbak.uptime",
      params: { name: "uptime", description: "Bot and host uptime" },
    },
  ];
}

export function mergeBuiltinDiscordTasks(recipes: DiscordBotRecipes): DiscordBotRecipes {
  const have = new Set(recipes.tasks.map((t) => t.type));
  const extra = defaultDiscordBotTasks().filter((t) => !have.has(t.type));
  if (extra.length === 0) return recipes;
  return { ...recipes, tasks: [...recipes.tasks, ...extra] };
}

function normalizeTask(raw: unknown): DiscordBotTask | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type ?? "");
  if (!TYPE_SET.has(type)) return null;
  const paramsIn =
    o.params && typeof o.params === "object"
      ? (o.params as Record<string, unknown>)
      : {};
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(paramsIn)) {
    if (typeof v === "string") params[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") params[k] = String(v);
  }
  const id =
    String(o.id ?? "").trim() ||
    `task-${type.replace(".", "-")}-${randomBytes(3).toString("hex")}`;
  return {
    id: id.slice(0, 64),
    enabled: o.enabled !== false,
    type: type as DiscordBotTaskType,
    params,
  };
}

export function normalizeDiscordBotRecipes(input: unknown): DiscordBotRecipes {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const tasksRaw = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks = tasksRaw.map(normalizeTask).filter((t): t is DiscordBotTask => t !== null);
  return {
    botName: typeof o.botName === "string" && o.botName.trim() ? o.botName.trim().slice(0, 80) : "Qadbak",
    tasks: tasks.length > 0 ? tasks : defaultDiscordBotTasks(),
  };
}

export async function loadDiscordBotRecipes(): Promise<DiscordBotRecipes> {
  try {
    const raw = await fs.readFile(TASKS_PATH, "utf8");
    return mergeBuiltinDiscordTasks(normalizeDiscordBotRecipes(JSON.parse(raw)));
  } catch {
    return { botName: "Qadbak", tasks: defaultDiscordBotTasks() };
  }
}

export async function saveDiscordBotRecipes(recipes: DiscordBotRecipes): Promise<void> {
  const normalized = mergeBuiltinDiscordTasks(normalizeDiscordBotRecipes(recipes));
  await fs.mkdir(path.dirname(TASKS_PATH), { recursive: true });
  await fs.writeFile(TASKS_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function alertsTaskEnabled(recipes: DiscordBotRecipes): boolean {
  const row = recipes.tasks.find((t) => t.type === "qadbak.alerts");
  if (!row) return true;
  return row.enabled !== false;
}

export function slashCommandsFromTasks(
  recipes: DiscordBotRecipes,
): Array<{ name: string; description: string }> {
  const out: Array<{ name: string; description: string }> = [];
  const used = new Set<string>();
  for (const task of recipes.tasks) {
    if (!task.enabled) continue;
    let name = "";
    let description = "Qadbak command";
    if (task.type === "qadbak.status") {
      name = slashName(task.params.name, "status");
      description = (task.params.description || "Qadbak server status").slice(0, 100);
    } else if (task.type === "minecraft.status") {
      name = slashName(task.params.name, "minecraft");
      description = (task.params.description || "Minecraft server status").slice(0, 100);
    } else if (task.type === "qadbak.help") {
      name = slashName(task.params.name, "help");
      description = (task.params.description || "List bot commands").slice(0, 100);
    } else if (task.type === "qadbak.uptime") {
      name = slashName(task.params.name, "uptime");
      description = (task.params.description || "Bot and host uptime").slice(0, 100);
    } else if (task.type === "qadbak.disk") {
      name = slashName(task.params.name, "disk");
      description = (task.params.description || "Disk usage per mount").slice(0, 100);
    } else if (task.type === "qadbak.docker") {
      name = slashName(task.params.name, "docker");
      description = (task.params.description || "Docker container states").slice(0, 100);
    } else if (task.type === "qadbak.load") {
      name = slashName(task.params.name, "load");
      description = (task.params.description || "CPU load averages").slice(0, 100);
    } else if (task.type === "qadbak.ping") {
      name = slashName(task.params.name, "ping");
      description = (task.params.description || "Check that the bot is online").slice(0, 100);
    } else if (task.type === "qadbak.about") {
      name = slashName(task.params.name, "about");
      description = (task.params.description || "What this bot does").slice(0, 100);
    } else if (task.type === "qadbak.invite") {
      name = slashName(task.params.name, "invite");
      description = (task.params.description || "Invite this bot to a server").slice(0, 100);
    } else if (task.type === "slash.reply") {
      name = slashName(task.params.name, "");
      description = (task.params.description || task.params.text || "Canned reply").slice(0, 100);
    } else if (task.type === "slash.embed") {
      name = slashName(task.params.name, "info");
      description = (task.params.description || task.params.title || "Embed reply").slice(0, 100);
    } else if (task.type === "poll.create") {
      name = slashName(task.params.name, "poll");
      description = (task.params.description || "Post a yes/no poll").slice(0, 100);
    }
    if (!name || used.has(name)) continue;
    used.add(name);
    out.push({ name, description: description || "Qadbak command" });
  }
  return out;
}

export async function registerDiscordSlashCommands(opts: {
  botToken: string;
  applicationId: string;
  commands: Array<{ name: string; description: string }>;
}): Promise<{ ok: boolean; count: number; status?: number }> {
  if (!opts.botToken || !opts.applicationId) return { ok: false, count: 0 };
  const res = await fetch(
    `${DISCORD_API}/applications/${opts.applicationId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${opts.botToken}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(
        opts.commands.map((c) => ({
          name: c.name,
          description: c.description.slice(0, 100),
          type: 1,
        })),
      ),
    },
  );
  return { ok: res.ok, count: opts.commands.length, status: res.status };
}

export async function sendDiscordChannelMessage(opts: {
  botToken: string;
  channelId: string;
  content: string;
}): Promise<{ ok: boolean; skipped?: boolean; status?: number }> {
  const channelId = opts.channelId.trim();
  if (!opts.botToken || !/^\d{5,32}$/.test(channelId)) {
    return { ok: false };
  }
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${opts.botToken}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ content: opts.content.slice(0, 1900) }),
  });
  if (res.status === 403) return { ok: false, skipped: true, status: 403 };
  return { ok: res.ok, status: res.status };
}

export async function discoverDiscordUpdatesChannel(
  botToken: string,
  preferred = "",
): Promise<string> {
  if (preferred && /^\d{5,32}$/.test(preferred)) return preferred;
  if (!botToken) return "";
  const headers = {
    Authorization: `Bot ${botToken}`,
    "User-Agent": USER_AGENT,
  };
  const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers });
  if (!guildsRes.ok) return "";
  const guilds = (await guildsRes.json()) as Array<{ id?: string }>;
  if (!Array.isArray(guilds)) return "";
  for (const g of guilds) {
    const guildId = String(g?.id || "");
    if (!guildId) continue;
    const chsRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers });
    if (!chsRes.ok) continue;
    const channels = (await chsRes.json()) as Array<{ id?: string; type?: number; name?: string }>;
    if (!Array.isArray(channels)) continue;
    const text = channels.filter((c) => c?.type === 0 && c?.id);
    const named = text.find((c) =>
      /general|chat|updates|qadbak|status/i.test(String(c.name || "")),
    );
    const pick = named || text[0];
    if (pick?.id) return String(pick.id);
  }
  return "";
}

export async function fetchDiscordBotPresence(botToken: string): Promise<{
  ok: boolean;
  username: string;
  id: string;
  guilds: Array<{ id: string; name: string }>;
}> {
  const empty = { ok: false, username: "", id: "", guilds: [] as Array<{ id: string; name: string }> };
  if (!botToken) return empty;
  const headers = {
    Authorization: `Bot ${botToken}`,
    "User-Agent": USER_AGENT,
  };
  try {
    const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers });
    if (!meRes.ok) return empty;
    const me = (await meRes.json()) as { id?: string; username?: string };
    const gRes = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers });
    const raw = gRes.ok ? ((await gRes.json()) as Array<{ id?: string; name?: string }>) : [];
    const guilds = Array.isArray(raw)
      ? raw
          .map((g) => ({
            id: String(g.id || ""),
            name: String(g.name || g.id || ""),
          }))
          .filter((g) => /^\d{5,32}$/.test(g.id))
      : [];
    return {
      ok: true,
      username: String(me.username || "bot"),
      id: String(me.id || ""),
      guilds,
    };
  } catch {
    return empty;
  }
}

export async function listDiscordBotInstalls(): Promise<PublicDiscordBotInstall[]> {
  const dir = path.join(process.cwd(), "data", "domain-config");
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: PublicDiscordBotInstall[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name, "discord-bot.json"), "utf8");
      const o = JSON.parse(raw) as Record<string, unknown>;
      const subdomain = String(o.subdomain || "").trim();
      if (!subdomain) continue;
      const clientId = String(o.discordClientId || "").trim();
      out.push({
        parentDomain: String(o.parentDomain || name).trim(),
        subdomain,
        botName: String(o.botName || "Qadbak").trim() || "Qadbak",
        publicUrl: `https://${subdomain}/`,
        inviteUrl: discordBotInviteUrl(clientId),
        botRedirectUri: `https://${subdomain}/auth/callback`,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}
