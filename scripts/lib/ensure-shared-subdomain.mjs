import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import {
  fail,
  loadRegistry,
  saveRegistry,
  domainConfigDir,
  readDomainConfigJson,
  writeDomainConfigJson,
  QADBAK_DIR,
} from "./provisioning-common.mjs";
import {
  isLegacyAppWww,
  sharedSubDocroot,
  sharedSubFilesRoot,
} from "./domain-docroot.mjs";

const exec = promisify(execFile);

async function reloadNginx(domain, user) {
  const script = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  await exec("bash", [script, domain, user], { timeout: 120_000 });
}

export async function publishSharedSubDocroot(home, fqdn, user, extraWww) {
  const doc = sharedSubDocroot(home, fqdn);
  await mkdir(doc, { recursive: true });
  const sources = [];
  if (extraWww) sources.push(extraWww);
  const site = await readDomainConfigJson(fqdn, "website.json", {});
  const previous = String(site.webRoot || "").trim();
  if (previous && isLegacyAppWww(home, previous) && previous !== doc) {
    sources.push(previous);
  }
  for (const src of sources) {
    try {
      const names = await readdir(src);
      if (!names.length) continue;
      await exec("cp", ["-a", `${src}/.`, doc], { timeout: 60_000 });
    } catch {
      /* missing source */
    }
  }
  await exec("chown", ["-R", `${user}:${user}`, sharedSubFilesRoot(home, fqdn)]).catch(
    () => {},
  );
  await writeDomainConfigJson(fqdn, "website.json", {
    ...site,
    webRoot: doc,
    mode: site.mode || "static",
    wwwRedirect: site.wwwRedirect || "none",
  });
  return doc;
}

/**
 * Create (or repair) a shared-user subdomain: own document root under
 * ~/domains/<fqdn>/public_html, not the parent public_html / apps/*/www.
 */
export async function ensureSharedSubdomain(parentDomain, user, subPrefix) {
  const parent = String(parentDomain || "").trim().toLowerCase();
  const prefix = String(subPrefix || "").trim().toLowerCase();
  const host = `${prefix}.${parent}`;
  const rows = await loadRegistry();
  const parentRow = rows.find((r) => r.name === parent);
  if (!parentRow) fail(`Unknown parent domain: ${parent}`);
  if (!rows.some((r) => r.name === host)) {
    rows.push({
      name: host,
      user,
      disabled: false,
      plan: parentRow.plan || "Default",
      type: "sub",
      parent,
      isDefault: false,
    });
    await saveRegistry(rows);
  }
  const home = `/home/${user}`;
  await mkdir(domainConfigDir(host), { recursive: true });
  await publishSharedSubDocroot(home, host, user);
  await reloadNginx(host, user);
  return host;
}
