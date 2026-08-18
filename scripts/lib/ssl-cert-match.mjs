/** Exact / www / dotted-suffix match — never substring `includes`. */
export function certMatchesDomain(certName, domain) {
  const name = String(certName || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!name || !d) return false;
  if (name === d || name === `www.${d}`) return true;
  return name.endsWith(`.${d}`);
}
