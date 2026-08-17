import { createHmac, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import fs from "fs/promises";
import path from "path";

const CONFIG_PATH = path.join(process.cwd(), "data", "discord-notify.json");
const SUBS_PATH = path.join(process.cwd(), "data", "discord-subscribers.json");
const OAUTH_COOKIE = "qadbak_discord_oauth";
const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "QadbakNotify/1.0";

export const DISCORD_OAUTH_COOKIE = OAUTH_COOKIE;

export interface DiscordNotifyConfig {
  botToken: string;
  clientId: string;
  clientSecret: string;
  publicKey: string;
  invite: string;
  updatesChannelId: string;
  enabled: boolean;
}

export interface DiscordSubscriber {
  id: string;
  username: string;
  notify?: boolean;
  linkedAt?: string;
  ign?: string;
}

export interface DiscordSubscribersFile {
  users: Record<string, DiscordSubscriber>;
}

export interface PublicDiscordNotifySettings {
  enabled: boolean;
  botTokenSet: boolean;
  clientId: string;
  clientSecretSet: boolean;
  publicKey: string;
  invite: string;
  updatesChannelId: string;
  redirectUri: string;
}

export interface PublicDiscordSubscriber {
  id: string;
  username: string;
  sources: string[];
}

const DEFAULTS: DiscordNotifyConfig = {
  botToken: "",
  clientId: "",
  clientSecret: "",
  publicKey: "",
  invite: "",
  updatesChannelId: "",
  enabled: true,
};

export function normalizeDiscordNotifyConfig(input: unknown): DiscordNotifyConfig {
  const base = { ...DEFAULTS };
  if (!input || typeof input !== "object") return base;
  const o = input as Record<string, unknown>;
  return {
    botToken: typeof o.botToken === "string" ? o.botToken.trim() : base.botToken,
    clientId: typeof o.clientId === "string" ? o.clientId.trim() : base.clientId,
    clientSecret:
      typeof o.clientSecret === "string" ? o.clientSecret.trim() : base.clientSecret,
    publicKey: typeof o.publicKey === "string" ? o.publicKey.trim() : base.publicKey,
    invite: typeof o.invite === "string" ? o.invite.trim() : base.invite,
    updatesChannelId:
      typeof o.updatesChannelId === "string" ? o.updatesChannelId.trim() : base.updatesChannelId,
    enabled: typeof o.enabled === "boolean" ? o.enabled : base.enabled,
  };
}

/** Empty secret fields keep the current value so PATCH bodies never need to echo tokens. */
export function mergeDiscordNotifyPatch(
  current: DiscordNotifyConfig,
  patch: unknown,
): DiscordNotifyConfig {
  const cur = normalizeDiscordNotifyConfig(current);
  if (!patch || typeof patch !== "object") return cur;
  const o = patch as Record<string, unknown>;
  const next = { ...cur };
  if (typeof o.botToken === "string" && o.botToken.trim()) {
    next.botToken = o.botToken.trim();
  }
  if (typeof o.clientSecret === "string" && o.clientSecret.trim()) {
    next.clientSecret = o.clientSecret.trim();
  }
  if (typeof o.clientId === "string") next.clientId = o.clientId.trim();
  if (typeof o.publicKey === "string") next.publicKey = o.publicKey.trim();
  if (typeof o.invite === "string") next.invite = o.invite.trim();
  if (typeof o.updatesChannelId === "string") {
    next.updatesChannelId = o.updatesChannelId.trim();
  }
  if (typeof o.enabled === "boolean") next.enabled = o.enabled;
  return normalizeDiscordNotifyConfig(next);
}

export function redactDiscordNotifyConfig(
  cfg: DiscordNotifyConfig,
  redirectUri: string,
): PublicDiscordNotifySettings {
  return {
    enabled: cfg.enabled,
    botTokenSet: Boolean(cfg.botToken),
    clientId: cfg.clientId,
    clientSecretSet: Boolean(cfg.clientSecret),
    publicKey: cfg.publicKey,
    invite: cfg.invite,
    updatesChannelId: cfg.updatesChannelId,
    redirectUri,
  };
}

export function discordOAuthConfigured(cfg: DiscordNotifyConfig): boolean {
  return Boolean(cfg.clientId && cfg.clientSecret);
}

export function discordBotReady(cfg: DiscordNotifyConfig): boolean {
  return Boolean(cfg.enabled && cfg.botToken);
}

/** Fill blank OAuth fields from a hosted app config without overwriting set values. */
export function mergeDiscordAppCredentials(
  cfg: DiscordNotifyConfig,
  app: Record<string, unknown>,
): DiscordNotifyConfig {
  return normalizeDiscordNotifyConfig({
    ...cfg,
    botToken: cfg.botToken || String(app.discordBotToken || "").trim(),
    clientId: cfg.clientId || String(app.discordClientId || "").trim(),
    clientSecret: cfg.clientSecret || String(app.discordClientSecret || "").trim(),
    invite: cfg.invite || String(app.discordInvite || "").trim(),
    updatesChannelId:
      cfg.updatesChannelId || String(app.updatesChannelId || "").trim(),
  });
}

export function discordNotifyNeedsAppFallback(cfg: DiscordNotifyConfig): boolean {
  return !cfg.botToken || !cfg.clientId || !cfg.clientSecret;
}

export async function loadDiscordNotifyConfig(): Promise<DiscordNotifyConfig> {
  let cfg: DiscordNotifyConfig = { ...DEFAULTS };
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    cfg = normalizeDiscordNotifyConfig(JSON.parse(raw));
  } catch {
    cfg = { ...DEFAULTS };
  }
  // Host bot only. Customer Discord Bot apps keep their own token in
  // domain-config — never reuse that as the panel-wide invite.
  return cfg;
}

