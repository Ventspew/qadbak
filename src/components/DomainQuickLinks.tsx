"use client";

import { Card } from "@/components/ui";
import { featuresForDomain } from "@/lib/features";
import Link from "next/link";

const HIGHLIGHT_IDS = new Set([
  "files",
  "mail",
  "dns",
  "ssl",
  "databases",
  "backups",
]);

export function DomainQuickLinks({
  domain,
  isAdmin,
  type,
}: {
  domain: string;
  isAdmin: boolean;
  type?: string;
}) {
  const enc = encodeURIComponent(domain);
  const base = `/domains/${enc}`;
  const role = isAdmin ? "admin" : "client";
  const features = featuresForDomain(role, isAdmin, { type });
  const highlighted = features.filter((f) => HIGHLIGHT_IDS.has(f.id));
  const rest = features.filter((f) => !HIGHLIGHT_IDS.has(f.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {highlighted.map((f) => (
          <Link key={f.id} href={`${base}/${f.path}`}>
            <Card className="h-full transition hover:border-panel-accent">
              <h3 className="font-medium text-white">{f.label}</h3>
              <p className="mt-1 text-sm text-panel-muted">{f.description}</p>
            </Card>
          </Link>
        ))}
      </div>
      {rest.length > 0 && (
        <Card>
          <h2 className="text-sm font-medium text-panel-muted">Other components</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {rest.map((f) => (
              <li key={f.id}>
                <Link
                  href={`${base}/${f.path}`}
                  className="rounded-lg border border-panel-border px-3 py-1.5 text-sm text-panel-muted hover:border-panel-accent hover:text-white"
                >
                  {f.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
