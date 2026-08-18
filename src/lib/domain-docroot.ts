/** Canonical website paths. Shared-user subdomains must not reuse the parent public_html. */

function stripSlash(p: string): string {
  return String(p || "").replace(/\/+$/, "") || "/";
}

export function sharedSubFilesRoot(home: string, fqdn: string): string {
  const name = String(fqdn || "").trim().toLowerCase();
  return `${stripSlash(home)}/domains/${name}`;
}

export function sharedSubDocroot(home: string, fqdn: string): string {
  return `${sharedSubFilesRoot(home, fqdn)}/public_html`;
}

export function isSharedUnixSubdomain(
  row: { type?: string; user?: string; parent?: string } | null | undefined,
  parentRow: { user?: string } | null | undefined,
): boolean {
  const type = String(row?.type || "top").toLowerCase();
  if (type !== "sub") return false;
  const user = String(row?.user || "").trim();
  if (!user) return false;
  const parentUser = String(parentRow?.user || "").trim();
  if (!parentUser) return true;
  return user === parentUser;
}

export function filesRootFromWebRoot(home: string, webRoot: string): string {
  const h = stripSlash(home);
  const wr = stripSlash(webRoot);
  if (wr === `${h}/public_html`) return h;
  if (wr.startsWith(`${h}/domains/`) && wr.endsWith("/public_html")) {
    return wr.slice(0, -"/public_html".length);
  }
  return wr;
}

export function relFromRoot(root: string, abs: string): string {
  const r = stripSlash(root);
  const a = stripSlash(abs);
  if (a === r) return "";
  if (a.startsWith(`${r}/`)) return a.slice(r.length + 1);
  return "";
}

export function defaultDirFromRoots(filesRoot: string, webRoot: string): string {
  return relFromRoot(filesRoot, webRoot);
}

export function absUnderRoot(filesRoot: string, panelPath: string): string {
  const parts = String(panelPath || "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error("Invalid path.");
  }
  const root = stripSlash(filesRoot);
  return parts.length ? `${root}/${parts.join("/")}` : root;
}

export function isAbsInsideRoot(filesRoot: string, abs: string): boolean {
  const r = stripSlash(filesRoot);
  const a = stripSlash(abs);
  return a === r || a.startsWith(`${r}/`);
}
