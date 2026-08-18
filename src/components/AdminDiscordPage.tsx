"use client";

import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { useEffect, useState } from "react";

type DiscordSettings = {
  enabled: boolean;
  botTokenSet: boolean;
  clientId: string;
  clientSecretSet: boolean;
  invite: string;
  updatesChannelId: string;
  redirectUri: string;
  inviteUrl: string;
};

type Subscriber = { id: string; username: string; sources: string[] };
type Task = {
  id: string;
  enabled: boolean;
  type: string;
  params: Record<string, string>;
};
type Recipes = { botName: string; tasks: Task[] };
type Install = {
  parentDomain: string;
  subdomain: string;
  botName: string;
  publicUrl: string;
  inviteUrl: string;
  botRedirectUri: string;
};
type BotPresence = {
  ok: boolean;
  username: string;
  id: string;
  guilds: Array<{ id: string; name: string }>;
};

const TASK_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: "qadbak.alerts", label: "Qadbak alerts (channel)", hint: "Disk, RAM, load, nginx/pm2, Docker, installs" },
  { value: "qadbak.status", label: "!status", hint: "RAM, disk, load, Docker as an embed" },
  { value: "qadbak.disk", label: "!disk", hint: "Disk usage per mount" },
  { value: "qadbak.docker", label: "!docker", hint: "Container states" },
  { value: "qadbak.load", label: "!load", hint: "CPU load averages" },
  { value: "qadbak.ping", label: "!ping", hint: "Bot online check" },
  { value: "qadbak.about", label: "!about", hint: "What this bot does" },
  { value: "qadbak.invite", label: "!invite", hint: "Invite URL for this bot" },
  { value: "qadbak.help", label: "!help", hint: "Lists enabled commands" },
  { value: "qadbak.uptime", label: "!uptime", hint: "Bot uptime plus host snapshot" },
  { value: "minecraft.status", label: "!minecraft", hint: "Online/offline if Minecraft is installed" },
  { value: "slash.reply", label: "Custom !command reply", hint: "Name + canned text — also works as /name" },
  { value: "slash.embed", label: "!embed", hint: "Rich embed: title, text, color" },
  { value: "poll.create", label: "!poll", hint: "Ask a question, bot adds 👍👎" },
  { value: "scheduled.post", label: "Scheduled post", hint: "Repeat a message every N minutes" },
  { value: "auto.role", label: "Auto-role on join", hint: "Role ID — needs Server Members intent" },
  { value: "keyword.reply", label: "Keyword reply", hint: "If a message contains a word, reply" },
  { value: "welcome", label: "Welcome new members", hint: "Use {user} in the text" },
  { value: "announce", label: "Announce from panel", hint: "Stores the channel ID for Send announcement" },
];

function newTask(type = "slash.reply"): Task {
  return {
    id: `task-${Date.now().toString(36)}`,
    enabled: true,
    type,
    params: {},
  };
}

