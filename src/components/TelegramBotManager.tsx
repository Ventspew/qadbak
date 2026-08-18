"use client";

import Link from "next/link";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";
import type { TelegramBotRecipes } from "@/lib/telegram-bot-tasks";

type Task = TelegramBotRecipes["tasks"][number];

type Payload = {
  installed: boolean;
  parentDomain?: string;
  subdomain?: string;
  publicUrl?: string;
  botName?: string;
  botUsername?: string;
  containerStatus?: string;
  inviteUrl?: string;
  recipes: TelegramBotRecipes;
  commands?: Array<{ command: string; description: string }>;
};

const TASK_TYPES: Array<{ value: Task["type"]; label: string; hint: string }> = [
  { value: "qadbak.alerts", label: "Host alerts", hint: "Disk, RAM, load, Docker in this chat" },
  { value: "qadbak.status", label: "/status", hint: "Reply with disk, RAM, load, Docker" },
  { value: "qadbak.disk", label: "/disk", hint: "Disk usage per mount" },
  { value: "qadbak.docker", label: "/docker", hint: "Container states" },
  { value: "qadbak.load", label: "/load", hint: "CPU load averages" },
  { value: "qadbak.ping", label: "/ping", hint: "Bot online check" },
  { value: "qadbak.about", label: "/about", hint: "What this bot does" },
  { value: "qadbak.settings", label: "/settings", hint: "Telegram privacy mode (official rules)" },
  { value: "qadbak.help", label: "/help", hint: "Lists enabled commands" },
  { value: "qadbak.uptime", label: "/uptime", hint: "How long the bot has been running" },
  { value: "minecraft.status", label: "/minecraft", hint: "Online/offline if Minecraft is installed" },
  { value: "command.reply", label: "Custom command", hint: "Command name + canned text" },
  { value: "keyword.reply", label: "Keyword reply", hint: "If a message contains a word, reply" },
  { value: "scheduled.post", label: "Scheduled post", hint: "Repeat a message every N minutes" },
  { value: "welcome", label: "Welcome new members", hint: "Use {user} in the text. Bot must be a group admin." },
];

function newTask(type: Task["type"] = "command.reply"): Task {
  return {
    id: `task-${Date.now().toString(36)}`,
    enabled: true,
    type,
    params: {},
  };
}

function statusLabel(status?: string): { text: string; tone: string } {
  switch (status) {
    case "running":
      return { text: "Running", tone: "text-emerald-400" };
    case "exited":
    case "stopped":
      return { text: "Stopped", tone: "text-amber-400" };
    case "not_found":
      return { text: "Not found", tone: "text-panel-muted" };
    default:
      return { text: status || "Unknown", tone: "text-panel-muted" };
  }
}

