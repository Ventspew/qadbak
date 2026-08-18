#!/usr/bin/env python3
"""Qadbak Discord bot hoster: invite page, OAuth link, gateway, no-code tasks."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import html
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import aiohttp
from aiohttp import web

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
UPDATES_CHANNEL = os.environ.get("DISCORD_UPDATES_CHANNEL", "").strip()
WATCH_PATH = Path(os.environ.get("WATCH_STATE_PATH", "/data/host-watch.json"))
DIGEST_SEC = 30 * 60
BOT_STARTED = time.time()

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


def alerts_enabled() -> bool:
    rows = load_tasks().get("tasks") or []
    for row in rows:
        if isinstance(row, dict) and str(row.get("type") or "") == "qadbak.alerts":
            return row.get("enabled") is not False
    return True


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
        "&permissions=85056&integration_type=0&scope=bot%20applications.commands"
    )


def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def safe_http_url(url: str) -> str:
    u = (url or "").strip()
    if u.startswith("https://") or u.startswith("http://"):
        return u
    return ""


def safe_invite(url: str) -> str:
    u = (url or "").strip()
    if u.startswith("https://discord.gg/") or u.startswith("https://discord.com/invite/"):
        return u
    return ""


def html_redirect_page(url: str) -> bytes:
    """200 HTML redirect — Cloudflare/nginx 502 on empty 302s from stdlib http.server."""
    target = safe_http_url(url) or "/"
    href = esc(target)
    return (
        "<!DOCTYPE html><html lang='en'><head>"
        "<meta charset='utf-8'/>"
        f"<meta http-equiv='refresh' content='0;url={href}'/>"
        "<title>Continue</title></head><body>"
        f"<p>Continue to <a href='{href}'>Discord</a>.</p>"
        f"<script>location.replace({json.dumps(target)});</script>"
        "</body></html>"
    ).encode()


def oauth_redirect_uri() -> str:
    raw = PUBLIC_URL.rstrip("/")
    if raw.startswith("http://") and "127.0.0.1" not in raw and "localhost" not in raw:
        raw = "https://" + raw[len("http://") :]
    return f"{raw}/auth/callback"


def sanitize_api_error(raw: str, status: int | None = None) -> str:
    text = str(raw or "").strip()
    low = text.lower()
    if "<html" in low or "<!doctype" in low or "cloudflare" in low or "bad gateway" in low:
        return f"discord_api_http_{status}" if status else "discord_api_unavailable"
    line = text.replace("\n", " ").strip()[:160]
    return line or (f"discord_api_http_{status}" if status else "no_token")


async def discord_form_json(
    url: str, *, data: dict | None = None, headers: dict | None = None
) -> dict:
    """Outbound Discord HTTP via aiohttp + IPv4. Never returns HTML error bodies."""
    hdrs = {"User-Agent": "QadbakDiscordBot/1.0", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    timeout = aiohttp.ClientTimeout(total=12)
    last: dict = {"error": "no_token"}
    for attempt in range(3):
        connector = aiohttp.TCPConnector(family=socket.AF_INET)
        try:
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                if data is not None:
                    resp_cm = session.post(url, data=data, headers=hdrs)
                else:
                    resp_cm = session.get(url, headers=hdrs)
                async with resp_cm as resp:
                    body = await resp.text()
                    parsed: dict = {}
                    try:
                        loaded = json.loads(body) if body else {}
                        if isinstance(loaded, dict):
                            parsed = loaded
                    except Exception:
                        parsed = {}
                    if resp.ok and parsed:
                        return parsed
                    err = (
                        parsed.get("error_description")
                        or parsed.get("error")
                        or sanitize_api_error(body, resp.status)
                    )
                    last = {"error": sanitize_api_error(str(err), resp.status)}
                    if resp.status < 500:
                        return last
        except Exception as e:
            last = {"error": sanitize_api_error(str(e))}
        await asyncio.sleep(0.45 * (attempt + 1))
    return last


def http_json(url: str, *, data: dict | None = None, headers: dict | None = None, method: str = "GET") -> dict:
    hdrs = {"User-Agent": "QadbakDiscordBot/1.0", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    try:
        if data is not None:
            raw = urllib.parse.urlencode(data).encode()
            hdrs["Content-Type"] = "application/x-www-form-urlencoded"
            req = urllib.request.Request(url, data=raw, headers=hdrs, method=method)
        else:
            req = urllib.request.Request(url, headers=hdrs, method=method)
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:800]
        print(f"WARN HTTP {e.code} {url}: {body}", flush=True)
        try:
            parsed = json.loads(body) if body else {}
            if isinstance(parsed, dict):
                parsed.setdefault("error", f"http_{e.code}")
                return parsed
        except Exception:
            pass
        return {"error": sanitize_api_error(body or f"http_{e.code}", e.code)}
    except Exception as e:
        print(f"WARN HTTP {url}: {e}", flush=True)
        return {"error": sanitize_api_error(str(e))}


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


def format_disk(snap: dict | None) -> str:
    disks = (snap or {}).get("disks") or []
    if not disks:
        return "No disk data yet."
    lines = [f"`{d.get('mount')}` {d.get('usePct')}%" for d in disks[:8]]
    return "**Disk usage**\n" + "\n".join(lines)


def format_docker(snap: dict | None) -> str:
    docker = (snap or {}).get("docker") or []
    if not docker:
        return "No Docker containers reported."
    running = sum(1 for c in docker if c.get("state") == "running")
    lines = [f"`{c.get('name')}` · {c.get('state')}" for c in docker[:12]]
    return f"**Docker** {running}/{len(docker)} running\n" + "\n".join(lines)


def format_load(snap: dict | None) -> str:
    load = (snap or {}).get("loadAvg") or [0, 0, 0]
    return f"**Load average** `{load[0]}` `{load[1]}` `{load[2]}`"


def snapshot_color(snap: dict | None) -> int:
    if not snap:
        return 0x99AAB5
    mem = int(snap.get("memoryUsePct") or 0)
    disks = snap.get("disks") or []
    disk_max = max((int(d.get("usePct") or 0) for d in disks), default=0)
    if mem >= 90 or disk_max >= 90:
        return 0xED4245
    if mem >= 80 or disk_max >= 85:
        return 0xFEE75C
    return 0x57F287


def status_embed(snap: dict | None, title: str = "Host status"):
    import discord

    embed = discord.Embed(
        title=title,
        description=(snap or {}).get("hostname") or BOT_NAME,
        color=snapshot_color(snap),
    )
    if not snap:
        embed.add_field(name="Status", value="Host snapshot not available yet.", inline=False)
        return embed
    load = snap.get("loadAvg") or [0, 0, 0]
    disks = snap.get("disks") or []
    disk_txt = ", ".join(f"{d.get('mount')} {d.get('usePct')}%" for d in disks[:4]) or "n/a"
    docker = snap.get("docker") or []
    running = sum(1 for c in docker if c.get("state") == "running")
    embed.add_field(name="RAM", value=f"{snap.get('memoryUsePct', 0)}%", inline=True)
    embed.add_field(name="Load", value=str(load[0]), inline=True)
    embed.add_field(name="Docker", value=f"{running}/{len(docker)} up", inline=True)
    embed.add_field(name="Disk", value=disk_txt, inline=False)
    mc = snap.get("minecraft") or {}
    if mc.get("installed"):
        embed.add_field(
            name="Minecraft",
            value="online" if mc.get("online") else "offline",
            inline=True,
        )
    embed.set_footer(text="Qadbak live snapshot")
    return embed


def alert_embed(text: str, *, critical: bool = False):
    import discord

    color = 0xED4245 if critical else 0xFEE75C
    return discord.Embed(title="Qadbak alert", description=text[:4000], color=color)


def snapshot_events(prev: dict, snap: dict | None) -> list[str]:
    if not snap:
        return []
    msgs: list[str] = []
    disks = snap.get("disks") or []
    root = next((d for d in disks if d.get("mount") == "/"), disks[0] if disks else None)
    if root and int(root.get("usePct") or 0) >= 85:
        key = f"{root.get('mount')}:{root.get('usePct')}"
        if prev.get("disk_alert") != key:
            msgs.append(f"[Qadbak] Disk {root.get('mount')} at {root.get('usePct')}%.")
            prev["disk_alert"] = key
    mem = int(snap.get("memoryUsePct") or 0)
    if mem >= 90 and prev.get("mem_alert") != mem:
        msgs.append(f"[Qadbak] RAM at {mem}%.")
        prev["mem_alert"] = mem
    docker = {c.get("name"): c.get("state") for c in (snap.get("docker") or []) if c.get("name")}
    old = prev.get("docker") or {}
    if old:
        for name, st in docker.items():
            if old.get(name) == "running" and st in ("exited", "dead"):
                msgs.append(f"[Qadbak] Docker container {name} {st}.")
            if old.get(name) in ("exited", "dead") and st == "running":
                msgs.append(f"[Qadbak] Docker container {name} is running again.")
    prev["docker"] = docker
    mc = snap.get("minecraft") or {}
    if mc.get("installed"):
        online = bool(mc.get("online"))
        was = prev.get("mc_online")
        if was is not None and was != online:
            msgs.append(f"[Qadbak] Minecraft is {'online' if online else 'offline'}.")
        prev["mc_online"] = online
    return msgs


def html_page(body: str) -> bytes:
    login = ""
    if discord_enabled():
        login = '<p><a class="btn" href="/login">Link Discord for DMs</a></p>'
    invite = invite_url()
    invite_html = (
        f'<p><a class="btn" href="{esc(invite)}">Add this bot to your Discord server</a></p>'
        "<p>Zonder Invite kan de bot nergens posten en geen DMs sturen.</p>"
        if invite
        else ""
    )
    guild_url = safe_invite(GUILD_INVITE)
    guild = (
        f'<p class="muted">Guild invite: <a href="{esc(guild_url)}">{esc(guild_url)}</a></p>'
        if guild_url
        else ""
    )
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
        elif kind == "qadbak.help":
            slashes.append("/" + (params.get("name") or "help"))
        elif kind == "qadbak.uptime":
            slashes.append("/" + (params.get("name") or "uptime"))
        elif kind == "slash.embed" and params.get("name"):
            slashes.append("/" + str(params.get("name")))
        elif kind == "poll.create":
            slashes.append("/" + (params.get("name") or "poll"))
    slash_html = ", ".join(slashes) if slashes else "none yet — assign tasks in the Qadbak panel"
    page = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{esc(BOT_NAME)}</title>
<style>
body {{ font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:grid; place-items:center; }}
main {{ max-width: 38rem; padding: 2rem; }}
h1 {{ margin: 0 0 .5rem; }}
p {{ color:#94a3b8; line-height:1.55; }}
.btn {{ display:inline-block; background:#5865F2; color:#fff; text-decoration:none; padding:.7rem 1.1rem; border-radius:.6rem; font-weight:600; margin:.2rem .4rem .2rem 0; }}
.ok {{ color:#86efac; }} .muted {{ font-size:.9rem; }}
code {{ background:#1e293b; padding:.15rem .4rem; border-radius:.35rem; }}
</style></head><body><main>
<h1>{esc(BOT_NAME)}</h1>
<p>Qadbak Discord bot — no-code tasks, host alerts, and slash commands.</p>
{invite_html}
{login}
<p>Slash commands: {slash_html}</p>
{body}
{guild}
<p class="muted">Enable <strong>Message Content</strong> and <strong>Server Members</strong> intents in Discord Developer Portal for keyword replies and welcomes.</p>
</main></body></html>"""
    return page.encode()


