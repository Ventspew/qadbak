/** Canonical website paths. Shared-user subdomains must not reuse the parent public_html. */

function stripSlash(p) {
  return String(p || "").replace(/\/+$/, "") || "/";
}

export function sharedSubFilesRoot(home, fqdn) {
  const name = String(fqdn || "").trim().toLowerCase();
  return `${stripSlash(home)}/domains/${name}`;
}

export function sharedSubDocroot(home, fqdn) {
  return `${sharedSubFilesRoot(home, fqdn)}/public_html`;
}

export function isLegacyAppWww(home, webRoot) {
  const h = String(home || "").replace(/\/+$/, "");
  const wr = String(webRoot || "").replace(/\/+$/, "");
  return Boolean(h) && wr.startsWith(`${h}/apps/`) && wr.endsWith("/www");
}

export function isSharedUnixSubdomain(row, parentRow) {
  const type = String(row?.type || "top").toLowerCase();
  if (type !== "sub") return false;
  const user = String(row?.user || "").trim();
  if (!user) return false;
  const parentUser = String(parentRow?.user || "").trim();
  if (!parentUser) return true;
  return user === parentUser;
}

export function filesRootFromWebRoot(home, webRoot) {
  const h = stripSlash(home);
  const wr = stripSlash(webRoot);
  if (wr === `${h}/public_html`) return h;
  if (wr.startsWith(`${h}/domains/`) && wr.endsWith("/public_html")) {
    return wr.slice(0, -"/public_html".length);
  }
  return wr;
}

export function relFromRoot(root, abs) {
  const r = stripSlash(root);
  const a = stripSlash(abs);
  if (a === r) return "";
  if (a.startsWith(`${r}/`)) return a.slice(r.length + 1);
  return "";
}

export function defaultDirFromRoots(filesRoot, webRoot) {
  return relFromRoot(filesRoot, webRoot);
}

export function absUnderRoot(filesRoot, panelPath) {
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

export function isAbsInsideRoot(filesRoot, abs) {
  const r = stripSlash(filesRoot);
  const a = stripSlash(abs);
  return a === r || a.startsWith(`${r}/`);
}