export function TelegramBotManager({
  domain,
  initial,
  initialError,
}: {
  domain: string;
  initial: Payload;
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [payload, setPayload] = useState(initial);
  const [recipes, setRecipes] = useState<TelegramBotRecipes>(initial.recipes);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useDomainNavReset(domain, () => {
    setPayload(initial);
    setRecipes(initial.recipes);
    setError(initialError);
    setSuccess("");
  });

  const container = statusLabel(payload.containerStatus);
  const parent = payload.parentDomain ?? domain;

  function apply(data: Payload) {
    setPayload(data);
    if (data.recipes) setRecipes(data.recipes);
  }

  async function saveTasks() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/telegram-bot`, {
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
      apply(data as Payload);
      setSuccess(
        "Tasks saved. Commands and replies update on the next message; the Telegram menu refreshes within a few seconds.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  function patchTask(i: number, next: Task) {
    const tasks = [...recipes.tasks];
    tasks[i] = next;
    setRecipes({ ...recipes, tasks });
  }

  return (
    <div className="space-y-6">
      <DomainPageHeader
        domain={domain}
        title="Telegram"
        description="No-code tasks for the BotFather bot on this domain — not Discord, and not another customer token."
      />
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {!payload.installed && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-5">
          <p className="font-medium text-white">Telegram Bot not installed yet</p>
          <p className="mt-2 text-sm text-panel-muted">
            Create a bot in BotFather, then install Apps → Telegram Bot on{" "}
            <code className="text-slate-300">{parent}</code>. Each customer uses their own token.
          </p>
          <Link
            href="/admin/apps/telegram-bot/install"
            className="mt-4 inline-flex rounded-lg bg-panel-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Install Telegram Bot
          </Link>
        </Card>
      )}

      {payload.installed && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wide text-panel-muted">Container</p>
            <p className={`mt-2 text-lg font-semibold ${container.tone}`}>{container.text}</p>
            {payload.publicUrl && (
              <a
                href={payload.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-sm text-panel-accent hover:underline"
              >
                Open {payload.subdomain ?? "public page"} →
              </a>
            )}
          </Card>
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wide text-panel-muted">Bot</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {payload.botUsername ? `@${payload.botUsername.replace(/^@/, "")}` : recipes.botName}
            </p>
            {payload.inviteUrl && (
              <a
                href={payload.inviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-sm text-panel-accent hover:underline"
              >
                Add to your group →
              </a>
            )}
          </Card>
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wide text-panel-muted">Commands</p>
            <p className="mt-2 text-sm text-panel-muted">
              {(payload.commands ?? []).map((c) => `/${c.command}`).join(" ") || "/start"}
            </p>
          </Card>
        </div>
      )}

      {payload.installed && (
        <Card className="space-y-2">
          <h2 className="text-lg font-medium text-white">Talk to this bot</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-panel-muted">
            <li>
              Open Telegram, search{" "}
              {payload.botUsername ? (
                <code>@{payload.botUsername.replace(/^@/, "")}</code>
              ) : (
                "the username you gave BotFather"
              )}
              , send <code>/start</code>.
            </li>
            <li>
              Add it to your group
              {payload.inviteUrl ? " with the invite link above" : ""} and grant Send
              messages. In a group type <code>/status@botname</code>.
            </li>
            <li>
              Optional: BotFather → /setprivacy → Disable if you want keyword replies in
              the group (then remove and re-add the bot).
            </li>
          </ol>
        </Card>
      )}

      {payload.installed && (
        <Card className="space-y-4">
          <h2 className="text-lg font-medium text-white">No-code tasks</h2>
          <p className="text-sm text-panel-muted">
            Assign what this Telegram bot does for this domain. Saves go to this install only
            — not Discord, and not other customers. In a group, Telegram privacy mode only
            delivers <code>/command@botname</code> unless you disable privacy in BotFather.
            Keyword replies work in a private chat without that change.
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
              <li key={task.id} className="space-y-2 rounded-md border border-panel-border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    checked={task.enabled}
                    onChange={(e) => patchTask(i, { ...task, enabled: e.target.checked })}
                  />
                  <select
                    className="qadbak-field py-1 text-sm"
                    value={task.type}
                    onChange={(e) =>
                      patchTask(i, {
                        ...task,
                        type: e.target.value as Task["type"],
                        params: {},
                      })
                    }
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
                  task.type === "qadbak.settings" ||
                  task.type === "command.reply") && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label>Command name</Label>
                      <Input
                        value={task.params.name ?? ""}
                        placeholder={
                          task.type === "minecraft.status"
                            ? "minecraft"
                            : task.type === "command.reply"
                              ? "info"
                              : "status"
                        }
                        onChange={(e) =>
                          patchTask(i, {
                            ...task,
                            params: { ...task.params, name: e.target.value },
                          })
                        }
                      />
                    </div>
                    {task.type === "command.reply" && (
                      <div className="sm:col-span-2">
                        <Label>Reply text</Label>
                        <Input
                          value={task.params.text ?? ""}
                          onChange={(e) =>
                            patchTask(i, {
                              ...task,
                              params: { ...task.params, text: e.target.value },
                            })
                          }
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
                        onChange={(e) =>
                          patchTask(i, {
                            ...task,
                            params: { ...task.params, keyword: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label>Reply</Label>
                      <Input
                        value={task.params.text ?? ""}
                        onChange={(e) =>
                          patchTask(i, {
                            ...task,
                            params: { ...task.params, text: e.target.value },
                          })
                        }
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
                      onChange={(e) =>
                        patchTask(i, {
                          ...task,
                          params: { ...task.params, text: e.target.value },
                        })
                      }
                    />
                  </div>
                )}
                {task.type === "scheduled.post" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label>Every N minutes</Label>
                      <Input
                        value={task.params.intervalMinutes ?? "60"}
                        onChange={(e) =>
                          patchTask(i, {
                            ...task,
                            params: { ...task.params, intervalMinutes: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Message</Label>
                      <Input
                        value={task.params.text ?? ""}
                        onChange={(e) =>
                          patchTask(i, {
                            ...task,
                            params: { ...task.params, text: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setRecipes({ ...recipes, tasks: [...recipes.tasks, newTask()] })}
            >
              Add task
            </Button>
            <Button disabled={saving} onClick={() => void saveTasks()}>
              Save tasks
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
