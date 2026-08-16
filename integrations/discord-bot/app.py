#!/usr/bin/env python3
"""Qadbak Discord bot hoster: invite page, OAuth link, gateway, no-code tasks."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://127.0.0.1:8787").rstrip("/")
BOT_NAME = os.environ.get("BOT_NAME", "Qadbak").strip() or "Qadbak"
BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "").strip()
GUILD_INVITE = os.environ.get("DISCORD_GUILD_INVITE", "").strip()
SESSION_SECRET = os.environ.get("SESSION_SECRET", "change-me").encode()
SUB_PATH = Path(os.environ.get("SUBSCRIBERS_PATH", "/data/discord-subscribers.json"))
TASKS_PATH = Path(os.environ.get("TASKS_PATH", "/data/tasks.json"))
STATUS_URL = os.environ.get("STATUS_URL", "").strip()
STATUS_TOKEN = os.environ.get("STATUS_TOKEN", "").strip()

lock = threading.Lock()
oauth_states: dict[str, float] = {}
keyword_cooldown: dict[str, float] = {}


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text())
    except Exception:
        return fallback


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.replace(path)


def load_subs() -> dict:
    data = load_json(SUB_PATH, {"users": {}})
    if not isinstance(data, dict):
        return {"users": {}}
    data.setdefault("users", {})
    return data


def save_subs(data: dict) -> None:
    save_json(SUB_PATH, data)


def load_tasks() -> dict:
    data = load_json(TASKS_PATH, {"botName": BOT_NAME, "tasks": []})
    if not isinstance(data, dict):
        return {"botName": BOT_NAME, "tasks": []}
    data.setdefault("tasks", [])
    return data


def enabled_tasks(kind: str) -> list[dict]:
    out = []
    for row in load_tasks().get("tasks") or []:
        if not isinstance(row, dict):
            continue
        if row.get("enabled") is False:
            continue
        if str(row.get("type") or "") == kind:
            out.append(row)
    return out


def sign(value: str) -> str:
    sig = hmac.new(SESSION_SECRET, value.encode(), hashlib.sha256).hexdigest()
    return f"{value}.{sig}"


def unsign(token: str) -> str | None:
    if "." not in token:
        return None
    value, sig = token.rsplit(".", 1)
    expect = hmac.new(SESSION_SECRET, value.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expect):
        return value
    return None


def discord_enabled() -> bool:
    return bool(BOT_TOKEN and CLIENT_ID and CLIENT_SECRET)


def invite_url() -> str:
    if not CLIENT_ID:
        return ""
    return (
        "https://discord.com/oauth2/authorize"
        f"?client_id={urllib.parse.quote(CLIENT_ID)}"
        "&permissions=85056&scope=bot%20applications.commands"
    )


def http_json(url: str, *, data: dict | None = None, headers: dict | None = None, method: str = "GET") -> dict:
    hdrs = {"User-Agent": "QadbakDiscordBot/1.0", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if data is not None:
        raw = urllib.parse.urlencode(data).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=raw, headers=hdrs, method=method)
    else:
        req = urllib.request.Request(url, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def discord_json(method: str, path: str, payload: dict | None = None) -> dict:
    raw = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10{path}",
        data=raw,
        method=method,
        headers={
            "Authorization": f"Bot {BOT_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "QadbakDiscordBot/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        text = res.read().decode()
        return json.loads(text) if text else {}


def send_dm(user_id: str, content: str) -> None:
    if not BOT_TOKEN:
        return
    ch = discord_json("POST", "/users/@me/channels", {"recipient_id": user_id})
    channel_id = ch.get("id")
    if not channel_id:
        raise RuntimeError("no DM channel")
    discord_json("POST", f"/channels/{channel_id}/messages", {"content": content[:1900]})


def host_snapshot() -> dict | None:
    if not STATUS_URL or not STATUS_TOKEN:
        return None
    req = urllib.request.Request(
        STATUS_URL,
        headers={
            "Authorization": f"Bearer {STATUS_TOKEN}",
            "User-Agent": "QadbakDiscordBot/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as res:
            return json.loads(res.read().decode() or "{}")
    except Exception as e:
        print(f"WARN status: {e}", flush=True)
        return None


def format_status(snap: dict | None) -> str:
    if not snap:
        return "Host status is not available yet."
    disks = snap.get("disks") or []
    disk_txt = ", ".join(f"{d.get('mount')} {d.get('usePct')}%" for d in disks[:4]) or "n/a"
    load = snap.get("loadAvg") or [0, 0, 0]
    docker = snap.get("docker") or []
    running = sum(1 for c in docker if c.get("state") == "running")
    return (
        f"**{snap.get('hostname', 'Qadbak')}**\n"
        f"RAM {snap.get('memoryUsePct', 0)}% · load {load[0]}\n"
        f"Disk: {disk_txt}\n"
        f"Docker: {running}/{len(docker)} running"
    )


def format_minecraft(snap: dict | None) -> str:
    mc = (snap or {}).get("minecraft")
    if not mc or not mc.get("installed"):
        return "No Minecraft app on this Qadbak host."
    state = "online" if mc.get("online") else "offline"
    join = mc.get("joinAddress") or ""
    players = mc.get("players") or []
    extra = f"\nPlayers: {', '.join(players)}" if players else "\nNo players listed."
    return f"Minecraft is **{state}**. Join: `{join}`{extra}"


def html_page(body: str) -> bytes:
    login = ""
    if discord_enabled():
        login = '<p><a class="btn" href="/login">Link Discord for DMs</a></p>'
    invite = invite_url()
    invite_html = (
        f'<p><a class="btn" href="{invite}">Add this bot to Discord</a></p>' if invite else ""
    )
    guild = f'<p class="muted">Guild invite: <a href="{GUILD_INVITE}">{GUILD_INVITE}</a></p>' if GUILD_INVITE else ""
    tasks = load_tasks().get("tasks") or []
    slashes = []
    for row in tasks:
        if row.get("enabled") is False:
            continue
        kind = str(row.get("type") or "")
        params = row.get("params") or {}
        if kind == "qadbak.status":
            slashes.append("/" + (params.get("name") or "status"))
        elif kind == "minecraft.status":
            slashes.append("/" + (params.get("name") or "minecraft"))
        elif kind == "slash.reply" and params.get("name"):
            slashes.append("/" + str(params.get("name")))
    slash_html = ", ".join(slashes) if slashes else "none yet — assign tasks in the Qadbak panel"
    page = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{BOT_NAME}</title>
<style>
body {{ font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:grid; place-items:center; }}
main {{ max-width: 38rem; padding: 2rem; }}
h1 {{ margin: 0 0 .5rem; }}
p {{ color:#94a3b8; line-height:1.55; }}
.btn {{ display:inline-block; background:#5865F2; color:#fff; text-decoration:none; padding:.7rem 1.1rem; border-radius:.6rem; font-weight:600; margin:.2rem .4rem .2rem 0; }}
.ok {{ color:#86efac; }} .muted {{ font-size:.9rem; }}
code {{ background:#1e293b; padding:.15rem .4rem; border-radius:.35rem; }}
</style></head><body><main>
<h1>{BOT_NAME}</h1>
<p>Qadbak Discord bot — no-code tasks, host alerts, and slash commands.</p>
{invite_html}
{login}
<p>Slash commands: {slash_html}</p>
{body}
{guild}
<p class="muted">Enable <strong>Message Content</strong> and <strong>Server Members</strong> intents in Discord Developer Portal for keyword replies and welcomes.</p>
</main></body></html>"""
    return page.encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(fmt % args, flush=True)

    def cookie_user(self) -> str | None:
        raw = self.headers.get("Cookie", "")
        jar = SimpleCookie()
        jar.load(raw)
        morsel = jar.get("qdb")
        if not morsel:
            return None
        return unsign(morsel.value)

    def send_html(self, code: int, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, loc: str, cookie: str | None = None) -> None:
        self.send_response(302)
        self.send_header("Location", loc)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/status":
            payload = json.dumps(
                {"ok": True, "discord": discord_enabled(), "invite": invite_url() or None, "bot": BOT_NAME}
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if path == "/login":
            if not discord_enabled():
                self.send_html(200, html_page("<p>Discord OAuth is not configured yet.</p>"))
                return
            state = hashlib.sha256(os.urandom(16)).hexdigest()[:24]
            with lock:
                oauth_states[state] = time.time()
            params = urllib.parse.urlencode(
                {
                    "client_id": CLIENT_ID,
                    "redirect_uri": f"{PUBLIC_URL}/auth/callback",
                    "response_type": "code",
                    "scope": "identify",
                    "state": state,
                    "prompt": "consent",
                }
            )
            self.redirect(f"https://discord.com/oauth2/authorize?{params}")
            return

        if path == "/auth/callback":
            if not discord_enabled():
                self.send_html(400, html_page("<p>Discord is not configured.</p>"))
                return
            state = (qs.get("state") or [""])[0]
            code = (qs.get("code") or [""])[0]
            with lock:
                ts = oauth_states.pop(state, None)
            if not ts or time.time() - ts > 600 or not code:
                self.send_html(400, html_page("<p>Login expired. Try again.</p>"))
                return
            token = http_json(
                "https://discord.com/api/v10/oauth2/token",
                data={
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": f"{PUBLIC_URL}/auth/callback",
                },
            )
            access = token.get("access_token")
            if not access:
                self.send_html(400, html_page("<p>Discord did not return a token.</p>"))
                return
            me = http_json(
                "https://discord.com/api/v10/users/@me",
                headers={"Authorization": f"Bearer {access}"},
            )
            uid = str(me.get("id") or "")
            username = str(me.get("username") or "user")
            if not uid:
                self.send_html(400, html_page("<p>Could not read Discord user.</p>"))
                return
            data = load_subs()
            data.setdefault("users", {})[uid] = {
                "id": uid,
                "username": username,
                "notify": True,
                "linkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            save_subs(data)
            try:
                extra = f"\nJoin the Discord first so DMs work: {GUILD_INVITE}" if GUILD_INVITE else ""
                send_dm(uid, f"Linked to **{BOT_NAME}**. You will get Qadbak host updates here.{extra}")
                note = f'<p class="ok">Hi @{username} — check your Discord DMs.</p>'
            except Exception:
                note = (
                    f'<p class="ok">Hi @{username}, you are linked.</p>'
                    "<p>If no DM arrived: add the bot to a shared server, allow DMs, then /login again.</p>"
                )
            cookie = f"qdb={sign(uid)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax"
            self.send_response(200)
            body = html_page(note)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Set-Cookie", cookie)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        uid = self.cookie_user()
        extra = ""
        if uid:
            row = load_subs().get("users", {}).get(uid) or {}
            extra = f'<p class="ok">Linked as Discord @{row.get("username", uid)}.</p>'
        self.send_html(200, html_page(extra))


def slash_name(params: dict, fallback: str) -> str:
    raw = re.sub(r"[^a-z0-9-]", "", str(params.get("name") or "").lower())[:32]
    return raw or fallback


def start_bot() -> None:
    if not BOT_TOKEN:
        print("discord gateway off (no bot token)", flush=True)
        return
    try:
        import discord
        from discord import app_commands
        from discord.ext import commands, tasks
    except Exception as e:
        print(f"WARN discord.py missing: {e}", flush=True)
        return

    intents = discord.Intents.default()
    try:
        intents.message_content = True
        intents.members = True
    except Exception:
        pass
    bot = commands.Bot(command_prefix="!", intents=intents)

    async def handle_named(interaction: discord.Interaction, name: str) -> None:
        snap = await asyncio.to_thread(host_snapshot)
        for row in load_tasks().get("tasks") or []:
            if row.get("enabled") is False:
                continue
            kind = str(row.get("type") or "")
            params = row.get("params") or {}
            if kind == "qadbak.status" and slash_name(params, "status") == name:
                await interaction.response.send_message(format_status(snap), ephemeral=True)
                return
            if kind == "minecraft.status" and slash_name(params, "minecraft") == name:
                await interaction.response.send_message(format_minecraft(snap), ephemeral=True)
                return
            if kind == "slash.reply" and slash_name(params, "") == name:
                text = str(params.get("text") or "OK")[:1900]
                await interaction.response.send_message(text)
                return
        await interaction.response.send_message("That command is not assigned.", ephemeral=True)

    async def rebuild_tree() -> None:
        bot.tree.clear_commands(guild=None)
        names = []
        for row in load_tasks().get("tasks") or []:
            if row.get("enabled") is False:
                continue
            kind = str(row.get("type") or "")
            params = row.get("params") or {}
            name = ""
            desc = "Qadbak command"
            if kind == "qadbak.status":
                name = slash_name(params, "status")
                desc = str(params.get("description") or "Qadbak server status")[:100]
            elif kind == "minecraft.status":
                name = slash_name(params, "minecraft")
                desc = str(params.get("description") or "Minecraft server status")[:100]
            elif kind == "slash.reply":
                name = slash_name(params, "")
                desc = str(params.get("description") or params.get("text") or "Canned reply")[:100]
            if not name or name in names:
                continue
            names.append(name)

            async def _cb(interaction: discord.Interaction, _n=name):
                await handle_named(interaction, _n)

            bot.tree.add_command(app_commands.Command(name=name, description=desc or "Qadbak", callback=_cb))
        try:
            await bot.tree.sync()
        except Exception as e:
            print(f"WARN slash sync: {e}", flush=True)

    last_mtime = {"v": 0.0}

    @bot.event
    async def on_ready():
        print(f"discord gateway ready as {bot.user}", flush=True)
        try:
            last_mtime["v"] = TASKS_PATH.stat().st_mtime
        except OSError:
            last_mtime["v"] = 0.0
        await rebuild_tree()
        if not reload_tasks.is_running():
            reload_tasks.start()

    @bot.event
    async def on_member_join(member: discord.Member):
        for row in enabled_tasks("welcome"):
            text = str((row.get("params") or {}).get("text") or "Welcome {user}!").replace(
                "{user}", member.mention
            )
            channel = member.guild.system_channel
            if channel is None:
                for ch in member.guild.text_channels:
                    channel = ch
                    break
            if channel is None:
                continue
            try:
                await channel.send(text[:1900])
            except Exception as e:
                print(f"WARN welcome: {e}", flush=True)

    @bot.event
    async def on_message(message: discord.Message):
        if message.author.bot:
            return
        content = (message.content or "").lower()
        if not content:
            return
        key = f"{message.channel.id}"
        now = time.time()
        if now - keyword_cooldown.get(key, 0) < 8:
            return
        for row in enabled_tasks("keyword.reply"):
            needle = str((row.get("params") or {}).get("keyword") or "").strip().lower()
            reply = str((row.get("params") or {}).get("text") or "").strip()
            if needle and needle in content and reply:
                keyword_cooldown[key] = now
                try:
                    await message.channel.send(reply[:1900])
                except Exception as e:
                    print(f"WARN keyword: {e}", flush=True)
                return

    @tasks.loop(seconds=20)
    async def reload_tasks():
        try:
            mtime = TASKS_PATH.stat().st_mtime
        except OSError:
            return
        if mtime == last_mtime["v"]:
            return
        last_mtime["v"] = mtime
        await rebuild_tree()

    try:
        bot.run(BOT_TOKEN)
    except Exception as e:
        print(f"WARN gateway: {e}", flush=True)


def main() -> None:
    threading.Thread(target=start_bot, daemon=True).start()
    port = int(os.environ.get("PORT", "8787"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(
        f"discord-bot on :{port} public={PUBLIC_URL} discord={discord_enabled()} name={BOT_NAME}",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
