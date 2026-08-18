import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access, readdir } from "node:fs/promises";
import path from "node:path";
import {
  emit,
  fail,
  fileExists,
  resolveDomainUser,
  assertNotAliasDomain,
  QADBAK_DIR,
} from "./provisioning-common.mjs";

import { certMatchesDomain } from "./ssl-cert-match.mjs";

const exec = promisify(execFile);

function tailLines(text, n = 40) {
  if (!text) return "";
  return String(text)
    .split(/\r?\n/)
    .slice(-n)
    .join("\n")
    .trim();
}

async function readCertFile(fullchain, host) {
  const pem = await readFile(fullchain, "utf8");
  const notAfter = await exec("openssl", [
    "x509",
    "-enddate",
    "-noout",
    "-in",
    fullchain,
  ]);
  return {
    host,
    issuer: pem.includes("Let's Encrypt")
      ? "Let's Encrypt"
      : pem.includes("R3") || pem.includes("E1")
        ? "Let's Encrypt"
        : "installed",
    expiry: notAfter.stdout.replace("notAfter=", "").trim(),
    type: "letsencrypt",
  };
}

async function certbotList(domain) {
  const certs = [];
  const seen = new Set();
  const live = "/etc/letsencrypt/live";
  const hosts = new Set([domain, `www.${domain}`]);
  try {
    for (const name of await readdir(live)) {
      if (certMatchesDomain(name, domain)) {
        hosts.add(name);
      }
    }
  } catch {
    /* */
  }
  for (const host of hosts) {
    const dir = path.join(live, host);
    try {
      await access(dir);
      const fullchain = path.join(dir, "fullchain.pem");
      const row = await readCertFile(fullchain, host);
      if (!seen.has(row.host)) {
        seen.add(row.host);
        certs.push(row);
      }
    } catch {
      /* no cert */
    }
  }
  if (certs.length) return certs;
  try {
    const { stdout } = await exec("certbot", ["certificates"], { maxBuffer: 2 * 1024 * 1024 });
    const names = [...stdout.matchAll(/^\s*Certificate Name:\s+(\S+)/gim)].map(
      (m) => m[1],
    );
    if (names.some((n) => certMatchesDomain(n, domain))) {
      certs.push({
        host: domain,
        issuer: "Let's Encrypt",
        expiry: "",
        type: "letsencrypt",
      });
    }
  } catch {
    /* certbot missing */
  }
  return certs;
}

export async function sslList(domain) {
  await assertNotAliasDomain(domain, "SSL");
  await resolveDomainUser(domain);
  const certs = await certbotList(domain);
  emit({ ok: true, certs });
}

function extraSslHost(domain, host) {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  const d = String(domain || "")
    .trim()
    .toLowerCase();
  if (!h || h === d || h === `www.${d}`) return "";
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
      h,
    )
  ) {
    return "";
  }
  return h;
}

// SSL issue drives apply-domain-nginx.sh ISSUE_SSL=1 instead of pure certbot,
// because the Qadbak nginx vhost still needs an HTTPS server-block + PHP-FPM
// root rewritten alongside the cert — bare `certbot certonly` only fetches
// pem files and leaves the domain reachable on HTTP only.
export async function sslIssue(domain, host) {
  await assertNotAliasDomain(domain, "SSL");
  const { user, home } = await resolveDomainUser(domain);
  const target = host && host !== domain ? host : domain;
  const extra = extraSslHost(domain, host);

  // The provisioning helper itself is invoked via sudo (see
  // scripts/run-provisioning-helper.sh), so this Node process is already
  // root and can exec apply-domain-nginx.sh directly — no `sudo -n` needed.
  const applyScript = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  if (await fileExists(applyScript)) {
    try {
      await exec("bash", [applyScript, domain, user], {
        env: {
          ...process.env,
          ISSUE_SSL: "1",
          ...(extra ? { EXTRA_SSL_HOST: extra } : {}),
        },
        timeout: 360_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (e) {
      const err = e || {};
      const combined = [err.stdout || "", err.stderr || ""].join("\n");
      const tail =
        tailLines(combined, 40) ||
        err.message ||
        "apply-domain-nginx.sh failed";
      throw new Error(
        `apply-domain-nginx.sh ${domain} ${user} failed:\n${tail}`,
      );
    }
    emit({ ok: true, domain, host: target, user });
    return;
  }

  // Fallback: standalone certbot (used in test envs / CI where the apply
  // script isn't deployed). Doesn't rewrite the vhost, but at least issues
  // the cert so the legacy code path keeps working.
  const email =
    process.env.QADBAK_LE_EMAIL?.trim() ||
    process.env.LE_EMAIL?.trim() ||
    `admin@${domain}`;
  const webroot = path.join(home, "public_html");
  const args = [
    "certonly",
    "--non-interactive",
    "--agree-tos",
    "-m",
    email,
    "--keep-until-expiring",
    "-d",
    domain,
    "-d",
    `www.${domain}`,
    ...(extra ? ["-d", extra] : []),
  ];
  try {
    await exec("certbot", [...args, "--nginx"], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  } catch {
    await exec(
      "certbot",
      [...args, "--webroot", "-w", webroot],
      { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 },
    );
  }
  emit({ ok: true, domain, host: target, user });
}

export async function sslIssueBestEffort(domain, host) {
  try {
    await sslIssue(domain, host);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit(`WARN: SSL not issued for ${host || domain}: ${msg.slice(0, 400)}`);
  }
}
