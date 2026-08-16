#!/usr/bin/env node
/**
 * Host-wide Discord DM notifier (pm2: qadbak-discord-notify).
 * Watches disk/RAM/load, pm2, nginx, Docker, journal, helper log, and panel updates.
 * Does not tail Minecraft latest.log (the MC sidecar owns join/leave DMs).
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QADBAK_DIR || path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const CONFIG_PATH = path.join(DATA, "discord-notify.json");
const PANEL_SUBS = path.join(DATA, "discord-subscribers.json");
const STATE_PATH = path.join(DATA, "discord-notify-state.json");
const HELPER_LOGS = [
  path.join(DATA, "provisioning-helper.log"),
  path.join(DATA, "logs", "provisioning-helper.log"),
];
const JOURNAL_DIR = path.join(DATA, "journal");
const UPDATE_JOBS = path.join(DATA, "update-jobs");
const INTERVAL_MS = 45_000;
const COOLDOWN_MS = 45 * 60 * 1000;
const DIGEST_MS = 30 * 60 * 1000;
const DISCORD_API = "https://discord.com/api/v10";
const USER_AGENT = "QadbakNotify/1.0";
const WATCH_PM2 = ["qadbak", "qadbak-terminal"];
const DISK_PCT = 85;
const MEM_PCT = 90;
const LOAD_N = 8;

function loadEnvFile(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
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
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* missing .env.local is fine */
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runCmd(cmd, args, timeout = 8000) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout ?? "") };
  } catch (e) {
    return {
      ok: false,
      stdout: String(e.stdout ?? ""),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function normalizeConfig(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    botToken: typeof o.botToken === "string" ? o.botToken.trim() : "",
    updatesChannelId:
      typeof o.updatesChannelId === "string" ? o.updatesChannelId.trim() : "",
    enabled: typeof o.enabled === "boolean" ? o.enabled : true,
  };
}

function normalizeUsers(raw) {
  const users = [];
  const map = raw && typeof raw === "object" ? raw.users : null;
  if (!map || typeof map !== "object") return users;
  for (const [key, row] of Object.entries(map)) {
    if (!row || typeof row !== "object") continue;
    if (row.notify === false) continue;
    const id = String(row.id || key).trim();
    if (!/^\d{5,32}$/.test(id)) continue;
    users.push({
      id,
      username: String(row.username || id).trim() || id,
    });
  }
  return users;
}

async function loadSubscribers() {
  const byId = new Map();
  for (const row of normalizeUsers(await readJson(PANEL_SUBS, { users: {} }))) {
    byId.set(row.id, row);
  }
  try {
    const homes = await readdir("/home", { withFileTypes: true });
    for (const ent of homes) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      const file = path.join(
        "/home",
        ent.name,
        "apps",
        "minecraft",
        "data",
        "discord-subscribers.json",
      );
      const botFile = path.join(
        "/home",
        ent.name,
        "apps",
        "discord-bot",
        "data",
        "discord-subscribers.json",
      );
      for (const candidate of [file, botFile]) {
        const data = await readJson(candidate, null);
        if (!data) continue;
        for (const row of normalizeUsers(data)) {
          if (!byId.has(row.id)) byId.set(row.id, row);
        }
      }
    }
  } catch {
    /* ignore /home permission errors */
  }
  return [...byId.values()];
}

