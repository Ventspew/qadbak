"use client";

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
} from "@/components/ui";
import type { AvailableScript, InstalledScript } from "@/lib/provisioner";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";
import { DomainAppsPicker } from "./DomainAppsPicker";

export function ScriptsManager({
  domain,
  initialAvailable,
  initialInstalled,
  isAdmin,
  initialError,
}: {
  domain: string;
  initialAvailable: AvailableScript[];
  initialInstalled: InstalledScript[];
  isAdmin: boolean;
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [available] = useState(initialAvailable);
  const [installed, setInstalled] = useState(initialInstalled);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [installScript, setInstallScript] = useState("");
  const [installPath, setInstallPath] = useState("public_html");
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [postInstall, setPostInstall] = useState<string[]>([]);
  const [lastJournalId, setLastJournalId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");

  useDomainNavReset(domain, () => {
    setInstalled(initialInstalled);
    setError(initialError);
    setSuccess("");
    setDeleteTarget(null);
    setPostInstall([]);
    setConfirmTyped("");
  });

  async function refresh() {
    const res = await fetch(`/api/domains/${enc}/scripts`);
    const data = await res.json();
    if (res.ok) setInstalled(data.installed ?? []);
  }

  async function doInstall(e: React.FormEvent) {
    e.preventDefault();
    if (!installScript) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/scripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: installScript,
          path: installPath,
          forceOverwrite,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Install failed.");
      setPostInstall((data.postInstall as string[]) ?? []);
      setLastJournalId(String(data.journalId ?? ""));
      setSuccess(
        data.adminUrl
          ? `${installScript} installed - ${data.adminUrl}`
          : `${installScript} installed.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function rollback(script: string, rollbackId?: string | null) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/domains/${enc}/scripts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, rollbackId: rollbackId ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Rollback failed");
      setSuccess(`Rolled back ${script}.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/domains/${enc}/scripts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: deleteTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed.");
      setSuccess("Script deleted.");
      setDeleteTarget(null);
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
        title="Apps"
        description="Install from the app store catalog into this domain"
      />
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Card>
        <h2 className="text-lg font-medium text-white">Installed</h2>
        {installed.length === 0 ? (
          <p className="mt-3 text-sm text-panel-muted">No scripts installed.</p>
        ) : (
          <ul className="mt-4 divide-y divide-panel-border">
            {installed.map((s) => (
              <li key={s.name} className="flex justify-between py-3">
                <div>
                  <p className="text-white">{s.name}</p>
                  <p className="text-xs text-panel-muted">
                    {s.version} · {s.path}
                    {s.url && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={s.url}
                          className="text-panel-link hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          open
                        </a>
                      </>
                    )}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    {(s as { rollbackId?: string }).rollbackId && (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          rollback(s.name, (s as { rollbackId?: string }).rollbackId)
                        }
                      >
                        Rollback
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => setDeleteTarget(s.name)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <Card>
          <h2 className="text-lg font-medium text-white">Install from app store</h2>
          <p className="mt-1 text-sm text-panel-muted">
            Quick install on this domain, or use{" "}
            <a href="/admin/apps" className="text-panel-link hover:underline">
              Server admin → App store
            </a>{" "}
            for the full catalog with database credentials and journal in one flow.
          </p>
          <div className="mt-4">
            <DomainAppsPicker
              available={available as Parameters<typeof DomainAppsPicker>[0]["available"]}
              selected={installScript}
              onSelect={setInstallScript}
            />
          </div>
          <form onSubmit={doInstall} className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Script</Label>
              <select
                className="mt-1 w-full rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm"
                value={installScript}
                onChange={(e) => setInstallScript(e.target.value)}
                required
              >
                <option value="">Choose…</option>
                {available.map((s) => (
                  <option key={s.name} value={s.name}>
                    {(s as { label?: string }).label ?? s.name}
                    {s.version ? ` · ${s.version}` : ""}
                    {(s as { requiresDb?: boolean }).requiresDb ? " · needs DB" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Directory</Label>
              <Input
                value={installPath}
                onChange={(e) => setInstallPath(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-panel-muted sm:col-span-2">
              <input
                type="checkbox"
                checked={forceOverwrite}
                onChange={(e) => setForceOverwrite(e.target.checked)}
              />
              Force overwrite existing index.html in target folder
            </label>
            <Button type="submit" disabled={loading}>
              {loading ? "Working…" : "Install"}
            </Button>
          </form>
          {postInstall.length > 0 && (
            <Card className="mt-4 border-panel-accent/30">
              <h3 className="text-sm font-medium text-white">Post-install checklist</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-panel-muted">
                {postInstall.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {lastJournalId && (
                <p className="mt-2 text-xs text-panel-muted">
                  Journal:{" "}
                  <a href={`/admin/journal`} className="text-panel-link hover:underline">
                    {lastJournalId}
                  </a>
                </p>
              )}
            </Card>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete script"
        description={`Delete ${deleteTarget} from ${domain}?`}
        confirmLabel="Delete"
        confirmValue={deleteTarget ?? ""}
        typedValue={confirmTyped}
        onTypedChange={setConfirmTyped}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setConfirmTyped("");
        }}
        loading={loading}
      />
    </div>
  );
}
