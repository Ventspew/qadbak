import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppCatalogEntry, AppCategory } from "./catalog-types";

export type { AppCatalogEntry, AppCategory } from "./catalog-types";

const FALLBACK_ICONS: Record<string, string> = {
  wordpress: "🦋",
  joomla: "📰",
  drupal: "💧",
  phpmyadmin: "🗄️",
  nextcloud: "☁️",
  matomo: "📊",
  prestashop: "🛒",
  ghost: "👻",
  mediawiki: "📚",
  moodle: "🎓",
  phpbb: "💬",
  opencart: "🏪",
  kanboard: "📋",
  limesurvey: "📝",
  grav: "🪨",
  adminer: "🔧",
  roundcube: "✉️",
  dokuwiki: "📖",
  piwigo: "🖼️",
  mybb: "🗨️",
  bookstack: "📕",
  firefly: "💰",
  osticket: "🎫",
  processwire: "⚙️",
  jellyfin: "🎬",
};

function normalizeRow(row: Record<string, unknown>): AppCatalogEntry {
  const id = String(row.id ?? row.name ?? "").trim().toLowerCase();
  const name = String(row.name ?? id).trim().toLowerCase();
  return {
    id,
    name,
    label: String(row.label ?? name),
    desc: String(row.desc ?? ""),
    version: String(row.version ?? "native"),
    minPhp: row.minPhp ? String(row.minPhp) : undefined,
    requiresDb: Boolean(row.requiresDb),
    category: (row.category as AppCategory) ?? "cms",
    icon: String(row.icon ?? FALLBACK_ICONS[id] ?? "📦"),
    tagline: String(row.tagline ?? row.desc ?? ""),
    featured: Boolean(row.featured),
    comingSoon: Boolean(row.comingSoon),
    intentMode:
      row.intentMode === "domain-only" ? "domain-only" : "full",
    installer: row.installer ? String(row.installer) : undefined,
    etaSeconds:
      typeof row.etaSeconds === "number" ? row.etaSeconds : undefined,
  };
}

export async function loadAppCatalog(): Promise<AppCatalogEntry[]> {
  const catalogPath = path.join(process.cwd(), "data", "app-catalog.json");
  try {
    const raw = await readFile(catalogPath, "utf8");
    const arr = JSON.parse(raw) as Record<string, unknown>[];
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeRow);
  } catch {
    return [];
  }
}

export function catalogEntriesWithIntent(
  entries: AppCatalogEntry[],
): AppCatalogEntry[] {
  return entries.filter(
    (e) => !e.comingSoon && e.intentMode !== "domain-only" && e.id !== "wordpress" && e.id !== "jellyfin",
  );
}