NO_STORE = {"Cache-Control": "private, no-store, no-cache, must-revalidate"}


def html_resp(
    body: bytes, status: int = 200, cookie: tuple[str, str] | None = None
) -> web.Response:
    resp = web.Response(body=body, status=status, content_type="text/html", charset="utf-8")
    resp.headers.update(NO_STORE)
    resp.force_close()
    if cookie:
        resp.set_cookie(
            cookie[0],
            cookie[1],
            max_age=2592000,
            httponly=True,
            samesite="Lax",
            path="/",
            secure=True,
        )
    return resp


@web.middleware
async def close_mw(request: web.Request, handler):
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        exc.force_close()
        raise
    except Exception as e:
        print(f"WARN GET {request.path}: {e}", flush=True)
        resp = html_resp(
            html_page(
                "<p>Discord login failed. Open <a href='/login'>/login</a> again "
                "(the callback code is single-use).</p>"
            ),
            500,
        )
    resp.force_close()
    resp.headers.setdefault("Cache-Control", "private, no-store, no-cache, must-revalidate")
    return resp


async def handle_status(_request: web.Request) -> web.Response:
    payload = json.dumps(
        {
            "ok": True,
            "discord": discord_enabled(),
            "invite": invite_url() or None,
            "bot": BOT_NAME,
        }
    )
    resp = web.Response(text=payload, content_type="application/json")
    resp.headers.update(NO_STORE)
    resp.force_close()
    return resp


