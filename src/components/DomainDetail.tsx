"use client";

import { ClientOnboardingWizard } from "@/components/ClientOnboardingWizard";
import { DomainPanelClientCard } from "@/components/DomainPanelClientCard";
import { DomainQuickLinks } from "@/components/DomainQuickLinks";
import { formatDomainDisk } from "@/lib/format-quota";
import { WebsiteHealthCard } from "@/components/WebsiteHealthCard";
import { Badge, Button, Card } from "@/components/ui";
import type { HostedDomain } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DomainDetail({
  domain,
  disabled,
  isAdmin,
  premiumPanelClient = false,
}: {
  domain: HostedDomain;
  disabled: boolean;
  isAdmin: boolean;
  premiumPanelClient?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enc = encodeURIComponent(domain.name);

  async function toggle(enable: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/domains/${enc}/${enable ? "enable" : "disable"}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-panel-muted">
            <Link href="/domains" className="hover:text-white">
              ← Domains
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{domain.name}</h1>
          <div className="mt-2">
            <Badge tone={disabled ? "warning" : "success"}>
              {disabled ? "Disabled" : "Active"}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => toggle(disabled)}
            >
              {busy ? "Working…" : disabled ? "Enable" : "Disable"}
            </Button>
          )}
          <Button onClick={() => router.push(`/domains/${enc}/files`)}>
            Files
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <WebsiteHealthCard domain={domain.name} isAdmin={isAdmin} />

      {!isAdmin && <ClientOnboardingWizard domain={domain.name} isAdmin={isAdmin} />}

      {isAdmin && premiumPanelClient && (
        <DomainPanelClientCard domain={domain.name} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-panel-muted">Owner</h2>
          <p className="mt-1 text-white">{domain.user ?? " - "}</p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium text-panel-muted">Plan</h2>
          <p className="mt-1 text-white">{domain.plan ?? " - "}</p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium text-panel-muted">Disk usage (MB)</h2>
          <p className="mt-1 font-mono text-white tabular-nums">
            {formatDomainDisk(domain.disk_used, domain.disk_limit)} MB
          </p>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-medium text-white">Quick links</h2>
        <p className="mt-1 text-sm text-panel-muted">
          {domain.type === "alias"
            ? "Files, PHP, and website settings — mail and DNS live on the parent domain."
            : "Email, DNS, SSL, backups, and more - all in Qadbak."}
        </p>
        <div className="mt-4">
          <DomainQuickLinks
            domain={domain.name}
            isAdmin={isAdmin}
            type={domain.type}
          />
        </div>
      </div>
    </div>
  );
}
