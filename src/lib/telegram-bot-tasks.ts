import { randomBytes } from "node:crypto";

export const TELEGRAM_BOT_TASK_TYPES = [
  "qadbak.alerts",
  "qadbak.status",
  "qadbak.help",
  "qadbak.uptime",
  "minecraft.status",
  "command.reply",
  "keyword.reply",
  "scheduled.post",
  "welcome",
] as const;

export type TelegramBotTaskType = (typeof TELEGRAM_BOT_TASK_TYPES)[number];

export interface TelegramBotTask {
  id: string;
  enabled: boolean;
  type: TelegramBotTaskType;
  params: Record<string, string>;
}

export interface TelegramBotRecipes {
  botName: string;
  tasks: TelegramBotTask[];
}

const TYPE_SET = new Set<string>(TELEGRAM_BOT_TASK_TYPES);

export function telegramBotInviteUrl(username: string): string {
  const name = String(username || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 32);
  if (!name) return "";
  return `https://t.me/${encodeURIComponent(name)}?startgroup=1`;
}

function commandName(raw: string, fallback: string): string {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 32);
  return s || fallback;
}

export function defaultTelegramBotTasks(): TelegramBotTask[] {
  return [
    { id: "alerts", enabled: true, type: "qadbak.alerts", params: {} },
    {
      id: "status",
      enabled: true,
      type: "qadbak.status",
      params: { name: "status" },
    },
    {
      id: "minecraft",
      enabled: true,
      type: "minecraft.status",
      params: { name: "minecraft" },
    },
    {
      id: "help",
      enabled: true,
      type: "qadbak.help",
      params: { name: "help" },
    },
    {
      id: "uptime",
      enabled: true,
      type: "qadbak.uptime",
      params: { name: "uptime" },
    },
  ];
}

function normalizeTask(raw: unknown): TelegramBotTask | null {
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
  if (type === "qadbak.status") params.name = commandName(params.name, "status");
  if (type === "minecraft.status") params.name = commandName(params.name, "minecraft");
  if (type === "qadbak.help") params.name = commandName(params.name, "help");
  if (type === "qadbak.uptime") params.name = commandName(params.name, "uptime");
  if (type === "command.reply") params.name = commandName(params.name, "");
  const id =
    String(o.id ?? "").trim() ||
    `task-${type.replace(".", "-")}-${randomBytes(3).toString("hex")}`;
  return {
    id: id.slice(0, 64),
    enabled: o.enabled !== false,
    type: type as TelegramBotTaskType,
    params,
  };
}

export function normalizeTelegramBotRecipes(input: unknown): TelegramBotRecipes {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const tasksRaw = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks = tasksRaw.map(normalizeTask).filter((t): t is TelegramBotTask => t !== null);
  return {
    botName:
      typeof o.botName === "string" && o.botName.trim()
        ? o.botName.trim().slice(0, 80)
        : "Qadbak",
    tasks: tasks.length > 0 ? tasks : defaultTelegramBotTasks(),
  };
}

export function telegramCommandsFromTasks(
  recipes: TelegramBotRecipes,
): Array<{ command: string; description: string }> {
  const out: Array<{ command: string; description: string }> = [
    { command: "start", description: "Link this chat" },
  ];
  const used = new Set(["start"]);
  for (const task of recipes.tasks) {
    if (!task.enabled) continue;
    let name = "";
    let description = "Qadbak command";
    if (task.type === "qadbak.status") {
      name = commandName(task.params.name, "status");
      description = "Server status";
    } else if (task.type === "minecraft.status") {
      name = commandName(task.params.name, "minecraft");
      description = "Minecraft status";
    } else if (task.type === "qadbak.help") {
      name = commandName(task.params.name, "help");
      description = "List bot commands";
    } else if (task.type === "qadbak.uptime") {
      name = commandName(task.params.name, "uptime");
      description = "Bot uptime";
    } else if (task.type === "command.reply") {
      name = commandName(task.params.name, "");
      description = (task.params.text || "Custom reply").slice(0, 256);
    }
    if (!name || used.has(name)) continue;
    used.add(name);
    out.push({ command: name, description: description.slice(0, 256) });
  }
  return out;
}
