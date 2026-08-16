import {
  catalogEntriesWithIntent,
  loadAppCatalog,
  type AppCatalogEntry,
} from "./catalog";
import type { AppTemplate, AppTemplateSummary } from "./types";
import { createCatalogTemplate } from "./templates/from-catalog";
import { jellyfinTemplate } from "./templates/jellyfin";
import { minecraftTemplate } from "./templates/minecraft";
import { pogoStackTemplate } from "./templates/pogo-stack";
import { wordpressTemplate } from "./templates/wordpress";

let cache: {
  templates: AppTemplate[];
  catalog: AppCatalogEntry[];
  at: number;
} | null = null;

const CACHE_MS = 30_000;

async function loadRegistry(): Promise<{
  templates: AppTemplate[];
  catalog: AppCatalogEntry[];
}> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return { templates: cache.templates, catalog: cache.catalog };
  }
  const catalog = await loadAppCatalog();
  const fromCatalog = catalogEntriesWithIntent(catalog).map(createCatalogTemplate);
  const templates = [wordpressTemplate, jellyfinTemplate, minecraftTemplate, pogoStackTemplate, ...fromCatalog];
  cache = { templates, catalog, at: now };
  return { templates, catalog };
}

export async function listTemplates(): Promise<AppTemplateSummary[]> {
  const { templates, catalog } = await loadRegistry();
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return templates.map((t) => {
    const c = byId.get(t.id);
    return {
      ...toSummary(t),
      category: c?.category,
      minPhp: c?.minPhp,
      requiresDb: c?.requiresDb,
      featured: c?.featured,
    };
  });
}

export async function getTemplate(id: string): Promise<AppTemplate | undefined> {
  const { templates } = await loadRegistry();
  return templates.find((t) => t.id === id);
}

export async function listCatalog(): Promise<AppCatalogEntry[]> {
  const { catalog } = await loadRegistry();
  return catalog;
}

/** Sync helpers for rare cases — prefer async in server components. */
export function listTemplatesSync(): AppTemplateSummary[] {
  if (!cache)
    return [
      toSummary(wordpressTemplate),
      toSummary(jellyfinTemplate),
      toSummary(minecraftTemplate),
      toSummary(pogoStackTemplate),
    ];
  return cache.templates.map(toSummary);
}

export function getTemplateSync(id: string): AppTemplate | undefined {
  if (!cache)
    return id === "wordpress"
      ? wordpressTemplate
      : id === "jellyfin"
        ? jellyfinTemplate
        : id === "minecraft"
          ? minecraftTemplate
          : id === "pogo-stack"
            ? pogoStackTemplate
            : undefined;
  return cache.templates.find((t) => t.id === id);
}

function toSummary(t: AppTemplate): AppTemplateSummary {
  return {
    id: t.id,
    label: t.label,
    tagline: t.tagline,
    icon: t.icon,
    description: t.description,
    etaSeconds: t.etaSeconds,
    inputs: t.inputs,
  };
}
