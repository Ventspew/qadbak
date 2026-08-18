"use client";

import { Badge, Button, Card } from "@/components/ui";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ActionItem = {
  label: string;
  href: string;
  severity: "warning" | "error" | "info";
};

type DomainOverview = {
  domain: string;
  disabled: boolean;
  sslDaysLeft: number | null;
  backupAgeDays: number | null;
  diskUsedMb: number;
  diskLimitMb: number | null;
  websiteOk: boolean | null;
  dnsPending?: boolean;
  localWebsiteOk?: boolean;
  mailOk: boolean;
  type?: string;
  actions: ActionItem[];
};

export function DashboardDomainOverview() {
  const [domains, setDomains] = useState<DomainOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/domains/health-overview");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load overview.");
      setDomains(data.domains ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const actions = domains.flatMap((d) =>
    d.actions.map((a) => ({ ...a, domain: d.domain })),
  );
  const urgent = actions.filter((a) => a.severity === "error");
  const warnings = actions.filter((a) => a.severity === "warning");
  const info = actions.filter((a) => a.severity === "info");

  return (
    <div className="space-y-6">
      {(urgent.length > 0 || warnings.length > 0 || info.length > 0) && (
        <Card>
          <h2 className="text-lg font-medium text-white">Action needed</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {[...urgent, ...warnings, ...info].slice(0, 8).map((a) => (
              <li key={`${a.domain}-${a.label}`} className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    a.severity === "error"
                      ? "danger"
                      : a.severity === "warning"
                        ? "warning"
                        : "default"
                  }
                >
                  {a.domain}
                </Badge>
                <Link href={a.href} className="text-panel-link hover:underline">
                  {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-white">Domain overview</h2>
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {loading ? (
          <p className="mt-4 text-sm text-panel-muted">Loading health data…</p>
        ) : domains.length === 0 ? (
          <p className="mt-4 text-sm text-panel-muted">No domains.</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {domains.map((d) => {
              const enc = encodeURIComponent(d.domain);
              const sslTone =
                d.sslDaysLeft === null
                  ? "default"
                  : d.sslDaysLeft <= 7
                    ? "danger"
                    : d.sslDaysLeft <= 14
                      ? "warning"
                      : "success";
              const backupTone =
                d.backupAgeDays === null
                  ? "warning"
                  : d.backupAgeDays > 14
                    ? "danger"
                    : d.backupAgeDays > 7
                      ? "warning"
                      : "success";
              const websiteTone = d.disabled
                ? "warning"
                : d.dnsPending
                  ? "default"
                  : d.websiteOk === false
                    ? "danger"
                    : d.websiteOk === true
                      ? "success"
                      : "default";
              const websiteLabel = d.disabled
                ? "Off"
                : d.dnsPending
                  ? "DNS pending"
                  : d.websiteOk === false
                    ? "Down"
                    : d.websiteOk === true
                      ? "OK"
                      : " - ";
              return (
                <div
                  key={d.domain}
                  className="rounded-lg border border-panel-border/80 bg-panel-card/40 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/domains/${enc}`}
                      className="font-medium text-white hover:text-panel-link"
                    >
                      {d.domain}
                    </Link>
                    <Badge tone={d.disabled ? "warning" : "success"}>
                      {d.disabled ? "Off" : "Active"}
                    </Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-panel-muted">
                    <div>
                      <dt>Website</dt>
                      <dd>
                        <Badge tone={websiteTone as "success" | "warning" | "danger" | "default"}>
                          {websiteLabel}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>SSL</dt>
                      <dd>
                        <Badge tone={sslTone as "success" | "warning" | "danger" | "default"}>
                          {d.sslDaysLeft === null ? " - " : `${d.sslDaysLeft}d`}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>Backup</dt>
                      <dd>
                        <Badge tone={backupTone as "success" | "warning" | "danger"}>
                          {d.backupAgeDays === null ? "none" : `${d.backupAgeDays}d`}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>Disk</dt>
                      <dd className="text-white">
                        {d.diskUsedMb}
                        {d.diskLimitMb ? ` / ${d.diskLimitMb} MB` : " MB"}
                      </dd>
                    </div>
                    <div>
                      <dt>Mail</dt>
                      <dd className={d.mailOk ? "text-emerald-400" : "text-panel-muted"}>
                        {d.mailOk ? "Configured" : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {d.type !== "alias" && (
                      <>
                        <Link href={`/domains/${enc}/dns`} className="text-panel-link hover:underline">
                          DNS
                        </Link>
                        <Link href={`/domains/${enc}/mail`} className="text-panel-link hover:underline">
                          Mail
                        </Link>
                      </>
                    )}
                    <Link href={`/domains/${enc}/tools`} className="text-panel-link hover:underline">
                      Site tools
                    </Link>
                    {d.type !== "alias" && (
                      <Link href={`/domains/${enc}/backups`} className="text-panel-link hover:underline">
                        Backup
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