async function discordApi(botToken, method, apiPath, body) {
  const res = await fetch(`${DISCORD_API}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") || "1");
    await sleep(Math.min(30_000, Math.max(500, retry * 1000)));
  }
  return { ok: res.ok, status: res.status, json };
}

async function sendDm(botToken, userId, content) {
  const chRes = await discordApi(botToken, "POST", "/users/@me/channels", {
    recipient_id: userId,
  });
  if (chRes.status === 403) return { skipped: true };
  if (!chRes.ok) return { ok: false };
  const id = chRes.json?.id;
  if (!id) return { ok: false };
  const msgRes = await discordApi(botToken, "POST", `/channels/${id}/messages`, {
    content: String(content).slice(0, 1900),
  });
  if (msgRes.status === 403) return { skipped: true };
  return { ok: msgRes.ok };
}

async function postChannel(botToken, channelId, content) {
  if (!channelId || !/^\d{5,32}$/.test(channelId)) return { ok: false };
  const r = await discordApi(botToken, "POST", `/channels/${channelId}/messages`, {
    content: String(content).slice(0, 1900),
  });
  if (r.status === 403) return { skipped: true };
  return { ok: r.ok, status: r.status };
}

async function discoverChannel(botToken, preferred) {
  if (preferred && /^\d{5,32}$/.test(preferred)) return preferred;
  const guilds = await discordApi(botToken, "GET", "/users/@me/guilds");
  const list = Array.isArray(guilds.json) ? guilds.json : [];
  for (const g of list) {
    const guildId = String(g?.id || "");
    if (!guildId) continue;
    const chs = await discordApi(botToken, "GET", `/guilds/${guildId}/channels`);
    const channels = Array.isArray(chs.json) ? chs.json : [];
    const text = channels.filter((c) => c?.type === 0 && c?.id);
    const named = text.find((c) =>
      /general|chat|updates|qadbak|status/i.test(String(c.name || "")),
    );
    const pick = named || text[0];
    if (pick?.id) return String(pick.id);
  }
  return "";
}

async function broadcast(botToken, users, channelId, content) {
  if (!botToken) return;
  if (channelId) {
    try {
      const r = await postChannel(botToken, channelId, content);
      if (!r.ok) {
        console.warn(`WARN channel ${channelId}: HTTP ${r.status || "fail"}`);
      }
    } catch (e) {
      console.warn(`WARN channel: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(200);
  }
  for (const user of users) {
    try {
      await sendDm(botToken, user.id, content);
    } catch (e) {
      console.warn(`WARN dm ${user.id}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(350);
  }
}

async function formatDigest() {
  const disk = await readDisk();
  const mem = await readMem();
  const load = await readLoad();
  const docker = await runCmd("docker", ["ps", "-a", "--format", "{{.State}}"]);
  let running = 0;
  let total = 0;
  if (docker.ok) {
    for (const line of docker.stdout.split("\n")) {
      if (!line.trim()) continue;
      total += 1;
      if (line.trim() === "running") running += 1;
    }
  }
  const diskTxt = disk ? `${disk.mount} ${disk.usePct}%` : "n/a";
  const memTxt = mem ? `${mem.usePct}%` : "n/a";
  const loadTxt = load === null ? "n/a" : String(load);
  const dockerTxt = total ? `${running}/${total} running` : "n/a";
  return `[Qadbak] Status · RAM ${memTxt} · disk ${diskTxt} · load ${loadTxt} · Docker ${dockerTxt}`;
}

function cooled(state, id, now, windowMs = COOLDOWN_MS) {
  const last = Number(state.alerts?.[id] || 0);
  return Number.isFinite(last) && now - last < windowMs;
}

function mark(state, id, now) {
  state.alerts = state.alerts || {};
  state.alerts[id] = now;
}

async function readMem() {
  try {
    const raw = await readFile("/proc/meminfo", "utf8");
    const lines = Object.fromEntries(
      raw
        .split("\n")
        .map((l) => l.split(":"))
        .filter((p) => p.length === 2)
        .map(([k, v]) => [k.trim(), Number.parseInt(v.trim(), 10) || 0]),
    );
    const totalKb = lines.MemTotal ?? 0;
    const availableKb = lines.MemAvailable ?? lines.MemFree ?? 0;
    const usedKb = Math.max(0, totalKb - availableKb);
    const usePct = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
    return { usePct };
  } catch {
    return null;
  }
}

async function readLoad() {
  try {
    const raw = await readFile("/proc/loadavg", "utf8");
    return Number.parseFloat(raw.trim().split(/\s+/)[0] || "0");
  } catch {
    return null;
  }
}

async function readDisk() {
  const r = await runCmd("df", ["-kP"]);
  if (!r.ok) return null;
  let best = null;
  for (const line of r.stdout.split("\n").slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const mount = parts[5];
    if (!mount.startsWith("/") || mount.startsWith("/snap")) continue;
    const usePct = Number.parseInt(String(parts[4]).replace("%", ""), 10) || 0;
    if (
      mount === "/" ||
      mount.startsWith("/home") ||
      mount === "/var" ||
      mount.startsWith("/var/")
    ) {
      if (!best || mount === "/" || usePct > best.usePct) {
        best = { mount, usePct };
      }
    }
  }
  return best;
}

async function checkMetrics(state, now, queue) {
  const disk = await readDisk();
  if (disk && disk.usePct >= DISK_PCT && !cooled(state, "disk", now)) {
    mark(state, "disk", now);
    queue.push(`[Qadbak] Disk ${disk.mount} at ${disk.usePct}% (drempel ${DISK_PCT}%).`);
  }
  const mem = await readMem();
  if (mem && mem.usePct >= MEM_PCT && !cooled(state, "memory", now)) {
    mark(state, "memory", now);
    queue.push(`[Qadbak] RAM at ${mem.usePct}% (drempel ${MEM_PCT}%).`);
  }
  const load = await readLoad();
  if (load !== null && load >= LOAD_N && !cooled(state, "load", now)) {
    mark(state, "load", now);
    queue.push(`[Qadbak] Load ${load} (drempel ${LOAD_N}).`);
  }
}

async function checkPm2(state, now, queue) {
  const r = await runCmd("pm2", ["jlist"]);
  if (!r.ok) return;
  let list = [];
  try {
    list = JSON.parse(r.stdout.trim() || "[]");
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  const byName = new Map();
  for (const proc of list) {
    const name = String(proc?.name || "");
    if (!name) continue;
    byName.set(name, {
      status: String(proc?.pm2_env?.status || "unknown"),
      restartTime: Number(proc?.pm2_env?.restart_time || 0),
    });
  }
  state.pm2 = state.pm2 || {};
  for (const name of WATCH_PM2) {
    const cur = byName.get(name) || { status: "missing", restartTime: 0 };
    const prev = state.pm2[name];
    const online = cur.status === "online";
    if (!online && !cooled(state, `pm2:${name}`, now, 15 * 60 * 1000)) {
      mark(state, `pm2:${name}`, now);
      queue.push(`[Qadbak] pm2 process ${name} is not online (status: ${cur.status}).`);
    } else if (prev && prev.status !== "online" && online) {
      queue.push(`[Qadbak] pm2 process ${name} is online again.`);
    } else if (prev && online && cur.restartTime > (prev.restartTime || 0)) {
      if (!cooled(state, `pm2-restart:${name}`, now, 10 * 60 * 1000)) {
        mark(state, `pm2-restart:${name}`, now);
        queue.push(`[Qadbak] pm2 process ${name} restarted.`);
      }
    }
    state.pm2[name] = cur;
  }
}

async function checkNginx(state, now, queue) {
  const r = await runCmd("systemctl", ["is-active", "nginx"]);
  const status = (r.stdout.trim() || (r.ok ? "active" : "inactive")).split("\n")[0];
  if (!status || /not be found|not found|inactive \(dead\)/i.test(r.error || "")) {
    if (!r.stdout.trim()) return;
  }
  const prev = state.nginx;
  state.nginx = status;
  if (status !== "active" && prev === "active") {
    if (!cooled(state, "nginx", now, 15 * 60 * 1000)) {
      mark(state, "nginx", now);
      queue.push(`[Qadbak] nginx is not active (${status}).`);
    }
  } else if (prev && prev !== "active" && status === "active") {
    queue.push("[Qadbak] nginx is active again.");
  }
}

async function checkDocker(state, now, queue) {
  const r = await runCmd("docker", ["ps", "-a", "--format", "{{.Names}}\t{{.State}}"]);
  if (!r.ok) return;
  const current = {};
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [name, st] = line.split("\t");
    if (!name) continue;
    current[name] = (st || "").trim() || "unknown";
  }
  const prev = state.docker && typeof state.docker === "object" ? state.docker : null;
  if (prev) {
    for (const [name, st] of Object.entries(current)) {
      const was = prev[name];
      const dead = st === "exited" || st === "dead";
      if (was === "running" && dead) {
        const key = `docker:${name}`;
        if (!cooled(state, key, now, 10 * 60 * 1000)) {
          mark(state, key, now);
          queue.push(`[Qadbak] Docker container ${name} ${st}.`);
        }
      }
    }
  }
  state.docker = current;
}

function dateKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function checkJournal(state, now, queue) {
  const keys = [dateKey(new Date(now - 86_400_000)), dateKey(new Date(now))];
  const seen = new Set(Array.isArray(state.journalIds) ? state.journalIds : []);
  const nextSeen = [...seen];
  for (const key of keys) {
    let raw = "";
    try {
      raw = await readFile(path.join(JOURNAL_DIR, `${key}.jsonl`), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const id = String(entry?.id || "");
      if (!id || seen.has(id)) continue;
      nextSeen.push(id);
      const action = String(entry?.action || "");
      const interesting =
        action.startsWith("app.install.") || action.includes("update");
      if (!state.journalPrimed || !interesting) continue;
      const ok = entry.ok !== false;
      const summary = String(entry.summary || action).slice(0, 180);
      const domain = entry?.target?.domain ? ` (${entry.target.domain})` : "";
      queue.push(
        `[Qadbak] ${ok ? "OK" : "FAIL"} ${action}${domain}: ${summary}`,
      );
    }
  }
  state.journalIds = nextSeen.slice(-500);
  state.journalPrimed = true;
}

async function checkHelperLog(state, queue) {
  state.helperLog = state.helperLog || { path: "", offset: 0 };
  for (const file of HELPER_LOGS) {
    let st;
    try {
      st = await stat(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let offset = state.helperLog.path === file ? Number(state.helperLog.offset) || 0 : 0;
    if (offset > st.size) offset = 0;
    if (offset === st.size) {
      state.helperLog = { path: file, offset };
      return;
    }
    const first = offset === 0 && state.helperLog.path !== file;
    const raw = await readFile(file, "utf8");
    const chunk = raw.slice(offset);
    state.helperLog = { path: file, offset: raw.length };
    if (first) return;
    for (const line of chunk.split("\n")) {
      const header = line.match(/^====\s+\S+\s+(\S+)/);
      if (header) {
        const cmdName = header[1].trim();
        if (/install|minecraft|wordpress|update|ssl|backup/i.test(cmdName)) {
          queue.push(`[Qadbak] Provisioning: ${cmdName}`);
        }
        continue;
      }
      if (/update-qadbak/i.test(line)) {
        queue.push("[Qadbak] update-qadbak.sh activity in helper log.");
      }
    }
  }
}

async function checkUpdateJobs(state, queue) {
  state.updateJobs = state.updateJobs && typeof state.updateJobs === "object"
    ? state.updateJobs
    : {};
  let names = [];
  try {
    names = await readdir(UPDATE_JOBS);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const meta = await readJson(path.join(UPDATE_JOBS, name), null);
    if (!meta || typeof meta !== "object") continue;
    const id = String(meta.id || name.replace(/\.json$/, ""));
    const status = String(meta.status || "");
    const prev = state.updateJobs[id];
    if (prev && prev !== status && (status === "done" || status === "failed")) {
      const type = String(meta.type || "update");
      queue.push(
        `[Qadbak] Update job ${type} ${status}${meta.exitCode != null ? ` (exit ${meta.exitCode})` : ""}.`,
      );
    }
    if (status) state.updateJobs[id] = status;
  }
}

async function checkGitHead(state, now, queue) {
  const r = await runCmd("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"]);
  if (!r.ok) return;
  const head = r.stdout.trim();
  if (!head) return;
  const prev = state.gitHead;
  if (prev && prev !== head && !cooled(state, "git", now, 10 * 60 * 1000)) {
    mark(state, "git", now);
    queue.push(`[Qadbak] Panel git HEAD is now ${head} (was ${prev}).`);
  }
  state.gitHead = head;
}

async function alertsEnabled() {
  const recipes = await readJson(path.join(DATA, "discord-bot.json"), null);
  if (!recipes?.tasks) return true;
  const row = (recipes.tasks || []).find((t) => t.type === "qadbak.alerts");
  if (!row) return true;
  return row.enabled !== false;
}

async function tick() {
  const cfg = normalizeConfig(await readJson(CONFIG_PATH, {}));
  if (!cfg.enabled || !cfg.botToken) {
    return;
  }
  if (!(await alertsEnabled())) return;
  const users = await loadSubscribers();
  const state = (await readJson(STATE_PATH, {})) || {};
  const now = Date.now();
  const channelId = await discoverChannel(
    cfg.botToken,
    cfg.updatesChannelId || state.updatesChannelId || "",
  );
  if (channelId) state.updatesChannelId = channelId;
  if (!channelId && users.length === 0) {
    if (!state.loggedNoTarget) {
      console.warn(
        "qadbak-discord-notify: invite the bot to a Discord server (Add to Discord) so it can post updates",
      );
      state.loggedNoTarget = true;
      await writeJson(STATE_PATH, state);
    }
    return;
  }
  const queue = [];
  if (channelId && state.helloChannelId !== channelId) {
    queue.push(
      "[Qadbak] Live updates staan aan. Je krijgt hier serverstatus, Docker, installs en storingen.",
    );
    state.helloSent = true;
    state.helloChannelId = channelId;
  }
  const lastDigest = Number(state.digestAt || 0);
  if (!lastDigest || now - lastDigest >= DIGEST_MS) {
    queue.push(await formatDigest());
    state.digestAt = now;
  }
  await checkMetrics(state, now, queue);
  await checkPm2(state, now, queue);
  await checkNginx(state, now, queue);
  await checkDocker(state, now, queue);
  await checkJournal(state, now, queue);
  await checkHelperLog(state, queue);
  await checkUpdateJobs(state, queue);
  await checkGitHead(state, now, queue);
  const unique = [...new Set(queue)];
  for (const msg of unique.slice(0, 8)) {
    await broadcast(cfg.botToken, users, channelId, msg);
  }
  await writeJson(STATE_PATH, state);
}

async function main() {
  console.log(`qadbak-discord-notify root=${ROOT} interval=${INTERVAL_MS}ms`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.warn(`WARN tick: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(INTERVAL_MS);
  }
}

main();
