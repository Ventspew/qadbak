"use client";

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
} from "@/components/ui";
import type { CronJob } from "@/lib/provisioner";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";

export function CronManager({
  domain,
  initialJobs,
  canEdit,
  initialError,
}: {
  domain: string;
  initialJobs: CronJob[];
  canEdit: boolean;
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [jobs, setJobs] = useState(initialJobs);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [schedule, setSchedule] = useState("0 2 * * *");
  const [command, setCommand] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");

  useDomainNavReset(domain, () => {
    setJobs(initialJobs);
    setError(initialError);
    setSuccess("");
    setDeleteId(null);
    setConfirmTyped("");
  });

  async function refresh() {
    const res = await fetch(`/api/domains/${enc}/cron`);
    const data = await res.json();
    if (res.ok) setJobs(data.jobs ?? []);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/cron`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedule, command }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed.");
      setSuccess("Cron job added.");
      setCommand("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/domains/${enc}/cron`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed.");
      setDeleteId(null);
      setConfirmTyped("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <DomainPageHeader
        domain={domain}
        title="Cron jobs"
        description="Scheduled commands (cron syntax: min hour day month weekday)"
      />
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {!canEdit && (
        <Alert variant="info">View only - only administrators can edit.</Alert>
      )}

      {canEdit && (
        <Card>
          <h2 className="text-lg font-medium text-white">New task</h2>
          <form onSubmit={create} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Schedule (cron)</Label>
              <Input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 2 * * *"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Command</Label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading}>
              Add
            </Button>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-panel-border bg-panel-bg/50 text-panel-muted">
            <tr>
              <th className="px-6 py-3">Schedule</th>
              <th className="px-6 py-3">Command</th>
              {canEdit && <th className="px-6 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-panel-border/50">
                <td className="px-6 py-4 font-mono text-xs text-white">{j.schedule}</td>
                <td className="px-6 py-4 text-panel-muted">{j.command}</td>
                {canEdit && (
                  <td className="px-6 py-4 text-right">
                    <Button variant="danger" onClick={() => setDeleteId(j.id)}>
                      Delete
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {jobs.length === 0 && (
          <p className="px-6 py-8 text-center text-panel-muted">No cron jobs.</p>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete cron job"
        description={`Delete job ${deleteId}?`}
        confirmLabel="Delete"
        confirmValue={deleteId ?? ""}
        typedValue={confirmTyped}
        onTypedChange={setConfirmTyped}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteId(null);
          setConfirmTyped("");
        }}
        loading={loading}
      />
    </div>
  );
}
