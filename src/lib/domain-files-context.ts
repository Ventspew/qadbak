import fs from "node:fs/promises";
import path from "node:path";
import {
  defaultDirFromRoots,
  filesRootFromWebRoot,
  isLegacyAppWww,
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
  /** Old apps/{app}/www path to copy into the subdomain public_html. */
  migrateFrom?: string;
};

function websiteJsonPath(domain: string): string {
  return path.join(
    QADBAK_DIR,
    "data",
    "domain-config",
    domain.toLowerCase(),
    "website.json",
  );
}

async function readWebsiteJson(domain: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(websiteJsonPath(domain), "utf8");
    const o = JSON.parse(raw) as Record<string, unknown>;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/** Point website.json at the canonical subdomain public_html after copying leftover app www folders. */
export async function persistCanonicalWebRoot(
  domain: string,
  webRoot: string,
): Promise<void> {
  const file = websiteJsonPath(domain);
  const cur = await readWebsiteJson(domain);
  if (String(cur.webRoot || "").trim() === webRoot) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `${JSON.stringify(
      {
        ...cur,
        webRoot,
        mode: typeof cur.mode === "string" && cur.mode ? cur.mode : "static",
        wwwRedirect:
          typeof cur.wwwRedirect === "string" && cur.wwwRedirect
            ? cur.wwwRedirect
            : "none",
      },
      null,
      2,
    )}\n`,
  );
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
  const configured = String(site.webRoot || "").trim();
  let webRoot = configured
    ? configured
    : shared
      ? sharedSubDocroot(home, name)
      : `${home}/public_html`;
  let migrateFrom: string | undefined;
  if (shared && configured && isLegacyAppWww(home, configured)) {
    migrateFrom = configured;
    webRoot = sharedSubDocroot(home, name);
  }
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
    migrateFrom,
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
