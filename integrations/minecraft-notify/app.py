#!/usr/bin/env python3
"""Minecraft status page + Discord OAuth login + DM notifications."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://127.0.0.1:8787").rstrip("/")
JOIN_ADDRESS = os.environ.get("JOIN_ADDRESS", "localhost")
PACK_LABEL = os.environ.get("PACK_LABEL", "Minecraft")
MOTD = os.environ.get("MOTD", "Minecraft")
BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "").strip()
GUILD_INVITE = os.environ.get("DISCORD_GUILD_INVITE", "").strip()
SESSION_SECRET = os.environ.get("SESSION_SECRET", "change-me").encode()
LOG_PATH = Path(os.environ.get("LOG_PATH", "/data/logs/latest.log"))
SUB_PATH = Path(os.environ.get("SUBSCRIBERS_PATH", "/data/discord-subscribers.json"))
MC_HOST = os.environ.get("MC_HOST", "mc")
MC_PORT = int(os.environ.get("MC_PORT", "25565"))

JOIN_RE = re.compile(r": ([^\[\]\s:]+) joined the game")
LEAVE_RE = re.compile(r": ([^\[\]\s:]+) left the game")
STARTED_RE = re.compile(r"Done \(")
STOP_RE = re.compile(r"Stopping (the )?server", re.I)

lock = threading.Lock()
oauth_states: dict[str, float] = {}


def load_subs() -> dict:
    try:
        return json.loads(SUB_PATH.read_text())
    except Exception:
        return {"users": {}}


def save_subs(data: dict) -> None:
    SUB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = SUB_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.replace(SUB_PATH)


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


def http_json(url: str, *, data: dict | None = None, headers: dict | None = None, method: str = "GET") -> dict:
    body = None
    hdrs = {"User-Agent": "QadbakMinecraftNotify/1.0", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if data is not None:
        raw = urllib.parse.urlencode(data).encode()
        hdrs["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=raw, headers=hdrs, method=method)
    else:
        req = urllib.request.Request(url, headers=hdrs, method=method)
        if method == "POST" and "json" in (headers or {}):
            pass
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:400]
        raise RuntimeError(f"Discord HTTP {e.code}: {err}") from e


def discord_json(method: str, path: str, payload: dict | None = None) -> dict:
    raw = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        f"https://discord.com/api/v10{path}",
        data=raw,
        method=method,
        headers={
            "Authorization": f"Bot {BOT_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "QadbakMinecraftNotify/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            text = res.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:400]
        raise RuntimeError(f"Discord HTTP {e.code}: {err}") from e


def send_dm(user_id: str, content: str) -> None:
    if not BOT_TOKEN:
        return
    ch = discord_json("POST", "/users/@me/channels", {"recipient_id": user_id})
    channel_id = ch.get("id")
    if not channel_id:
        raise RuntimeError("no DM channel")
    discord_json("POST", f"/channels/{channel_id}/messages", {"content": content[:1900]})


def broadcast(content: str, *, ign: str | None = None) -> None:
    data = load_subs()
    for uid, row in list(data.get("users", {}).items()):
        if not row.get("notify", True):
            continue
        linked_ign = str(row.get("ign") or "").strip()
        if ign and linked_ign and linked_ign.lower() != ign.lower():
            # Still notify everyone of join/leave; ign filter only for "your character"
            pass
        try:
            send_dm(uid, content)
        except Exception as e:
            print(f"WARN dm {uid}: {e}", flush=True)


def server_up() -> bool:
    sock = socket.socket()
    sock.settimeout(2)
    try:
        sock.connect((MC_HOST, MC_PORT))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def watch_logs() -> None:
    pos = 0
    last_up = None
    while True:
        up = server_up()
        if last_up is None:
            last_up = up
        elif up != last_up:
            last_up = up
            if up:
                broadcast(f"**{MOTD}** is online. Join: `{JOIN_ADDRESS}`")
            else:
                broadcast(f"**{MOTD}** went offline.")
        if LOG_PATH.is_file():
            try:
                size = LOG_PATH.stat().st_size
                if pos > size:
                    pos = 0
                with LOG_PATH.open("r", errors="replace") as fh:
                    fh.seek(pos)
                    chunk = fh.read()
                    pos = fh.tell()
                for line in chunk.splitlines():
                    m = JOIN_RE.search(line)
                    if m:
                        name = m.group(1)
                        broadcast(f"**{name}** joined `{JOIN_ADDRESS}`")
                        continue
                    m = LEAVE_RE.search(line)
                    if m:
                        name = m.group(1)
                        broadcast(f"**{name}** left `{JOIN_ADDRESS}`")
                        continue
                    if STARTED_RE.search(line):
                        broadcast(f"**{MOTD}** finished starting. Join: `{JOIN_ADDRESS}`")
                    elif STOP_RE.search(line):
                        broadcast(f"**{MOTD}** is stopping.")
            except Exception as e:
                print(f"WARN log: {e}", flush=True)
        time.sleep(4)


def html_page(body: str, status_note: str = "") -> bytes:
    login = ""
    if discord_enabled():
        login = '<p><a class="btn" href="/login">Log in with Discord</a> — get server updates in your DMs.</p>'
    invite = ""
    if GUILD_INVITE:
        invite = f'<p class="muted">Also join the Discord: <a href="{GUILD_INVITE}">{GUILD_INVITE}</a></p>'
    page = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{MOTD}</title>
<style>
body {{ font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:grid; place-items:center; }}
main {{ max-width: 38rem; padding: 2rem; }}
h1 {{ margin: 0 0 .5rem; }}
p {{ color:#94a3b8; line-height:1.55; }}
code {{ display:block; background:#1e293b; color:#f8fafc; padding:1rem 1.25rem; border-radius:.75rem; font-size:1.15rem; }}
.tag {{ display:inline-block; background:#334155; color:#cbd5e1; font-size:.8rem; padding:.2rem .55rem; border-radius:999px; margin-bottom:1rem; }}
.btn {{ display:inline-block; background:#5865F2; color:#fff; text-decoration:none; padding:.7rem 1.1rem; border-radius:.6rem; font-weight:600; }}
.ok {{ color:#86efac; }} .bad {{ color:#fca5a5; }}
.muted {{ font-size:.9rem; }}
form {{ margin-top:1rem; display:flex; gap:.5rem; flex-wrap:wrap; }}
input {{ background:#1e293b; border:1px solid #334155; color:#fff; padding:.55rem .7rem; border-radius:.5rem; }}
button {{ background:#334155; color:#fff; border:0; padding:.55rem .9rem; border-radius:.5rem; cursor:pointer; }}
</style></head><body><main>
<span class="tag">{PACK_LABEL}</span>
<h1>Java Minecraft server</h1>
<p class="{ 'ok' if server_up() else 'bad' }">{status_note or ('Online' if server_up() else 'Starting / offline')}</p>
<p>Minecraft Java Edition → Multiplayer → Add server:</p>
<code>{JOIN_ADDRESS}</code>
{login}
{body}
{invite}
<p class="muted">Bedrock / phone edition is not this package.</p>
</main></body></html>"""
    return page.encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(fmt % args, flush=True)

    def cookie_user(self) -> str | None:
        raw = self.headers.get("Cookie", "")
        jar = SimpleCookie()
        jar.load(raw)
        morsel = jar.get("qmc")
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
            payload = json.dumps({"ok": True, "online": server_up(), "join": JOIN_ADDRESS, "discord": discord_enabled()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if path == "/login":
            if not discord_enabled():
                self.send_html(200, html_page("<p>Discord login is not configured yet.</p>"))
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

        if path == "/logout":
            uid = self.cookie_user()
            if uid:
                data = load_subs()
                if uid in data.get("users", {}):
                    data["users"][uid]["notify"] = False
                    save_subs(data)
            self.redirect("/", "qmc=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax")
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
                "ign": data.get("users", {}).get(uid, {}).get("ign", ""),
                "notify": True,
                "linkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            save_subs(data)
            try:
                extra = f"\nJoin the Discord first so DMs work: {GUILD_INVITE}" if GUILD_INVITE else ""
                send_dm(
                    uid,
                    f"Linked to **{MOTD}**. You will get join/leave and online/offline updates here.{extra}\nJoin address: `{JOIN_ADDRESS}`",
                )
                note = f'<p class="ok">Hi @{username} — check your Discord DMs.</p>'
            except Exception:
                note = (
                    f'<p class="ok">Hi @{username}, you are linked.</p>'
                    '<p>If no DM arrived: add the bot to a shared Discord server, allow DMs from server members, then /login again.</p>'
                )
            cookie = f"qmc={sign(uid)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax"
            body = html_page(
                note
                + '<form method="post" action="/ign"><input name="ign" placeholder="Minecraft name (optional)"/><button>Save</button></form>'
                + '<p class="muted"><a href="/logout">Disable DM updates</a></p>'
            )
            self.send_response(200)
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
            extra = (
                f'<p class="ok">Logged in as Discord @{row.get("username", uid)}. DMs are {"on" if row.get("notify") else "off"}.</p>'
                f'<form method="post" action="/ign"><input name="ign" value="{row.get("ign") or ""}" placeholder="Minecraft name"/><button>Save name</button></form>'
                '<p class="muted"><a href="/logout">Disable DM updates</a></p>'
            )
        elif not discord_enabled():
            extra = '<p class="muted">Ask the admin to add a Discord bot token on this Minecraft app to enable DM login.</p>'
        self.send_html(200, html_page(extra))

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/ign":
            self.send_html(404, html_page("<p>Not found.</p>"))
            return
        uid = self.cookie_user()
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length).decode() if length else ""
        fields = urllib.parse.parse_qs(raw)
        ign = re.sub(r"[^A-Za-z0-9_]", "", (fields.get("ign") or [""])[0])[:16]
        if uid:
            data = load_subs()
            if uid in data.get("users", {}):
                data["users"][uid]["ign"] = ign
                save_subs(data)
        self.redirect("/")


def main() -> None:
    threading.Thread(target=watch_logs, daemon=True).start()
    port = int(os.environ.get("PORT", "8787"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"minecraft-notify on :{port} public={PUBLIC_URL} discord={discord_enabled()}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
