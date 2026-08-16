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
  "minecraft.status",
  "slash.reply",
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
    `&permissions=85056&scope=bot%20applications.commands`
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
      params: { name: "status", description: "Qadbak server status" },
    },
    {
      id: "minecraft",
      enabled: true,
      type: "minecraft.status",
      params: { name: "minecraft", description: "Minecraft server status" },
    },
  ];
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
    return normalizeDiscordBotRecipes(JSON.parse(raw));
  } catch {
    return { botName: "Qadbak", tasks: defaultDiscordBotTasks() };
  }
}

export async function saveDiscordBotRecipes(recipes: DiscordBotRecipes): Promise<void> {
  const normalized = normalizeDiscordBotRecipes(recipes);
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
    } else if (task.type === "slash.reply") {
      name = slashName(task.params.name, "");
      description = (task.params.description || task.params.text || "Canned reply").slice(0, 100);
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
