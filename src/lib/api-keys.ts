import { createHash, randomBytes } from "crypto";
import fs from "fs/promises";
import path from "path";

import { writeJsonAtomic } from "./write-json-atomic";

const KEYS_PATH = path.join(process.cwd(), "data", "api-keys.json");

export type ApiKeyScope =
  | "domains:read"
  | "domains:write"
  | "mail:read"
  | "mail:write"
  | "dns:read"
  | "dns:write"
  | "ssl:read"
  | "ssl:write"
  | "backups:read"
  | "backups:write"
  | "limits:read"
  | "limits:write"
  | "plans:read";

export interface ApiKeyRecord {
  id: string;
  label: string;
  hash: string;
  scopes: ApiKeyScope[];
  resellerId?: string;
  ipAllowlist: string[];
  createdAt: string;
  lastUsedAt?: string;
}

interface Store {
  keys: ApiKeyRecord[];
}

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.readFile(KEYS_PATH, "utf8");
    return JSON.parse(raw) as Store;
  } catch {
    return { keys: [] };
  }
}

async function saveStore(store: Store): Promise<void> {
  await writeJsonAtomic(KEYS_PATH, store, 0o600);
}

export async function listApiKeys(): Promise<Omit<ApiKeyRecord, "hash">[]> {
  const store = await loadStore();
  return store.keys.map(({ hash: _h, ...k }) => k);
}

export async function createApiKey(
  label: string,
  scopes: ApiKeyScope[],
  opts?: { resellerId?: string; ipAllowlist?: string[] },
): Promise<{ id: string; secret: string }> {
  const raw = `qadbak_${randomBytes(24).toString("base64url")}`;
  const id = randomBytes(8).toString("hex");
  const store = await loadStore();
  store.keys.push({
    id,
    label: label.trim() || id,
    hash: hashKey(raw),
    scopes,
    resellerId: opts?.resellerId,
    ipAllowlist: opts?.ipAllowlist ?? [],
    createdAt: new Date().toISOString(),
  });
  await saveStore(store);
  return { id, secret: raw };
}

export async function revokeApiKey(id: string): Promise<void> {
  const store = await loadStore();
  store.keys = store.keys.filter((k) => k.id !== id);
  await saveStore(store);
}

export async function verifyApiKey(
  bearer: string,
  requiredScope: ApiKeyScope,
  clientIp?: string,
): Promise<ApiKeyRecord | null> {
  const store = await loadStore();
  const h = hashKey(bearer);
  const row = store.keys.find((k) => k.hash === h);
  if (!row || !row.scopes.includes(requiredScope)) return null;
  if (row.ipAllowlist.length > 0) {
    if (!clientIp) return null;
    if (!row.ipAllowlist.some((ip) => ip === clientIp)) return null;
  }
  row.lastUsedAt = new Date().toISOString();
  await saveStore(store);
  return row;
}
