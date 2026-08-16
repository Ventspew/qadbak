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

const TASK_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: "qadbak.alerts", label: "Qadbak alerts (DMs)", hint: "Disk, RAM, load, nginx/pm2, Docker, installs, updates" },
  { value: "qadbak.status", label: "Slash /status", hint: "Reply with disk, RAM, load, Docker" },
  { value: "minecraft.status", label: "Slash /minecraft", hint: "Online/offline if Minecraft is installed" },
  { value: "slash.reply", label: "Custom slash reply", hint: "Command name + canned text" },
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
      setSuccess("Bot credentials saved. Same token is reused for Minecraft if those fields are empty.");
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
        data.synced
          ? `Tasks saved and copied to ${data.synced} hosted bot(s).`
          : "Tasks saved. Install the Discord Bot app to host slash commands in Discord.",
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
          {hasToken ? "Invite the bot" : "Create a Discord application (once)"}
        </h2>
        {hasToken && settings.inviteUrl ? (
          <>
            <p className="text-sm text-panel-muted">
              Token is already saved. Click Invite now to add the bot to your Discord
              server — no extra Developer Portal work.
            </p>
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
              Enable <strong className="text-white">Message Content</strong> and{" "}
              <strong className="text-white">Server Members</strong> intents for keyword
              replies and welcomes.
            </li>
          </ol>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium text-white">Bot credentials</h2>
        <p className="text-sm text-panel-muted">
          One bot for the whole Qadbak host. Minecraft join/leave stays on the
          Minecraft sidecar. Discord often cannot DM unless you share a guild
          (invite URL). / Dezelfde bot als Minecraft; Discord kan vaak geen DM
          sturen tenzij jullie een server delen.
        </p>
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
            <Label>Panel OAuth2 Redirect URI</Label>
            <div className="flex flex-wrap gap-2">
              <Input readOnly value={settings.redirectUri} className="flex-1" />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void copyText(settings.redirectUri, "Redirect URI")}
              >
                Copy
              </Button>
            </div>
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
          <Button variant="secondary" disabled={busy} onClick={() => void testDm()}>
            {testing ? "Sending…" : "Test DM"}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-medium text-white">No-code tasks</h2>
        <p className="text-sm text-panel-muted">
          Assign what the bot does — no code editor. Host alerts run from the panel
          daemon. Slash commands and keyword/welcome need the Discord Bot app
          (App store) so the bot stays online.
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
                task.type === "slash.reply") && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Slash name</Label>
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
            Will register: {slashCommands.map((c) => `/${c.name}`).join(", ")}
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
            Slash commands stay online when you install{" "}
            <a className="text-panel-link hover:underline" href="/admin/apps">
              Apps → Discord Bot
            </a>
            . Host alerts already work from this page after you save a token and
            link Discord.
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
            Nobody linked yet. Use Link my Discord, or have people log in at
            bot.&lt;domain&gt;/login or mc.&lt;domain&gt;/login.
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
