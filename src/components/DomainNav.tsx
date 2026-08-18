"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { featuresForDomain } from "@/lib/features";

export function DomainNav({
  domain,
  isAdmin,
  type,
}: {
  domain: string;
  isAdmin: boolean;
  type?: string;
}) {
  const pathname = usePathname();
  const enc = encodeURIComponent(domain);
  const base = `/domains/${enc}`;
  const role = isAdmin ? "admin" : "client";
  const features = featuresForDomain(role, isAdmin, { type });

  return (
    <nav className="flex flex-wrap gap-2 border-b border-panel-border pb-4">
      <Link
        href={base}
        className={`rounded-lg px-3 py-2 text-sm ${
          pathname === base
            ? "bg-panel-accent/20 text-white"
            : "text-panel-muted hover:bg-panel-card hover:text-white"
        }`}
      >
        Overview
      </Link>
      {features.map((f) => {
        const href = `${base}/${f.path}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={f.id}
            href={href}
            className={`rounded-lg px-3 py-2 text-sm ${
              active
                ? "bg-panel-accent/20 text-white"
                : "text-panel-muted hover:bg-panel-card hover:text-white"
            }`}
            title={f.description}
          >
            {f.label}
          </Link>
        );
      })}
    </nav>
  );
}
