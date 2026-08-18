#!/usr/bin/env python3
"""Qadbak Telegram bot hoster: public page, commands, host alerts."""
from __future__ import annotations

import asyncio
import html
import json
import os
import re
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://127.0.0.1:8788").rstrip("/")
BOT_NAME = os.environ.get("BOT_NAME", "Qadbak").strip() or "Qadbak"
BOT_TOKEN = re.sub(r"\s+", "", os.environ.get("TELEGRAM_BOT_TOKEN", "").strip())
DEFAULT_CHAT = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
SUB_PATH = Path(os.environ.get("SUBSCRIBERS_PATH", "/data/telegram-subscribers.json"))
TASKS_PATH = Path(os.environ.get("TASKS_PATH", "/data/tasks.json"))
STATUS_URL = os.environ.get("STATUS_URL", "").strip()
STATUS_TOKEN = os.environ.get("STATUS_TOKEN", "").strip()
WATCH_PATH = Path(os.environ.get("WATCH_STATE_PATH", "/data/host-watch.json"))
DIGEST_SEC = 30 * 60
BOT_STARTED = time.time()
keyword_cooldown: dict[str, float] = {}
GATEWAY: dict[str, object] = {"ready": False, "username": ""}


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


def load_tasks() -> dict:
    data = load_json(TASKS_PATH, {"botName": BOT_NAME, "tasks": []})
    if not isinstance(data, dict):
        return {"botName": BOT_NAME, "tasks": []}
    data.setdefault("tasks", [])
    return data


def enabled_tasks(kind: str) -> list[dict]:
    out = []
    for row in load_tasks().get("tasks") or []:
        if not isinstance(row, dict) or row.get("enabled") is False:
            continue
        if str(row.get("type") or "") == kind:
            out.append(row)
    return out


def alerts_enabled() -> bool:
    for row in load_tasks().get("tasks") or []:
        if isinstance(row, dict) and str(row.get("type") or "") == "qadbak.alerts":
            return row.get("enabled") is not False
    return True


def command_name(params: object, fallback: str) -> str:
    raw = ""
    if isinstance(params, dict):
        raw = str(params.get("name") or "")
    cleaned = re.sub(r"[^a-z0-9_]", "", raw.strip().lower())[:32]
    return cleaned or fallback


def listed_commands() -> str:
    names = ["/start"]
    mapping = [
        ("qadbak.status", "status"),
        ("qadbak.help", "help"),
        ("qadbak.uptime", "uptime"),
        ("minecraft.status", "minecraft"),
    ]
    for kind, fallback in mapping:
        for row in enabled_tasks(kind):
            names.append("/" + command_name(row.get("params"), fallback))
    for row in enabled_tasks("command.reply"):
        name = command_name(row.get("params"), "")
        if name:
            names.append("/" + name)
    seen: list[str] = []
    for n in names:
        if n not in seen:
            seen.append(n)
    return " ".join(seen)


