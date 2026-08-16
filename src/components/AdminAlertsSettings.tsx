"use client";

import { Alert, Button, Card, Input, Label } from "@/components/ui";
import type { AlertRule, AlertSettings } from "@/lib/alert-rules";
import { RECOMMENDED_ALERT_RULES } from "@/lib/alert-rules-presets";
import { useEffect, useState } from "react";

export function AdminAlertsSettings() {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [fired, setFired] = useState<string[]>([]);
  const [notified, setNotified] = useState<string[]>([]);
  const [bootLoading, setBootLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/admin/alerts");
    const data = await res.json();
    if (res.ok) {
      setSettings(data.settings ?? null);
      setError("");
    } else {
      setSettings(null);
      setError(String(data.error ?? "Could not load alert settings."));
    }
  }

  useEffect(() => {
    load()
      .catch(() => {
        setSettings(null);
        setError("Could not load alert settings.");
      })
      .finally(() => setBootLoading(false));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError("");
    setSuccess("");
    setFired([]);
    try {
      const res = await fetch("/api/admin/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setSuccess("Alert settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function evaluate() {
    setEvaluating(true);
    setFired([]);
    setNotified([]);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "evaluate" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Evaluate failed");
      setFired(data.fired ?? []);
      setNotified(data.notified ?? []);
      if ((data.fired as string[] | undefined)?.length === 0) {
        setSuccess("No thresholds exceeded.");
      } else if ((data.notified as string[] | undefined)?.length === 0) {
        setSuccess("Thresholds exceeded but no notifications were delivered (check targets).");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluate failed");
    } finally {
      setEvaluating(false);
    }
  }

  if (bootLoading) {
    return (
      <Card>
        <p className="text-sm text-panel-muted">Loading alert rules…</p>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card className="space-y-3">
        <h2 className="text-lg font-medium text-white">Alert rules</h2>
        <Alert>{error || "Could not load alert settings."}</Alert>
        <Button variant="secondary" onClick={() => void load()}>
          Retry
        </Button>
      </Card>
    );
  }

  const busy = saving || evaluating;

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-medium text-white">Alert rules</h2>
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Email to</Label>
          <Input
            value={settings.emailTo ?? ""}
            onChange={(e) => setSettings({ ...settings, emailTo: e.target.value })}
          />
        </div>
        <div>
          <Label>Slack webhook</Label>
          <Input
            value={settings.slackWebhook ?? ""}
            onChange={(e) => setSettings({ ...settings, slackWebhook: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Telegram webhook</Label>
          <Input
            value={settings.telegramWebhook ?? ""}
            onChange={(e) =>
              setSettings({ ...settings, telegramWebhook: e.target.value })
            }
          />
        </div>
      </div>
      <ul className="text-sm text-panel-muted space-y-2">
        {settings.rules.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3">
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={(e) => {
                const rules = [...settings.rules];
                rules[i] = { ...r, enabled: e.target.checked };
                setSettings({ ...settings, rules });
              }}
            />
            <span>
              {r.id}: {r.metric} ≥ {r.threshold} →
            </span>
            <select
              className="qadbak-field py-1 text-sm"
              value={r.channel}
              onChange={(e) => {
                const rules = [...settings.rules];
                rules[i] = { ...r, channel: e.target.value as AlertRule["channel"] };
                setSettings({ ...settings, rules });
              }}
            >
              <option value="email">email</option>
              <option value="slack">slack</option>
              <option value="telegram">telegram</option>
              <option value="discord">discord</option>
            </select>
          </li>
        ))}
      </ul>
      {fired.length > 0 && (
        <Alert>
          Triggered: {fired.join("; ")}
          {notified.length > 0 && notified.length < fired.length
            ? ` (notified: ${notified.length}/${fired.length})`
            : ""}
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            setSettings((s) =>
              s
                ? {
                    ...s,
                    rules: RECOMMENDED_ALERT_RULES.map((r) => ({
                      ...r,
                      target:
                        r.channel === "email"
                          ? s.emailTo ?? ""
                          : r.channel === "slack"
                            ? s.slackWebhook ?? ""
                            : r.channel === "telegram"
                              ? s.telegramWebhook ?? ""
                              : "",
                    })),
                  }
                : s,
            )
          }
        >
          Load recommended rules
        </Button>
        <Button disabled={busy} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={evaluate}>
          {evaluating ? "Evaluating…" : "Test evaluate"}
        </Button>
      </div>
      <p className="text-xs text-panel-muted">
        backup_age thresholds are in <strong className="text-white">days</strong> (e.g. 2 = 48
        hours). Plan cron: <code className="text-white">metrics-snapshot</code> + evaluate.
        Discord channel DMs every linked user (panel + Minecraft + bot).
      </p>
    </Card>
  );
}
