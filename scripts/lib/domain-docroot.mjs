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

export function isSharedUnixSubdomain(row, parentRow) {
  const type = String(row?.type || "top").toLowerCase();
  if (type !== "sub") return false;
  const user = String(row?.user || "").trim();
  if (!user) return false;
  const parentUser = String(parentRow?.user || "").trim();
  if (!parentUser) return true;
  return user === parentUser;
}