def esc(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def host_snapshot() -> dict | None:
    if not STATUS_URL or not STATUS_TOKEN:
        return None
    req = urllib.request.Request(
        STATUS_URL,
        headers={"Authorization": f"Bearer {STATUS_TOKEN}", "User-Agent": "QadbakTelegramBot/1.0"},
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
        f"{snap.get('hostname', 'Qadbak')}\n"
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
    return f"Minecraft is {state}. Join: {join}"


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
    docker = {c.get("name"): c.get("state") for c in (snap.get("docker") or []) if c.get("name")}
    old = prev.get("docker") or {}
    if old:
        for name, st in docker.items():
            if old.get(name) == "running" and st in ("exited", "dead"):
                msgs.append(f"[Qadbak] Docker container {name} {st}.")
            if old.get(name) in ("exited", "dead") and st == "running":
                msgs.append(f"[Qadbak] Docker container {name} is running again.")
    prev["docker"] = docker
    return msgs


def load_subs() -> dict:
    data = load_json(SUB_PATH, {"chats": {}})
    if not isinstance(data, dict):
        return {"chats": {}}
    data.setdefault("chats", {})
    return data


def save_subs(data: dict) -> None:
    save_json(SUB_PATH, data)


def html_page(body: str) -> bytes:
    page = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{esc(BOT_NAME)}</title>
<style>
body {{ font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:grid; place-items:center; }}
main {{ max-width: 38rem; padding: 2rem; }}
p {{ color:#94a3b8; line-height:1.55; }}
.btn {{ display:inline-block; background:#229ED9; color:#fff; text-decoration:none; padding:.7rem 1.1rem; border-radius:.6rem; font-weight:600; }}
.muted {{ font-size:.9rem; }}
</style></head><body><main>
<h1>{esc(BOT_NAME)}</h1>
<p>Qadbak Telegram bot — host alerts and commands for this domain. Create the bot in BotFather, paste the token in Qadbak, then add it to <strong>your</strong> group.</p>
<p>In Telegram: search the bot, open a chat, send <code>/start</code>. In a group: add the bot and grant send-messages.</p>
{body}
<p class="muted">Commands: {esc(listed_commands())}</p>
</main></body></html>"""
    return page.encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(fmt % args, flush=True)

    def send_html(self, code: int, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/status":
            payload = json.dumps(
                {
                    "ok": True,
                    "telegram": bool(BOT_TOKEN),
                    "bot": BOT_NAME,
                    "polling": bool(GATEWAY.get("ready")),
                    "username": GATEWAY.get("username") or "",
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(payload)
            self.close_connection = True
            return
        note = "<p class='muted'>Telegram is configured.</p>" if BOT_TOKEN else "<p>Paste a BotFather token in the Qadbak app install.</p>"
        self.send_html(200, html_page(note))


def start_bot() -> None:
    if not BOT_TOKEN:
        print("telegram gateway off (no bot token)", flush=True)
        return
    if not re.match(r"^\d{5,}:[A-Za-z0-9_-]{20,}$", BOT_TOKEN):
        print(
            "telegram gateway off (token is not a full BotFather token — "
            "paste numbers:secret as one line, no spaces)",
            flush=True,
        )
        return
    try:
        from telegram import Update
        from telegram.ext import (
            Application,
            ChatMemberHandler,
            CommandHandler,
            ContextTypes,
            MessageHandler,
            filters,
        )
    except Exception as e:
        print(f"WARN python-telegram-bot missing: {e}", flush=True)
        return

    # JobQueue.run_repeating must run after Application.initialize()
    # (inside post_init). Calling it before run_polling used to crash
    # the gateway thread, so /start never reached Telegram.
    async def post_init(application: Application) -> None:
        try:
            await application.bot.delete_webhook(drop_pending_updates=True)
            me = await application.bot.get_me()
            GATEWAY["ready"] = True
            GATEWAY["username"] = str(me.username or "")
            print(
                f"telegram gateway ready as @{me.username} id={me.id}",
                flush=True,
            )
        except Exception as e:
            print(f"WARN telegram getMe: {e}", flush=True)
        if application.job_queue:
            application.job_queue.run_repeating(host_watch, interval=45, first=15)
        else:
            print("WARN telegram job_queue unavailable — host alerts disabled", flush=True)

    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()

    def chat_ids() -> list[str]:
        ids = []
        if DEFAULT_CHAT:
            ids.append(DEFAULT_CHAT)
        for cid in load_subs().get("chats", {}):
            if cid not in ids:
                ids.append(cid)
        return ids

    async def remember(update: Update) -> None:
        chat = update.effective_chat
        if chat is None:
            return
        data = load_subs()
        data["chats"][str(chat.id)] = {
            "id": str(chat.id),
            "title": chat.title or chat.username or str(chat.id),
            "linkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        save_subs(data)

    def cmd_from_text(text: str) -> str:
        if not text.startswith("/"):
            return ""
        return text[1:].split()[0].split("@")[0].lower()

    async def on_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message:
            return
        cmd = cmd_from_text(update.message.text or "")
        if not cmd:
            return
        if cmd == "start":
            try:
                await remember(update)
            except Exception as e:
                print(f"WARN remember: {e}", flush=True)
            await update.message.reply_text(f"Linked to {BOT_NAME}. Try {listed_commands()}.")
            return
        for row in enabled_tasks("qadbak.help"):
            if command_name(row.get("params"), "help") == cmd:
                await update.message.reply_text(listed_commands())
                return
        for row in enabled_tasks("qadbak.status"):
            if command_name(row.get("params"), "status") == cmd:
                snap = await asyncio.to_thread(host_snapshot)
                await update.message.reply_text(format_status(snap))
                return
        for row in enabled_tasks("minecraft.status"):
            if command_name(row.get("params"), "minecraft") == cmd:
                snap = await asyncio.to_thread(host_snapshot)
                await update.message.reply_text(format_minecraft(snap))
                return
        for row in enabled_tasks("qadbak.uptime"):
            if command_name(row.get("params"), "uptime") == cmd:
                mins = max(1, int((time.time() - BOT_STARTED) / 60))
                await update.message.reply_text(f"Bot uptime ≈ {mins} min.")
                return
        for row in enabled_tasks("command.reply"):
            name = command_name(row.get("params"), "")
            text = str((row.get("params") or {}).get("text") or "").strip()
            if name and name == cmd and text:
                await update.message.reply_text(text[:1900])
                return

    async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        if not update.message or not update.message.text:
            return
        content = update.message.text.lower()
        key = str(update.effective_chat.id if update.effective_chat else "")
        now = time.time()
        if now - keyword_cooldown.get(key, 0) < 8:
            return
        for row in enabled_tasks("keyword.reply"):
            needle = str((row.get("params") or {}).get("keyword") or "").strip().lower()
            reply = str((row.get("params") or {}).get("text") or "").strip()
            if needle and needle in content and reply:
                keyword_cooldown[key] = now
                await update.message.reply_text(reply[:1900])
                return

    async def on_chat_member(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        rows = enabled_tasks("welcome")
        cm = update.chat_member
        if not rows or cm is None or update.effective_chat is None:
            return
        old_s = cm.old_chat_member.status
        new_s = cm.new_chat_member.status
        if old_s not in ("left", "kicked") or new_s not in ("member", "restricted", "administrator"):
            return
        text = str((rows[0].get("params") or {}).get("text") or "Welcome {user}!")
        name = cm.new_chat_member.user.full_name or cm.new_chat_member.user.first_name or "there"
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=text.replace("{user}", name)[:1900],
        )

    async def post_all(text: str) -> None:
        for cid in chat_ids():
            try:
                await app.bot.send_message(chat_id=int(cid) if re.match(r"-?\d+$", cid) else cid, text=text[:1900])
            except Exception as e:
                print(f"WARN telegram send {cid}: {e}", flush=True)

    async def host_watch(context: ContextTypes.DEFAULT_TYPE) -> None:
        state = load_json(WATCH_PATH, {})
        if not isinstance(state, dict):
            state = {}
        now = time.time()
        changed = False
        if alerts_enabled():
            snap = await asyncio.to_thread(host_snapshot)
            msgs: list[str] = []
            if not state.get("helloSent"):
                msgs.append(f"[Qadbak] {BOT_NAME} is sending host updates here.")
            last = float(state.get("digestAt") or 0)
            if not last or now - last >= DIGEST_SEC:
                msgs.append("[Qadbak] " + format_status(snap).replace("\n", " · "))
            msgs.extend(snapshot_events(state, snap))
            for msg in msgs[:6]:
                await post_all(msg)
                await asyncio.sleep(0.3)
            if msgs:
                state["helloSent"] = True
                if not last or now - last >= DIGEST_SEC:
                    state["digestAt"] = now
                changed = True
        scheduled = state.get("scheduled") if isinstance(state.get("scheduled"), dict) else {}
        for row in enabled_tasks("scheduled.post"):
            params = row.get("params") or {}
            text = str(params.get("text") or "").strip()
            try:
                minutes = max(5, int(float(params.get("intervalMinutes") or 60)))
            except (TypeError, ValueError):
                minutes = 60
            key = str(row.get("id") or text[:24] or "post")
            last_at = float(scheduled.get(key) or 0)
            if text and (not last_at or now - last_at >= minutes * 60):
                await post_all(text)
                scheduled[key] = now
                changed = True
        if changed:
            state["scheduled"] = scheduled
            save_json(WATCH_PATH, state)

    app.add_handler(CommandHandler("start", on_command))
    app.add_handler(MessageHandler(filters.COMMAND, on_command))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    try:
        app.add_handler(ChatMemberHandler(on_chat_member, ChatMemberHandler.CHAT_MEMBER))
    except Exception as e:
        print(f"WARN chat_member handler: {e}", flush=True)
    print("telegram gateway starting", flush=True)
    try:
        app.run_polling(
            drop_pending_updates=True,
            allowed_updates=["message", "my_chat_member", "chat_member"],
            stop_signals=None,
        )
    except Exception:
        traceback.print_exc()
        print("telegram gateway crashed — /start will not work until this is fixed", flush=True)


def main() -> None:
    def run_gateway() -> None:
        try:
            start_bot()
        except Exception:
            traceback.print_exc()
            print("telegram gateway thread died", flush=True)

    threading.Thread(target=run_gateway, daemon=True).start()
    port = int(os.environ.get("PORT", "8788"))
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"telegram-bot on :{port} public={PUBLIC_URL} token={bool(BOT_TOKEN)} name={BOT_NAME}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