async def handle_login(_request: web.Request) -> web.Response:
    if not discord_enabled():
        return html_resp(html_page("<p>Discord OAuth is not configured yet.</p>"))
    state = hashlib.sha256(os.urandom(16)).hexdigest()[:24]
    with lock:
        oauth_states[state] = time.time()
    params = urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "redirect_uri": oauth_redirect_uri(),
            "response_type": "code",
            "scope": "identify",
            "state": state,
            "prompt": "consent",
        }
    )
    return html_resp(html_redirect_page(f"https://discord.com/oauth2/authorize?{params}"))


async def handle_callback(request: web.Request) -> web.Response:
    if not discord_enabled():
        return html_resp(html_page("<p>Discord is not configured.</p>"), 400)
    state = request.query.get("state", "")
    code = request.query.get("code", "")
    with lock:
        ts = oauth_states.pop(state, None)
    if not ts or time.time() - ts > 600 or not code:
        return html_resp(html_page("<p>Login expired. Try again.</p>"), 400)
    callback = oauth_redirect_uri()
    token = await discord_form_json(
        "https://discord.com/api/v10/oauth2/token",
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": callback,
        },
    )
    access = token.get("access_token")
    if not access:
        err = sanitize_api_error(
            str(token.get("error") or token.get("error_description") or "no_token")
        )
        return html_resp(
            html_page(
                "<p>Discord login did not finish. The one-time code is now used — start over.</p>"
                "<p>In Discord Developer Portal → OAuth2, add this exact redirect URI:</p>"
                f"<p><code>{esc(callback)}</code></p>"
                "<p>Also add the panel callback <code>/auth/callback</code> (shown on the Qadbak "
                "<code>/discord</code> page) so linking works even if this bot page fails.</p>"
                f"<p class='muted'>{esc(err)}</p>"
                "<p><a class='btn' href='/login'>Start over</a></p>"
            ),
            400,
        )
    me = await discord_form_json(
        "https://discord.com/api/v10/users/@me",
        headers={"Authorization": f"Bearer {access}"},
    )
    uid = str(me.get("id") or "")
    username = str(me.get("username") or "user")
    if not uid:
        return html_resp(html_page("<p>Could not read Discord user.</p>"), 400)
    data = load_subs()
    data.setdefault("users", {})[uid] = {
        "id": uid,
        "username": username,
        "notify": True,
        "linkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    save_subs(data)
    try:
        extra = f"\nJoin the Discord first so DMs work: {GUILD_INVITE}" if safe_invite(GUILD_INVITE) else ""
        await asyncio.to_thread(
            send_dm,
            uid,
            f"Linked to **{BOT_NAME}**. You will get Qadbak host updates here.{extra}",
        )
        note = f'<p class="ok">Hi @{esc(username)} — check your Discord DMs.</p>'
    except Exception:
        note = (
            f'<p class="ok">Hi @{esc(username)}, you are linked.</p>'
            "<p>If no DM arrived: add the bot to a shared server, allow DMs, then /login again.</p>"
        )
    return html_resp(html_page(note), cookie=("qdb", sign(uid)))


async def handle_index(request: web.Request) -> web.Response:
    uid = unsign(request.cookies.get("qdb") or "")
    extra = ""
    if uid:
        row = load_subs().get("users", {}).get(uid) or {}
        extra = f'<p class="ok">Linked as Discord @{esc(str(row.get("username", uid)))}.</p>'
    return html_resp(html_page(extra))


def make_http_app() -> web.Application:
    app = web.Application(middlewares=[close_mw])
    app.router.add_get("/api/status", handle_status)
    app.router.add_get("/login", handle_login)
    app.router.add_get("/auth/callback", handle_callback)
    app.router.add_get("/", handle_index)
    return app


async def serve_http() -> None:
    port = int(os.environ.get("PORT", "8787"))
    runner = web.AppRunner(make_http_app(), access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", port).start()
    print(
        f"discord-bot on :{port} public={PUBLIC_URL} discord={discord_enabled()} name={BOT_NAME}",
        flush=True,
    )
    await asyncio.Event().wait()


def slash_name(params: dict, fallback: str) -> str:
    raw = re.sub(r"[^a-z0-9-]", "", str(params.get("name") or "").lower())[:32]
    return raw or fallback


def slash_commands_from_loaded() -> list[str]:
    names: list[str] = []
    for row in load_tasks().get("tasks") or []:
        if row.get("enabled") is False:
            continue
        kind = str(row.get("type") or "")
        params = row.get("params") or {}
        if kind == "qadbak.status":
            names.append("/" + slash_name(params, "status"))
        elif kind == "minecraft.status":
            names.append("/" + slash_name(params, "minecraft"))
        elif kind == "qadbak.help":
            names.append("/" + slash_name(params, "help"))
        elif kind == "qadbak.uptime":
            names.append("/" + slash_name(params, "uptime"))
        elif kind == "qadbak.disk":
            names.append("/" + slash_name(params, "disk"))
        elif kind == "qadbak.docker":
            names.append("/" + slash_name(params, "docker"))
        elif kind == "qadbak.load":
            names.append("/" + slash_name(params, "load"))
        elif kind == "qadbak.ping":
            names.append("/" + slash_name(params, "ping"))
        elif kind == "qadbak.about":
            names.append("/" + slash_name(params, "about"))
        elif kind == "qadbak.invite":
            names.append("/" + slash_name(params, "invite"))
        elif kind == "slash.reply":
            n = slash_name(params, "")
            if n:
                names.append("/" + n)
        elif kind == "slash.embed":
            names.append("/" + slash_name(params, "info"))
        elif kind == "poll.create":
            names.append("/" + slash_name(params, "poll"))
    for extra in ("/status", "/disk", "/docker", "/load", "/ping", "/uptime", "/help", "/about", "/invite", "/minecraft"):
        if extra not in names:
            names.append(extra)
    return names


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
    # Do not require Message Content / Server Members — those privileged
    # intents prevent the gateway from connecting if they are off in the portal,
    # which silently stops all channel updates. Keyword/welcome stay optional.
    bot = commands.Bot(command_prefix="!", intents=intents)

    async def handle_named(interaction: discord.Interaction, name: str) -> None:
        snap = await asyncio.to_thread(host_snapshot)
        builtins = {
            "status": lambda: interaction.response.send_message(embed=status_embed(snap), ephemeral=True),
            "disk": lambda: interaction.response.send_message(format_disk(snap), ephemeral=True),
            "docker": lambda: interaction.response.send_message(format_docker(snap), ephemeral=True),
            "load": lambda: interaction.response.send_message(format_load(snap), ephemeral=True),
            "ping": lambda: interaction.response.send_message("Pong — Qadbak bot is online.", ephemeral=True),
            "about": lambda: interaction.response.send_message(
                f"**{BOT_NAME}** is the Qadbak Discord bot for this host.\n"
                "Use slash commands for live status. Channel alerts cover disk, RAM, Docker and Minecraft.",
                ephemeral=True,
            ),
            "invite": lambda: interaction.response.send_message(
                invite_url() or "Save a Discord application client ID in Qadbak first.",
                ephemeral=True,
            ),
            "uptime": lambda: interaction.response.send_message(
                embed=status_embed(snap, title=f"Uptime ≈ {max(1, int((time.time() - BOT_STARTED) / 60))} min"),
                ephemeral=True,
            ),
            "help": lambda: interaction.response.send_message(
                "Commands: " + ", ".join(f"`{n}`" for n in slash_commands_from_loaded() or ["/status"]),
                ephemeral=True,
            ),
            "minecraft": lambda: interaction.response.send_message(format_minecraft(snap), ephemeral=True),
        }
        if name in builtins:
            await builtins[name]()
            return
        for row in load_tasks().get("tasks") or []:
            if row.get("enabled") is False:
                continue
            kind = str(row.get("type") or "")
            params = row.get("params") or {}
            if kind == "qadbak.status" and slash_name(params, "status") == name:
                await interaction.response.send_message(embed=status_embed(snap), ephemeral=True)
                return
            if kind == "minecraft.status" and slash_name(params, "minecraft") == name:
                await interaction.response.send_message(format_minecraft(snap), ephemeral=True)
                return
            if kind == "slash.reply" and slash_name(params, "") == name:
                text = str(params.get("text") or "OK")[:1900]
                await interaction.response.send_message(text)
                return
            if kind == "qadbak.help" and slash_name(params, "help") == name:
                listed = slash_commands_from_loaded()
                await interaction.response.send_message(
                    "Commands: " + (", ".join(f"`{n}`" for n in listed) if listed else "none yet"),
                    ephemeral=True,
                )
                return
            if kind == "qadbak.uptime" and slash_name(params, "uptime") == name:
                mins = max(1, int((time.time() - BOT_STARTED) / 60))
                await interaction.response.send_message(
                    embed=status_embed(snap, title=f"Uptime ≈ {mins} min"),
                    ephemeral=True,
                )
                return
            if kind == "qadbak.disk" and slash_name(params, "disk") == name:
                await interaction.response.send_message(format_disk(snap), ephemeral=True)
                return
            if kind == "qadbak.docker" and slash_name(params, "docker") == name:
                await interaction.response.send_message(format_docker(snap), ephemeral=True)
                return
            if kind == "qadbak.load" and slash_name(params, "load") == name:
                await interaction.response.send_message(format_load(snap), ephemeral=True)
                return
            if kind == "qadbak.ping" and slash_name(params, "ping") == name:
                await interaction.response.send_message("Pong — Qadbak bot is online.", ephemeral=True)
                return
            if kind == "qadbak.about" and slash_name(params, "about") == name:
                await builtins["about"]()
                return
            if kind == "qadbak.invite" and slash_name(params, "invite") == name:
                await builtins["invite"]()
                return
            if kind == "slash.embed" and slash_name(params, "info") == name:
                title = str(params.get("title") or BOT_NAME)[:256]
                desc = str(params.get("text") or params.get("description") or "")[:1900]
                color_raw = re.sub(r"[^0-9a-fA-F]", "", str(params.get("color") or "5865F2"))[:6]
                color = int(color_raw or "5865F2", 16)
                embed = discord.Embed(title=title, description=desc or None, color=color)
                await interaction.response.send_message(embed=embed)
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
            elif kind == "qadbak.help":
                name = slash_name(params, "help")
                desc = str(params.get("description") or "List bot commands")[:100]
            elif kind == "qadbak.uptime":
                name = slash_name(params, "uptime")
                desc = str(params.get("description") or "Bot and host uptime")[:100]
            elif kind == "qadbak.disk":
                name = slash_name(params, "disk")
                desc = str(params.get("description") or "Disk usage per mount")[:100]
            elif kind == "qadbak.docker":
                name = slash_name(params, "docker")
                desc = str(params.get("description") or "Docker container states")[:100]
            elif kind == "qadbak.load":
                name = slash_name(params, "load")
                desc = str(params.get("description") or "CPU load averages")[:100]
            elif kind == "qadbak.ping":
                name = slash_name(params, "ping")
                desc = str(params.get("description") or "Check that the bot is online")[:100]
            elif kind == "qadbak.about":
                name = slash_name(params, "about")
                desc = str(params.get("description") or "What this bot does")[:100]
            elif kind == "qadbak.invite":
                name = slash_name(params, "invite")
                desc = str(params.get("description") or "Invite this bot to a server")[:100]
            elif kind == "slash.embed":
                name = slash_name(params, "info")
                desc = str(params.get("description") or params.get("title") or "Embed reply")[:100]
            elif kind == "poll.create":
                name = slash_name(params, "poll")
                desc = str(params.get("description") or "Post a yes/no poll")[:100]
                if name in names:
                    continue
                names.append(name)

                async def _poll(interaction: discord.Interaction, question: str, _n=name, _default=str(params.get("question") or "")):
                    q = (question or _default or "").strip()[:1800] or "Yes or no?"
                    await interaction.response.send_message(f"**Poll:** {q}")
                    msg = await interaction.original_response()
                    for emoji in ("👍", "👎"):
                        try:
                            await msg.add_reaction(emoji)
                        except Exception:
                            pass

                bot.tree.add_command(
                    app_commands.Command(name=name, description=desc or "Poll", callback=_poll)
                )
                continue
            if not name or name in names:
                continue
            names.append(name)

            async def _cb(interaction: discord.Interaction, _n=name):
                await handle_named(interaction, _n)

            bot.tree.add_command(app_commands.Command(name=name, description=desc or "Qadbak", callback=_cb))
        builtins = [
            ("status", "RAM, disk, load, Docker"),
            ("disk", "Disk usage per mount"),
            ("docker", "Docker container states"),
            ("load", "CPU load averages"),
            ("ping", "Check that the bot is online"),
            ("uptime", "Bot and host uptime"),
            ("help", "List slash commands"),
            ("about", "What this bot does"),
            ("invite", "Invite this bot to a server"),
            ("minecraft", "Minecraft server status"),
        ]
        for bname, bdesc in builtins:
            if bname in names:
                continue
            names.append(bname)

            async def _builtin(interaction: discord.Interaction, _n=bname):
                await handle_named(interaction, _n)

            bot.tree.add_command(
                app_commands.Command(name=bname, description=bdesc, callback=_builtin)
            )
        try:
            await bot.tree.sync()
        except Exception as e:
            print(f"WARN slash sync: {e}", flush=True)

    last_mtime = {"v": 0.0}

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
        for row in enabled_tasks("auto.role"):
            rid = re.sub(r"\D", "", str((row.get("params") or {}).get("roleId") or ""))
            if not rid:
                continue
            role = member.guild.get_role(int(rid))
            if role is None:
                continue
            try:
                await member.add_roles(role, reason="Qadbak auto.role")
            except Exception as e:
                print(f"WARN auto.role: {e}", flush=True)

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

    async def writable_text_channels():
        found = []
        if UPDATES_CHANNEL:
            try:
                ch = bot.get_channel(int(UPDATES_CHANNEL)) or await bot.fetch_channel(int(UPDATES_CHANNEL))
                if ch is not None:
                    found.append(ch)
            except Exception:
                pass
        for guild in bot.guilds:
            me = guild.me
            candidates = []
            if guild.system_channel is not None:
                candidates.append(guild.system_channel)
            candidates.extend(guild.text_channels)
            for ch in candidates:
                if ch in found:
                    continue
                try:
                    if ch.permissions_for(me).send_messages:
                        found.append(ch)
                except Exception:
                    continue
        return found

    async def post_update(text: str | None = None, *, embed=None) -> bool:
        channels = await writable_text_channels()
        if not channels:
            print(
                f"WARN updates: guilds={len(bot.guilds)} but no writable text channel",
                flush=True,
            )
            return False
        payload = {}
        if embed is not None:
            payload["embed"] = embed
        elif text:
            critical = any(
                w in text.lower()
                for w in ("exited", "dead", "disk", "ram at", "offline")
            )
            payload["embed"] = alert_embed(text, critical=critical)
        else:
            return False
        ok = False
        for channel in channels:
            try:
                await channel.send(**payload)
                ok = True
                break
            except Exception as e:
                print(f"WARN updates #{getattr(channel, 'name', channel.id)}: {e}", flush=True)
        return ok

    @tasks.loop(seconds=45)
    async def host_watch():
        state = load_json(WATCH_PATH, {})
        if not isinstance(state, dict):
            state = {}
        now = time.time()
        snap = await asyncio.to_thread(host_snapshot)
        msgs: list[str] = []
        posted_any = False
        digest_due = False
        if alerts_enabled():
            last = float(state.get("digestAt") or 0)
            if not last or now - last >= DIGEST_SEC:
                digest_due = True
            msgs.extend(snapshot_events(state, snap))
            if not state.get("helloSent"):
                hello = discord.Embed(
                    title=f"{BOT_NAME} is watching this host",
                    description=(
                        "Live alerts for disk, RAM, Docker and Minecraft. "
                        "Try `/status` `/disk` `/docker` `/help`."
                    ),
                    color=0x5865F2,
                )
                if await post_update(embed=hello):
                    state["helloSent"] = True
                    posted_any = True
        if digest_due and alerts_enabled():
            if await post_update(embed=status_embed(snap, title="Host digest")):
                posted_any = True
                state["digestAt"] = now
        for row in enabled_tasks("scheduled.post"):
            text = str((row.get("params") or {}).get("text") or "").strip()
            if not text:
                continue
            mins_raw = re.sub(r"\D", "", str((row.get("params") or {}).get("intervalMinutes") or "60"))
            mins = max(5, int(mins_raw or "60"))
            key = f"sched_{row.get('id') or 'post'}"
            last_s = float(state.get(key) or 0)
            if not last_s or now - last_s >= mins * 60:
                msgs.append(text[:1900])
                state[key] = now
        for msg in msgs[:6]:
            if await post_update(msg):
                posted_any = True
            await asyncio.sleep(0.4)
        if posted_any:
            save_json(WATCH_PATH, state)

    @bot.event
    async def on_ready():
        print(
            f"discord gateway ready as {bot.user} guilds={len(bot.guilds)}",
            flush=True,
        )
        try:
            last_mtime["v"] = TASKS_PATH.stat().st_mtime
        except OSError:
            last_mtime["v"] = 0.0
        await rebuild_tree()
        if not reload_tasks.is_running():
            reload_tasks.start()
        if not host_watch.is_running():
            host_watch.start()
        if len(bot.guilds) == 0:
            print("WARN: bot is in 0 Discord servers — click Invite on the public page", flush=True)

    try:
        bot.run(BOT_TOKEN)
    except Exception as e:
        print(f"WARN gateway: {e}", flush=True)


def main() -> None:
    threading.Thread(target=start_bot, daemon=True).start()
    asyncio.run(serve_http())


if __name__ == "__main__":
    main()
