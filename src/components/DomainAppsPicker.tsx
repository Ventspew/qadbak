"use client";

import { useMemo, useState } from "react";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/apps/catalog-labels";
import type { AppCategory } from "@/lib/apps/catalog-types";

type CatalogRow = {
  name: string;
  label?: string;
  desc?: string;
  tagline?: string;
  version?: string;
  minPhp?: string;
  requiresDb?: boolean;
  icon?: string;
  category?: string;
};

export function DomainAppsPicker({
  available,
  selected,
  onSelect,
}: {
  available: CatalogRow[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available.filter((app) => {
      if (category !== "all" && app.category !== category) return false;
      if (!q) return true;
      const label = (app.label ?? app.name).toLowerCase();
      return (
        label.includes(q) ||
        (app.desc ?? "").toLowerCase().includes(q) ||
        (app.tagline ?? "").toLowerCase().includes(q)
      );
    });
  }, [available, query, category]);

  if (available.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          placeholder="Search catalog…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-[40px] flex-1 rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-white"
        />
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as AppCategory | "all")
          }
          className="rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-white"
        >
          <option value="all">All categories</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-panel-muted">
        {filtered.length} of {available.length} apps · pick one, set path below, then Install
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((app) => {
          const active = selected === app.name;
          const cat = app.category as AppCategory | undefined;
          return (
            <button
              key={app.name}
              type="button"
              onClick={() => onSelect(app.name)}
              className={`min-h-[140px] rounded-xl border p-4 text-left transition ${
                active
                  ? "border-panel-accent bg-panel-accent/10 ring-1 ring-panel-accent/40"
                  : "border-panel-border hover:border-panel-accent/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-3xl leading-none">{app.icon ?? "📦"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white">
                    {app.label ?? app.name}
                  </p>
                  {app.tagline ? (
                    <p className="mt-1 text-xs text-panel-muted">{app.tagline}</p>
                  ) : (
                    <p className="mt-1 line-clamp-2 text-xs text-panel-muted">
                      {app.desc}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1 text-xs text-panel-muted">
                    {cat && CATEGORY_LABELS[cat] ? (
                      <span className="rounded bg-black/30 px-1.5 py-0.5">
                        {CATEGORY_LABELS[cat]}
                      </span>
                    ) : null}
                    {app.version ? (
                      <span>v{app.version}</span>
                    ) : null}
                    {app.minPhp ? <span>PHP {app.minPhp}+</span> : null}
                    <span>{app.requiresDb ? "MySQL" : "No DB"}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <p className="text-sm text-panel-muted">No apps match your filters.</p>
      )}
    </div>
  );
}
