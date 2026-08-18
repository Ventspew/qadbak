"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/apps/catalog-labels";
import type { AppCatalogEntry, AppCategory } from "@/lib/apps/catalog-types";
import type { AppTemplateSummary } from "@/lib/apps/types";

export function AdminAppsCatalog({
  templates,
  catalog,
}: {
  templates: AppTemplateSummary[];
  catalog: AppCatalogEntry[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "all">("all");

  const intentIds = new Set(templates.map((t) => t.id));
  const installable = catalog.filter((a) => !a.comingSoon && intentIds.has(a.id));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((app) => {
      if (category !== "all" && app.category !== category) return false;
      if (!q) return true;
      return (
        app.label.toLowerCase().includes(q) ||
        app.desc.toLowerCase().includes(q) ||
        app.tagline.toLowerCase().includes(q) ||
        app.category.toLowerCase().includes(q)
      );
    });
  }, [catalog, query, category]);

  const featured = filtered.filter((a) => a.featured && !a.comingSoon);
  const restByCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: filtered.filter(
      (a) => a.category === cat && !a.featured && !a.comingSoon,
    ),
  })).filter((g) => g.items.length > 0);
  const coming = filtered.filter((a) => a.comingSoon);

  return (
    <div className="space-y-10">
      <div className="rounded-xl border border-panel-border bg-gradient-to-br from-panel-accent/10 via-panel-bg to-panel-bg p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-panel-accent">
              App store
            </p>
            <p className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
              {installable.length} installable apps
            </p>
            <p className="mt-2 max-w-2xl text-sm text-panel-muted">
              One-click flow: MySQL (when needed), files on the domain home, credentials
              on screen, and a journaled install you can roll back from Domains → Apps.
            </p>
          </div>
          <dl className="flex flex-wrap gap-6 text-sm">
            <div>
              <dt className="text-panel-muted">Categories</dt>
              <dd className="text-xl font-semibold text-white">
                {CATEGORY_ORDER.filter((c) =>
                  catalog.some((a) => a.category === c),
                ).length}
              </dd>
            </div>
            <div>
              <dt className="text-panel-muted">Featured</dt>
              <dd className="text-xl font-semibold text-white">
                {catalog.filter((a) => a.featured).length}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <input
          type="search"
          placeholder="Search apps (WordPress, Moodle, shop, wiki…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-[44px] flex-1 rounded-lg border border-panel-border bg-panel-bg px-4 py-2.5 text-sm text-white placeholder:text-panel-muted/70"
        />
        <div className="flex flex-wrap gap-2">
          <CategoryPill
            active={category === "all"}
            onClick={() => setCategory("all")}
            label="All"
          />
          {CATEGORY_ORDER.map((c) => {
            const count = catalog.filter((a) => a.category === c).length;
            if (count === 0) return null;
            return (
              <CategoryPill
                key={c}
                active={category === c}
                onClick={() => setCategory(c)}
                label={CATEGORY_LABELS[c]}
              />
            );
          })}
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-sm text-panel-muted py-12">
          No apps match your search.
        </p>
      )}

      {category === "all" && featured.length > 0 && (
        <StoreSection title="Featured picks">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {featured.map((app) => (
              <AppStoreCard
                key={app.id}
                app={app}
                hasIntent={intentIds.has(app.id)}
              />
            ))}
          </div>
        </StoreSection>
      )}

      {category === "all" ? (
        restByCategory.map(({ cat, items }) => (
          <StoreSection key={cat} title={CATEGORY_LABELS[cat]}>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {items.map((app) => (
                <AppStoreCard
                  key={app.id}
                  app={app}
                  hasIntent={intentIds.has(app.id)}
                />
              ))}
            </div>
          </StoreSection>
        ))
      ) : (
        filtered.filter((a) => !a.comingSoon).length > 0 && (
          <StoreSection title={CATEGORY_LABELS[category]}>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filtered
                .filter((a) => !a.comingSoon)
                .map((app) => (
                  <AppStoreCard
                    key={app.id}
                    app={app}
                    hasIntent={intentIds.has(app.id)}
                  />
                ))}
            </div>
          </StoreSection>
        )
      )}

      {coming.length > 0 && (
        <StoreSection title="Coming soon">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {coming.map((app) => (
              <AppStoreCard key={app.id} app={app} hasIntent={false} />
            ))}
          </div>
        </StoreSection>
      )}

      <p className="border-t border-panel-border pt-6 text-sm text-panel-muted">
        Custom install path, rollback, and reinstall:{" "}
        <strong className="text-white">Domains → [domain] → Apps</strong>.
      </p>
    </div>
  );
}

function CategoryPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-panel-accent text-panel-bg"
          : "border border-panel-border text-panel-muted hover:border-panel-accent/50 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function StoreSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AppStoreCard({
  app,
  hasIntent,
}: {
  app: AppCatalogEntry;
  hasIntent: boolean;
}) {
  const badges = [
    app.version && app.version !== "native" ? `v${app.version}` : null,
    app.minPhp ? `PHP ${app.minPhp}+` : null,
    app.requiresDb ? "MySQL" : "No DB",
    CATEGORY_LABELS[app.category],
  ].filter(Boolean);

  const body = (
    <article
      className={`flex h-full min-h-[220px] flex-col rounded-xl border bg-panel-bg p-5 transition ${
        app.comingSoon
          ? "border-panel-border opacity-55"
          : hasIntent
            ? "border-panel-border hover:border-panel-accent hover:shadow-lg hover:shadow-panel-accent/5"
            : "border-panel-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-4xl leading-none" aria-hidden>
          {app.icon}
        </span>
        {app.comingSoon ? (
          <span className="shrink-0 rounded-full bg-panel-border px-2.5 py-1 text-xs text-panel-muted">
            Soon
          </span>
        ) : hasIntent ? (
          <span className="shrink-0 rounded-full bg-panel-accent/25 px-2.5 py-1 text-xs font-medium text-panel-accent">
            Install
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-panel-border px-2.5 py-1 text-xs text-panel-muted">
            Domain Apps
          </span>
        )}
      </div>
      <h3 className="mt-4 text-xl font-semibold text-white">{app.label}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-panel-muted">
        {app.tagline}
      </p>
      <p className="mt-2 line-clamp-2 text-xs text-panel-muted/80">{app.desc}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <span
            key={b}
            className="rounded-md bg-black/35 px-2 py-0.5 text-xs text-panel-muted"
          >
            {b}
          </span>
        ))}
      </div>
      {app.etaSeconds && hasIntent ? (
        <p className="mt-4 text-xs uppercase tracking-wide text-panel-muted/70">
          ~{Math.max(1, Math.ceil(app.etaSeconds / 60))} min install
        </p>
      ) : null}
    </article>
  );

  if (app.comingSoon) {
    return body;
  }

  if (!hasIntent) {
    return (
      <Link
        href="/domains"
        className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent rounded-xl"
      >
        {body}
      </Link>
    );
  }

  return (
    <Link
      href={`/admin/apps/${encodeURIComponent(app.id)}/install`}
      className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent rounded-xl"
    >
      {body}
    </Link>
  );
}
