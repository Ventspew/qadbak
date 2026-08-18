"use client";

import { Alert, Badge, Button, Card } from "@/components/ui";
import type { GlobalFeature } from "@/lib/provisioner";
import { useState } from "react";

export function AdminSystemView({
  initialFeatures,
  initialBundles,
  initialError,
}: {
  initialFeatures: GlobalFeature[];
  initialBundles: string[];
  initialError: string;
}) {
  const [features, setFeatures] = useState(initialFeatures);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [bundle, setBundle] = useState(initialBundles[0] ?? "");

  async function toggleFeature(feature: string, enabled: boolean) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feature", feature, enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed.");
      setFeatures(data.features ?? []);
      setSuccess("Label updated. Services were not started or stopped.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function runConfig() {
    if (!bundle) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "config-system", bundle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed.");
      setSuccess(`Service status for bundle ${bundle} (no stack was installed).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Card>
        <h2 className="text-lg font-medium text-white">Server features</h2>
        <p className="mt-1 text-sm text-panel-muted">
          Panel labels only. Turning a feature off here does not stop nginx,
          mail, or DNS.
        </p>
        <ul className="mt-4 divide-y divide-panel-border">
          {features.map((f) => (
            <li key={f.feature} className="flex items-center justify-between py-3">
              <div>
                <p className="text-white">{f.label ?? f.feature}</p>
                <p className="text-sm text-panel-muted">{f.feature}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={f.enabled === "1" ? "success" : "warning"}>
                  {f.enabled === "1" ? "On" : "Off"}
                </Badge>
                <Button
                  variant="secondary"
                  disabled={loading}
                  onClick={() =>
                    toggleFeature(f.feature, f.enabled !== "1")
                  }
                >
                  {f.enabled === "1" ? "Turn off" : "Turn on"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {features.length === 0 && (
          <p className="mt-4 text-sm text-panel-muted">No features loaded.</p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-medium text-white">Systeemconfiguratie</h2>
        <p className="mt-2 text-sm text-panel-muted">
          Reports whether nginx, mail, and PHP-FPM are active, then reloads
          nginx if the config test passes. It does not install a stack.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-white"
            value={bundle}
            onChange={(e) => setBundle(e.target.value)}
          >
            {initialBundles.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <Button variant="danger" onClick={runConfig} disabled={loading || !bundle}>
            Run bundle
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-medium text-white">Networking</h2>
        <p className="mt-2 text-sm text-panel-muted">
          Interface addresses and the public IP for customer DNS records live on a
          dedicated native page - no server-admin embed.
        </p>
        <a
          href="/admin/networking"
          className="mt-4 inline-block text-sm text-panel-link hover:underline"
        >
          Open networking →
        </a>
      </Card>
    </div>
  );
}