export async function saveDiscordNotifyConfig(
  settings: DiscordNotifyConfig,
): Promise<void> {
  const normalized = normalizeDiscordNotifyConfig(settings);
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function normalizeSubscribersFile(input: unknown): DiscordSubscribersFile {
  const users: Record<string, DiscordSubscriber> = {};
  if (!input || typeof input !== "object") return { users };
  const rawUsers = (input as { users?: unknown }).users;
  if (!rawUsers || typeof rawUsers !== "object") return { users };
  for (const [key, row] of Object.entries(rawUsers as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? key).trim();
    if (!/^\d{5,32}$/.test(id)) continue;
    users[id] = {
      id,
      username: String(o.username ?? id).trim() || id,
      notify: o.notify !== false,
      linkedAt: typeof o.linkedAt === "string" ? o.linkedAt : undefined,
      ign: typeof o.ign === "string" ? o.ign : undefined,
    };
  }
  return { users };
}

export async function loadPanelSubscribers(): Promise<DiscordSubscribersFile> {
  try {
    const raw = await fs.readFile(SUBS_PATH, "utf8");
    return normalizeSubscribersFile(JSON.parse(raw));
  } catch {
    return { users: {} };
  }
}

export async function savePanelSubscribers(
  data: DiscordSubscribersFile,
): Promise<void> {
  const normalized = normalizeSubscribersFile(data);
  await fs.mkdir(path.dirname(SUBS_PATH), { recursive: true });
  await fs.writeFile(SUBS_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function upsertPanelSubscriber(user: {
  id: string;
  username: string;
}): Promise<DiscordSubscriber> {
  const data = await loadPanelSubscribers();
  const id = String(user.id).trim();
  const prev = data.users[id];
  const row: DiscordSubscriber = {
    id,
    username: user.username.trim() || prev?.username || id,
    notify: true,
    linkedAt: prev?.linkedAt || new Date().toISOString(),
    ign: prev?.ign,
  };
  data.users[id] = row;
  await savePanelSubscribers(data);
  return row;
}

async function readSubscribersFile(
  file: string,
): Promise<DiscordSubscribersFile | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return normalizeSubscribersFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function minecraftSubscriberPaths(): Promise<string[]> {
  const out: string[] = [];
  try {
    const homes = await readdir("/home", { withFileTypes: true });
    for (const ent of homes) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      if (ent.name.startsWith(".")) continue;
      out.push(
        path.join("/home", ent.name, "apps", "minecraft", "data", "discord-subscribers.json"),
      );
      out.push(
        path.join("/home", ent.name, "apps", "discord-bot", "data", "discord-subscribers.json"),
      );
    }
  } catch {
    /* permission / missing /home */
  }
  return out;
}

export async function listMergedSubscribers(): Promise<PublicDiscordSubscriber[]> {
  const byId = new Map<string, PublicDiscordSubscriber>();
  const panel = await loadPanelSubscribers();
  for (const row of Object.values(panel.users)) {
    if (row.notify === false) continue;
    byId.set(row.id, { id: row.id, username: row.username, sources: ["panel"] });
  }
  for (const file of await minecraftSubscriberPaths()) {
    const data = await readSubscribersFile(file);
    if (!data) continue;
    for (const row of Object.values(data.users)) {
      if (row.notify === false) continue;
      const prev = byId.get(row.id);
      if (prev) {
        if (!prev.sources.includes("minecraft") && file.includes("/minecraft/")) {
          prev.sources.push("minecraft");
        }
        if (!prev.sources.includes("bot") && file.includes("/discord-bot/")) {
          prev.sources.push("bot");
        }
        if (prev.username === prev.id && row.username) prev.username = row.username;
      } else {
        byId.set(row.id, {
          id: row.id,
          username: row.username,
          sources: file.includes("/discord-bot/") ? ["bot"] : ["minecraft"],
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.username.localeCompare(b.username, "en"));
}

export async function sendDiscordDm(
  botToken: string,
  userId: string,
  content: string,
): Promise<{ ok: boolean; skipped?: boolean; status?: number }> {
  if (!botToken.trim() || !userId.trim()) return { ok: false };
  const headers = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  try {
    const chRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (chRes.status === 403) return { ok: false, skipped: true, status: 403 };
    if (!chRes.ok) return { ok: false, status: chRes.status };
    const ch = (await chRes.json()) as { id?: string };
    if (!ch.id) return { ok: false };
    const msgRes = await fetch(`${DISCORD_API}/channels/${ch.id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
    if (msgRes.status === 403) return { ok: false, skipped: true, status: 403 };
    return { ok: msgRes.ok, status: msgRes.status };
  } catch {
    return { ok: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dmAllLinkedSubscribers(
  content: string,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const cfg = await loadDiscordNotifyConfig();
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!discordBotReady(cfg)) return result;
  const users = await listMergedSubscribers();
  for (const user of users) {
    const r = await sendDiscordDm(cfg.botToken, user.id, content);
    if (r.ok) result.sent += 1;
    else if (r.skipped) result.skipped += 1;
    else result.failed += 1;
    await sleep(350);
  }
  return result;
}

function oauthHmacKey(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short.");
  }
  return s;
}

export function signDiscordOAuthState(state: string): string {
  const ts = String(Date.now());
  const payload = `${state}.${ts}`;
  const sig = createHmac("sha256", oauthHmacKey()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyDiscordOAuthState(
  cookieValue: string,
  state: string,
  maxAgeMs = 600_000,
): boolean {
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [cookieState, ts, sig] = parts;
  if (!cookieState || !ts || !sig || cookieState !== state) return false;
  const age = Date.now() - Number(ts);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return false;
  const payload = `${cookieState}.${ts}`;
  const expect = createHmac("sha256", oauthHmacKey()).update(payload).digest("hex");
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expect, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function exchangeDiscordOAuthCode(opts: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ id: string; username: string } | null> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return null;
  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "User-Agent": USER_AGENT,
    },
  });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as { id?: string; username?: string };
  const id = String(me.id || "").trim();
  if (!/^\d{5,32}$/.test(id)) return null;
  return { id, username: String(me.username || "user").trim() || "user" };
}
