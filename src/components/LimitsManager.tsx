"use client";

import { Alert, Button, Card, Input, Label } from "@/components/ui";
import type { DomainLimits } from "@/lib/provisioner";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";

export function LimitsManager({
  domain,
  initialLimits,
  initialError,
}: {
  domain: string;
  initialLimits: DomainLimits;
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [limits, setLimits] = useState(initialLimits);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useDomainNavReset(domain, () => {
    setLimits(initialLimits);
    setError(initialError);
    setSuccess("");
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/limits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limits),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setSuccess(
        "Limits saved. Disk quota is applied to the unix user; mailbox/DB caps apply on create.",
      );
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
        title="Limits"
        description="Mailbox and database counts are enforced on create. Disk is applied as an OS user quota on /home. Bandwidth is display-only."
      />
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}
      <Card>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Disk (MB)</Label>
            <Input
              value={limits.disk ?? ""}
              onChange={(e) => setLimits({ ...limits, disk: e.target.value })}
            />
            <p className="mt-1 text-xs text-panel-muted">
              Applied as an OS quota on the unix user (setquota). Empty = unlimited.
            </p>
          </div>
          <div>
            <Label>Bandwidth (MB)</Label>
            <Input
              value={limits.bandwidth ?? ""}
              onChange={(e) =>
                setLimits({ ...limits, bandwidth: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-panel-muted">Display-only — not metered.</p>
          </div>
          <div>
            <Label>Mailboxes</Label>
            <Input
              value={limits.mailboxes ?? ""}
              onChange={(e) =>
                setLimits({ ...limits, mailboxes: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Databases</Label>
            <Input
              value={limits.databases ?? ""}
              onChange={(e) =>
                setLimits({ ...limits, databases: e.target.value })
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={loading}>
              {loading ? "Working…" : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
