import fs from "node:fs/promises";
import path from "node:path";
import {
  defaultDirFromRoots,
  filesRootFromWebRoot,
  isSharedUnixSubdomain,
  sharedSubDocroot,
} from "./domain-docroot";
import { DOMAIN_FILE_QUICK_PATHS } from "./domain-files";
import { loadNativeDomainRegistry } from "./provisioner/native-domains";
import type { Role } from "./types";

const QADBAK_DIR = process.env.QADBAK_DIR || process.cwd();

export type DomainFilesContext = {
  domain: string;
  unixUser: string;
  home: string;
  webRoot: string;
  filesRoot: string;
  defaultDir: string;
  jailed: boolean;
  quickPaths: { id: string; label: string; description: string }[];
};

async function readWebsiteJson(domain: string): Promise<{ webRoot?: string }> {
  const file = path.join(
    QADBAK_DIR,
    "data",
    "domain-config",
    domain.toLowerCase(),
    "website.json",
  );
  try {
    const raw = await fs.readFile(file, "utf8");
    const o = JSON.parse(raw) as { webRoot?: string };
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export async function resolveDomainFilesContext(
  domain: string,
  _actor: { role: Role; domains: string[] },
): Promise<DomainFilesContext> {
  const name = String(domain || "").trim().toLowerCase();
  const rows = await loadNativeDomainRegistry();
  const row = rows.find((r) => r.name.toLowerCase() === name);
  const parent = row?.parent
    ? rows.find((r) => r.name.toLowerCase() === String(row.parent).toLowerCase())
    : undefined;
  const unixUser =
    (row?.user || "").trim() ||
    name.split(".")[0]?.replace(/[^a-z0-9_-]/g, "") ||
    "site";
  const home = `/home/${unixUser}`;
  const site = await readWebsiteJson(name);
  const shared = isSharedUnixSubdomain(row, parent);
  const webRoot = String(site.webRoot || "").trim()
    ? String(site.webRoot).trim()
    : shared
      ? sharedSubDocroot(home, name)
      : `${home}/public_html`;
  const filesRoot = filesRootFromWebRoot(home, webRoot);
  const defaultDir = defaultDirFromRoots(filesRoot, webRoot);
  const jailed = filesRoot !== home;
  const quickPaths = jailed
    ? [
        {
          id: defaultDir,
          label: defaultDir || "Website",
          description: `Document root for ${name}`,
        },
      ]
    : [...DOMAIN_FILE_QUICK_PATHS];
  return {
    domain: name,
    unixUser,
    home,
    webRoot,
    filesRoot,
    defaultDir,
    jailed,
    quickPaths,
  };
}

export function mapRequestedFilesDir(ctx: DomainFilesContext, dir: string): string {
  const cwd = String(dir || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (cwd === "public_html" && ctx.defaultDir !== "public_html") {
    return ctx.defaultDir;
  }
  return cwd;
}
