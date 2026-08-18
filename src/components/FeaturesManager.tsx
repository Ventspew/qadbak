"use client";

import { Alert, Button, Card } from "@/components/ui";
import type { DomainFeatureFlag } from "@/lib/provisioner";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";

export function FeaturesManager({
  domain,
  initialFeatures,
  initialError,
}: {
  domain: string;
  initialFeatures: DomainFeatureFlag[];
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [features, setFeatures] = useState(initialFeatures);
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState<string | null>(null);

  useDomainNavReset(domain, () => {
    setFeatures(initialFeatures);
    setError(initialError);
    setLoading(null);
  });

  async function toggle(feature: string, enabled: boolean) {
    setLoading(feature);
    setError("");
    try {
      const res = await fetch(`/api/domains/${enc}/features`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, enabled: !enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed.");
      setFeatures((prev) =>
        prev.map((f) =>
          f.feature === feature ? { ...f, enabled: !enabled } : f,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <DomainPageHeader
        domain={domain}
        title="Features"
        description="Panel labels for this domain. Turning a feature off here does not stop mail, DNS, or nginx — use Disable on the domain or the matching manager page."
      />
      {error && <Alert>{error}</Alert>}
      <Card className="divide-y divide-panel-border p-0">
        {features.map((f) => (
          <div
            key={f.feature}
            className="flex items-center justify-between px-6 py-4"
          >
            <div>
              <p className="font-medium text-white">{f.label ?? f.feature}</p>
              <p className="text-xs text-panel-muted">{f.feature}</p>
            </div>
            <Button
              variant={f.enabled ? "secondary" : "primary"}
              disabled={loading === f.feature}
              onClick={() => toggle(f.feature, f.enabled)}
            >
              {loading === f.feature
                ? "Working…"
                : f.enabled
                  ? "Disable"
                  : "Enable"}
            </Button>
          </div>
        ))}
        {features.length === 0 && (
          <p className="px-6 py-8 text-center text-panel-muted">
            No features found.
          </p>
        )}
      </Card>
    </div>
  );
}