export function AdminDiscordPage() {
  const [settings, setSettings] = useState<DiscordSettings | null>(null);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [recipes, setRecipes] = useState<Recipes | null>(null);
  const [installs, setInstalls] = useState<Install[]>([]);
  const [bot, setBot] = useState<BotPresence | null>(null);
  const [slashCommands, setSlashCommands] = useState<Array<{ name: string; description: string }>>([]);
  const [botToken, setBotToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [invite, setInvite] = useState("");
  const [updatesChannelId, setUpdatesChannelId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [announceChannel, setAnnounceChannel] = useState("");
  const [announceMessage, setAnnounceMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);

  function applyPayload(data: {
    settings?: DiscordSettings;
    subscribers?: Subscriber[];
    recipes?: Recipes;
    installs?: Install[];
    slashCommands?: Array<{ name: string; description: string }>;
    bot?: BotPresence;
  }) {
    if (data.settings) {
      setSettings(data.settings);
      setClientId(data.settings.clientId ?? "");
      setInvite(data.settings.invite ?? "");
      setUpdatesChannelId(data.settings.updatesChannelId ?? "");
      setEnabled(Boolean(data.settings.enabled));
      setBotToken("");
      setClientSecret("");
    }
    if (data.subscribers) setSubscribers(data.subscribers);
    if (data.recipes) setRecipes(data.recipes);
    if (data.installs) setInstalls(data.installs);
    if (data.slashCommands) setSlashCommands(data.slashCommands);
    if (data.bot) setBot(data.bot);
  }

  async function load() {
    const res = await fetch("/api/admin/discord");
    const data = await res.json();
    if (!res.ok) {
      setSettings(null);
      setError(String(data.error ?? "Could not load Discord settings."));
      return;
    }
    applyPayload(data);
    setError("");
  }

  useEffect(() => {
    load()
      .catch(() => {
        setSettings(null);
        setError("Could not load Discord settings.");
      })
      .finally(() => setBootLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("discord");
    if (q === "linked") setSuccess("Discord account linked. Check your DMs.");
    else if (q === "need-oauth") setError("Save the OAuth2 client ID and secret before linking Discord.");
    else if (q === "error") setError("Discord login failed or expired. Try Link my Discord again.");
  }, []);

  useEffect(() => {
    if (!settings?.botTokenSet) return;
    if (bot?.ok && bot.guilds.length > 0) return;
    const t = window.setInterval(() => {
      void fetch("/api/admin/discord")
        .then((r) => r.json())
        .then((data: { bot?: BotPresence }) => {
          if (data.bot) setBot(data.bot);
        })
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(t);
  }, [settings?.botTokenSet, bot?.ok, bot?.guilds.length]);

  async function saveCredentials() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body: Record<string, unknown> = {
        clientId,
        invite,
        updatesChannelId,
        enabled,
      };
      if (botToken.trim()) body.botToken = botToken.trim();
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      const res = await fetch("/api/admin/discord", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      applyPayload(data);
      if (typeof data.warning === "string" && data.warning) {
        setError(data.warning);
        setSuccess("Credentials saved. The host bot container still needs a fix.");
      } else {
        setSuccess(
          "Bot credentials saved. Invite this host bot to YOUR Discord. Minecraft and customer Discord Bot apps need their own application — this token is never reused.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function saveTasks() {
    if (!recipes) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-tasks",
          botName: recipes.botName,
          tasks: recipes.tasks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      applyPayload(data);
      setSuccess(
        "Tasks saved. The host bot reloads them automatically. Customer Discord bots keep their own tasks.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function registerCommands() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register-commands" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Register failed");
      applyPayload(data);
      setSuccess(`Registered ${data.registered ?? 0} slash command(s) with Discord.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function testChannel() {
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-channel" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      applyPayload(data);
      setSuccess("Test message posted in your Discord server.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function testDm() {
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Test failed");
      setSuccess(
        `Test DM sent to ${data.sent ?? 0} user(s)` +
          (data.skipped ? ` (${data.skipped} could not be DMed — join a shared server).` : "."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function announce() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "announce",
          channelId: announceChannel,
          message: announceMessage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Announce failed");
      setSuccess("Announcement sent.");
      setAnnounceMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSuccess(`${label} copied.`);
    } catch {
      setError("Could not copy. Select the field and copy it.");
    }
  }

  if (bootLoading) {
    return (
      <Card>
        <p className="text-sm text-panel-muted">Loading Discord…</p>
      </Card>
    );
  }

  if (!settings || !recipes) {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-medium text-white">Discord</h2>
        <Alert>{error || "Could not load Discord settings."}</Alert>
        <Button variant="secondary" onClick={() => void load()}>
          Retry
        </Button>
      </Card>
    );
  }

  const busy = saving || testing;
  const hasToken = settings.botTokenSet;

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Card className="space-y-3">
        <h2 className="text-lg font-medium text-white">
          {hasToken ? "Get replies in your Discord" : "Create a Discord application (once)"}
        </h2>
        {hasToken && settings.inviteUrl ? (
          <>
            <p className="text-sm text-panel-muted">
              This is <strong className="text-white">your</strong> host bot — invite it to
              the Discord server you use. Slash commands like <code>/ping</code> work as
              soon as the bot is in the server. Prefix commands like{" "}
              <code>!status</code> in a channel need Message Content Intent.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-panel-muted">
              <li>
                Click Invite now
                {bot?.ok && bot.guilds.length === 0
                  ? " — the bot is in 0 servers until you do"
                  : bot?.ok && bot.guilds.length > 0
                    ? ` — already in ${bot.guilds.map((g) => g.name).join(", ")}`
                    : ""}
                .
              </li>
              <li>
                Developer Portal → Bot → Privileged Gateway Intents → enable{" "}
                <strong className="text-white">Message Content Intent</strong> for{" "}
                <code>!status</code> in a channel.
              </li>
              <li>
                Enable <strong className="text-white">Server Members Intent</strong> only
                if you use welcome or auto-role.
              </li>
              <li>
                DM the bot <code>!ping</code>, then in the server try{" "}
                <code>/ping</code>.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Input readOnly value={settings.inviteUrl} className="flex-1 min-w-[16rem]" />
              <Button type="button" variant="secondary" onClick={() => void copyText(settings.inviteUrl, "Invite URL")}>
                Copy invite
              </Button>
              <a
                className="inline-flex items-center rounded-md bg-[#5865F2] px-4 py-2 text-sm font-medium text-white"
                href={settings.inviteUrl}
                target="_blank"
                rel="noreferrer"
              >
                Invite now
              </a>
            </div>
          </>
        ) : (
          <ol className="list-decimal space-y-2 pl-5 text-sm text-panel-muted">
            <li>
              Open the{" "}
              <a
                className="text-panel-link hover:underline"
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noreferrer"
              >
                Discord Developer Portal
              </a>{" "}
              and create an application.
            </li>
            <li>Bot → Add Bot → copy the token. OAuth2 → copy client ID and client secret.</li>
            <li>Paste them below, Save, then use Invite now.</li>
            <li>
              Enable <strong className="text-white">Message Content</strong> for{" "}
              <code>!status</code> in a channel. Enable{" "}
              <strong className="text-white">Server Members</strong> only for welcomes
              and auto-role.
            </li>
          </ol>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium text-white">Bot credentials</h2>
        <p className="text-sm text-panel-muted">
          One bot for this Qadbak host (the operator). Customer Discord Bot apps
          under Apps use their own Discord application and invite URL on{" "}
          <code>bot.theirdomain</code> — they do not share this token. Click{" "}
          <strong>Invite</strong> so THIS host bot joins YOUR server.
        </p>
        {bot?.ok && (
          <p className="text-sm text-panel-muted">
            Bot @{bot.username}
            {bot.guilds.length === 0
              ? " is in 0 servers — click Invite below."
              : ` is in ${bot.guilds.length} server(s): ${bot.guilds.map((g) => g.name).join(", ")}`}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-panel-muted">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable host Discord updates
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Bot token</Label>
            <Input
              type="password"
              autoComplete="off"
              value={botToken}
              placeholder={settings.botTokenSet ? "Leave blank to keep the current token" : ""}
              onChange={(e) => setBotToken(e.target.value)}
            />
          </div>
          <div>
            <Label>OAuth2 client ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div>
            <Label>OAuth2 client secret</Label>
            <Input
              type="password"
              autoComplete="off"
              value={clientSecret}
              placeholder={
                settings.clientSecretSet ? "Leave blank to keep the current secret" : ""
              }
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Guild invite URL (optional)</Label>
            <Input
              value={invite}
              placeholder="https://discord.gg/..."
              onChange={(e) => setInvite(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Updates channel ID (optional)</Label>
            <Input
              value={updatesChannelId}
              placeholder="Leave empty — first channel the bot can talk in"
              onChange={(e) => setUpdatesChannelId(e.target.value)}
            />
            <p className="mt-1 text-xs text-panel-muted">
              Discord → right-click channel → Copy Channel ID (Developer Mode). After Invite,
              the bot posts status here without anyone linking DMs.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>OAuth2 redirect URIs (add every line in Discord Developer Portal)</Label>
            <p className="mb-2 text-xs text-panel-muted">
              Use the Invite button here — not Discord&apos;s generated URL (that one asks for
              Administrator and User Install). Qadbak invite is guild install,{" "}
              <code>bot</code> + <code>applications.commands</code>.
            </p>
            {[settings.redirectUri]
              .filter((uri, i, all) => uri && all.indexOf(uri) === i)
              .map((uri) => (
                <div key={uri} className="mb-2 flex flex-wrap gap-2">
                  <Input readOnly value={uri} className="flex-1" />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void copyText(uri, "Redirect URI")}
                  >
                    Copy
                  </Button>
                </div>
              ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void saveCredentials()}>
            {saving ? "Saving…" : "Save credentials"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              window.location.href = "/api/admin/discord/login";
            }}
          >
            Link my Discord
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !settings.inviteUrl}
            onClick={() => {
              if (settings.inviteUrl) window.open(settings.inviteUrl, "_blank");
            }}
          >
            Invite bot to Discord
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void testChannel()}>
            {testing ? "Sending…" : "Post test in Discord server"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void testDm()}>
            {testing ? "Sending…" : "Test DM"}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium text-white">No-code tasks</h2>
        <p className="text-sm text-panel-muted">
          Assign what <strong className="text-white">this host bot</strong> does — no
          code editor. Channel alerts still run from the panel daemon. Commands
          (<code>!status</code>, <code>/ping</code>) need the host gateway container,
          which starts when you save credentials. Enable Message Content Intent in
          the Developer Portal for <code>!status</code> in a server channel. DMs and
          slash commands work without that intent.
        </p>
        <div>
          <Label>Bot display name</Label>
          <Input
            value={recipes.botName}
            onChange={(e) => setRecipes({ ...recipes, botName: e.target.value })}
          />
        </div>
        <ul className="space-y-4">
          {recipes.tasks.map((task, i) => (
            <li key={task.id} className="rounded-md border border-panel-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="checkbox"
                  checked={task.enabled}
                  onChange={(e) => {
                    const tasks = [...recipes.tasks];
                    tasks[i] = { ...task, enabled: e.target.checked };
                    setRecipes({ ...recipes, tasks });
                  }}
                />
                <select
                  className="qadbak-field py-1 text-sm"
                  value={task.type}
                  onChange={(e) => {
                    const tasks = [...recipes.tasks];
                    tasks[i] = { ...task, type: e.target.value, params: {} };
                    setRecipes({ ...recipes, tasks });
                  }}
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    setRecipes({
                      ...recipes,
                      tasks: recipes.tasks.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
              <p className="text-xs text-panel-muted">
                {TASK_TYPES.find((t) => t.value === task.type)?.hint}
              </p>
              {(task.type === "qadbak.status" ||
                task.type === "minecraft.status" ||
                task.type === "qadbak.help" ||
                task.type === "qadbak.uptime" ||
                task.type === "qadbak.disk" ||
                task.type === "qadbak.docker" ||
                task.type === "qadbak.load" ||
                task.type === "qadbak.ping" ||
                task.type === "qadbak.about" ||
                task.type === "qadbak.invite" ||
                task.type === "slash.reply" ||
                task.type === "slash.embed" ||
                task.type === "poll.create") && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Command name (!name)</Label>
                    <Input
                      value={task.params.name ?? ""}
                      placeholder={task.type === "minecraft.status" ? "minecraft" : "status"}
                      onChange={(e) => {
                        const tasks = [...recipes.tasks];
                        tasks[i] = {
                          ...task,
                          params: { ...task.params, name: e.target.value },
                        };
                        setRecipes({ ...recipes, tasks });
                      }}
                    />
                  </div>
                  {task.type === "slash.reply" && (
                    <div className="sm:col-span-2">
                      <Label>Reply text</Label>
                      <Input
                        value={task.params.text ?? ""}
                        onChange={(e) => {
                          const tasks = [...recipes.tasks];
                          tasks[i] = {
                            ...task,
                            params: { ...task.params, text: e.target.value },
                          };
                          setRecipes({ ...recipes, tasks });
                        }}
                      />
                    </div>
                  )}
                  {task.type === "poll.create" && (
                    <div className="sm:col-span-2">
                      <Label>Default question (optional)</Label>
                      <Input
                        value={task.params.question ?? ""}
                        placeholder="Yes or no?"
                        onChange={(e) => {
                          const tasks = [...recipes.tasks];
                          tasks[i] = {
                            ...task,
                            params: { ...task.params, question: e.target.value },
                          };
                          setRecipes({ ...recipes, tasks });
                        }}
                      />
                    </div>
                  )}
                  {task.type === "slash.embed" && (
                    <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label>Title</Label>
                        <Input
                          value={task.params.title ?? ""}
                          onChange={(e) => {
                            const tasks = [...recipes.tasks];
                            tasks[i] = {
                              ...task,
                              params: { ...task.params, title: e.target.value },
                            };
                            setRecipes({ ...recipes, tasks });
                          }}
                        />
                      </div>
                      <div>
                        <Label>Color (hex)</Label>
                        <Input
                          value={task.params.color ?? ""}
                          placeholder="5865F2"
                          onChange={(e) => {
                            const tasks = [...recipes.tasks];
                            tasks[i] = {
                              ...task,
                              params: { ...task.params, color: e.target.value },
                            };
                            setRecipes({ ...recipes, tasks });
                          }}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label>Description</Label>
                        <Input
                          value={task.params.text ?? ""}
                          onChange={(e) => {
                            const tasks = [...recipes.tasks];
                            tasks[i] = {
                              ...task,
                              params: { ...task.params, text: e.target.value },
                            };
                            setRecipes({ ...recipes, tasks });
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {task.type === "keyword.reply" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Keyword</Label>
                    <Input
                      value={task.params.keyword ?? ""}
                      onChange={(e) => {
                        const tasks = [...recipes.tasks];
                        tasks[i] = {
                          ...task,
                          params: { ...task.params, keyword: e.target.value },
                        };
                        setRecipes({ ...recipes, tasks });
                      }}
                    />
                  </div>
                  <div>
                    <Label>Reply</Label>
                    <Input
                      value={task.params.text ?? ""}
                      onChange={(e) => {
                        const tasks = [...recipes.tasks];
                        tasks[i] = {
                          ...task,
                          params: { ...task.params, text: e.target.value },
                        };
                        setRecipes({ ...recipes, tasks });
                      }}
                    />
                  </div>
                </div>
              )}
              {task.type === "welcome" && (
                <div>
                  <Label>Welcome text</Label>
                  <Input
                    value={task.params.text ?? ""}
                    placeholder="Welcome {user}!"
                    onChange={(e) => {
                      const tasks = [...recipes.tasks];
                      tasks[i] = {
                        ...task,
                        params: { ...task.params, text: e.target.value },
                      };
                      setRecipes({ ...recipes, tasks });
                    }}
                  />
                </div>
              )}
              {task.type === "scheduled.post" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Every N minutes</Label>
                    <Input
                      value={task.params.intervalMinutes ?? "60"}
                      onChange={(e) => {
                        const tasks = [...recipes.tasks];
                        tasks[i] = {
                          ...task,
                          params: { ...task.params, intervalMinutes: e.target.value },
                        };
                        setRecipes({ ...recipes, tasks });
                      }}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Message</Label>
                    <Input
                      value={task.params.text ?? ""}
                      onChange={(e) => {
                        const tasks = [...recipes.tasks];
                        tasks[i] = {
                          ...task,
                          params: { ...task.params, text: e.target.value },
                        };
                        setRecipes({ ...recipes, tasks });
                      }}
                    />
                  </div>
                </div>
              )}
              {task.type === "auto.role" && (
                <div>
                  <Label>Role ID</Label>
                  <Input
                    value={task.params.roleId ?? ""}
                    placeholder="123456789012345678"
                    onChange={(e) => {
                      const tasks = [...recipes.tasks];
                      tasks[i] = {
                        ...task,
                        params: { ...task.params, roleId: e.target.value },
                      };
                      setRecipes({ ...recipes, tasks });
                    }}
                  />
                </div>
              )}
              {task.type === "announce" && (
                <div>
                  <Label>Default channel ID</Label>
                  <Input
                    value={task.params.channelId ?? ""}
                    placeholder="123456789012345678"
                    onChange={(e) => {
                      const tasks = [...recipes.tasks];
                      tasks[i] = {
                        ...task,
                        params: { ...task.params, channelId: e.target.value },
                      };
                      setRecipes({ ...recipes, tasks });
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setRecipes({ ...recipes, tasks: [...recipes.tasks, newTask()] })
            }
          >
            Add task
          </Button>
          <Button disabled={busy} onClick={() => void saveTasks()}>
            Save tasks
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void registerCommands()}>
            Register slash commands
          </Button>
        </div>
        {slashCommands.length > 0 && (
          <p className="text-xs text-panel-muted">
            Will register as /name (optional) and !name:{" "}
            {slashCommands.map((c) => `!${c.name}`).join(", ")}
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium text-white">Send announcement</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Channel ID</Label>
            <Input
              value={announceChannel}
              placeholder="Right-click channel → Copy Channel ID"
              onChange={(e) => setAnnounceChannel(e.target.value)}
            />
          </div>
          <div>
            <Label>Message</Label>
            <Input
              value={announceMessage}
              onChange={(e) => setAnnounceMessage(e.target.value)}
            />
          </div>
        </div>
        <Button disabled={busy || !announceChannel || !announceMessage} onClick={() => void announce()}>
          Send
        </Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium text-white">Hosted bot</h2>
        {installs.length === 0 ? (
          <p className="text-sm text-panel-muted">
            Customer installs at <code>bot.&lt;domain&gt;</code> are that customer&apos;s
            Discord application only. They must not use this host bot. Public invite
            and Discord linking on those pages are disabled if they still have this
            application&apos;s client ID.
          </p>
        ) : (
          <ul className="space-y-2 text-sm text-panel-muted">
            {installs.map((row) => (
              <li key={row.subdomain}>
                <a className="text-panel-link hover:underline" href={row.publicUrl}>
                  {row.publicUrl}
                </a>
                <span className="ml-2 text-xs">
                  Redirect: <code className="text-white">{row.botRedirectUri}</code>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-medium text-white">Linked subscribers</h2>
        {subscribers.length === 0 ? (
          <p className="text-sm text-panel-muted">
            Nobody linked yet. Use <strong>Link my Discord</strong> on this page.
            Customer bot and Minecraft pages never add people to this host list.
          </p>
        ) : (
          <ul className="space-y-1 text-sm text-panel-muted">
            {subscribers.map((s) => (
              <li key={s.id}>
                @{s.username} <code className="text-white">{s.id}</code>{" "}
                <span className="text-xs">({s.sources.join(", ")})</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
