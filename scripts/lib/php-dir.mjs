/** Normalize a PHP directory mapping relative to public_html. */

export function normalizePhpDir(dir) {
  let d = String(dir || "public_html")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!d || d === "." || d === "public_html") return "public_html";
  if (d.startsWith("public_html/")) d = d.slice("public_html/".length);
  if (!d || d === ".") return "public_html";
  if (d.includes("..") || d.includes("\0") || d.startsWith("homes/")) {
    throw new Error(`Invalid PHP directory: ${dir}`);
  }
  if (!/^[a-zA-Z0-9._/-]+$/.test(d)) {
    throw new Error(`Invalid PHP directory: ${dir}`);
  }
  return d === "public_html" ? "public_html" : `public_html/${d}`;
}

/** URL prefix for nginx ("" = site root). */
export function phpDirUriPrefix(dir) {
  const rel = normalizePhpDir(dir);
  if (rel === "public_html") return "";
  return `/${rel.slice("public_html/".length)}`;
}

export function phpDirSlug(domain, dir) {
  const rel = normalizePhpDir(dir);
  const leaf = rel === "public_html" ? "root" : rel.slice("public_html/".length);
  const dom = String(domain || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const dslug = leaf.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${dom}-${dslug || "dir"}`;
}

export function isSitePhpDir(dir) {
  return normalizePhpDir(dir) === "public_html";
}

export function extraPhpDirectories(directories) {
  const list = Array.isArray(directories) ? directories : [];
  const extras = [];
  for (const row of list) {
    const rel = normalizePhpDir(row?.dir);
    if (rel === "public_html") continue;
    extras.push({
      dir: rel,
      version: String(row.version || "").trim(),
      uriPrefix: phpDirUriPrefix(rel),
    });
  }
  extras.sort((a, b) => b.uriPrefix.length - a.uriPrefix.length);
  return extras;
}
