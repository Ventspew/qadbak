"use client";

import { Alert, Badge, Button, Card } from "@/components/ui";
import type { SslCert } from "@/lib/provisioner";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";

export function SslManager({
  domain,
  initialCerts,
  initialError,
}: {
  domain: string;
  initialCerts: SslCert[];
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [certs, setCerts] = useState(initialCerts);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useDomainNavReset(domain, () => {
    setCerts(initialCerts);
    setError(initialError);
    setSuccess("");
    setLoading(false);
  });

  async function requestLe() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/ssl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed.");
      setSuccess("HTTPS certificate issued and nginx updated.");
      const listRes = await fetch(`/api/domains/${enc}/ssl`);
      const listData = await listRes.json();
      if (listRes.ok) setCerts(listData.certs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <DomainPageHeader domain={domain} title="SSL certificates" />
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <div className="flex justify-end">
        <Button onClick={requestLe} disabled={loading}>
          {loading ? "Working…" : "Issue HTTPS certificate & configure nginx"}
        </Button>
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-panel-border bg-panel-bg/50 text-panel-muted">
            <tr>
              <th className="px-6 py-3">Host</th>
              <th className="px-6 py-3">Issuer</th>
              <th className="px-6 py-3">Expires</th>
              <th className="px-6 py-3">Type</th>
            </tr>
          </thead>
          <tbody>
            {certs.map((c, i) => (
              <tr key={i} className="border-b border-panel-border/50">
                <td className="px-6 py-4 text-white">{c.host ?? domain}</td>
                <td className="px-6 py-4">{c.issuer ?? " - "}</td>
                <td className="px-6 py-4">
                  <Badge tone="success">{c.expiry ?? " - "}</Badge>
                </td>
                <td className="px-6 py-4 text-panel-muted">{c.type ?? " - "}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {certs.length === 0 && (
          <p className="px-6 py-8 text-center text-panel-muted">No certificates found.</p>
        )}
      </Card>
    </div>
  );
}
