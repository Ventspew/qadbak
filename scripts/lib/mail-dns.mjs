import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { dnsAdd, dnsZoneContext, findZonePath } from "./provision-dns.mjs";
import { parseZone } from "./dns-zone-edit.mjs";

const exec = promisify(execFile);

const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isValidHostname(value) {
  const v = String(value || "").trim().toLowerCase();
  return v.length > 0 && v.length <= 253 && HOSTNAME_RE.test(v);
}

let envLoaded = false;

async function loadEnvLocal() {
  if (envLoaded) return;
  envLoaded = true;
  const root = process.env.QADBAK_DIR || "/opt/qadbak";
  try {
    const raw = await readFile(path.join(root, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      if (!k || process.env[k] !== undefined) continue;
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

export function isIpAddress(value) {
  const v = String(value || "").trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return false;
  return v.split(".").every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function isMailFqdn(value) {
  return isValidHostname(value);
}

export async function resolveMailHost() {
  await loadEnvLocal();
  const candidates = [
    process.env.QADBAK_MAIL_HOST?.trim(),
    process.env.QADBAK_PUBLIC_HOST?.trim(),
  ].filter(Boolean);
  for (const c of candidates) {
    if (isMailFqdn(c)) return String(c).trim().replace(/\.$/, "");
  }
  for (const c of candidates) {
    if (isIpAddress(c)) {
      /* skip — IP breaks Postfix virtual alias expansion */
    }
  }
  try {
    const { stdout } = await exec("hostname", ["-f"], { timeout: 5000 });
    const h = stdout.trim();
    if (isMailFqdn(h)) return h;
  } catch {
    /* */
  }
  return "mail.example.com";
}

export async function resolveOriginIp() {
  await loadEnvLocal();
  const fromEnv = process.env.QADBAK_ORIGIN_IP?.trim();
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await exec(
      "bash",
      [
        "-c",
        "curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'",
      ],
      { timeout: 10_000 },
    );
    return stdout.trim().split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

/** MX presets for common external mail hosts (DNS at Cloudflare etc.). */
export const EXTERNAL_MAIL_PROVIDERS = [
  {
    id: "google",
    name: "Google Workspace",
    setupUrl: "https://admin.google.com/ac/domains/manage",
    steps: [
      "Add and verify your domain in Google Admin (Domains).",
      "Copy the MX records Google shows — they override mail on this VPS.",
      "Remove old MX records that point to this server when switching fully to Google.",
      "Add Google's domain verification TXT record if asked.",
    ],
    mx: [
      { priority: 1, host: "ASPMX.L.GOOGLE.COM." },
      { priority: 5, host: "ALT1.ASPMX.L.GOOGLE.COM." },
      { priority: 5, host: "ALT2.ASPMX.L.GOOGLE.COM." },
      { priority: 10, host: "ALT3.ASPMX.L.GOOGLE.COM." },
      { priority: 10, host: "ALT4.ASPMX.L.GOOGLE.COM." },
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    setupUrl: "https://admin.microsoft.com/#/Domains",
    steps: [
      "Add the domain in Microsoft 365 admin center and verify ownership (TXT).",
      "Apply the MX record Microsoft provides (often *.mail.protection.outlook.com).",
      "Complete autodiscover/CNAME steps if shown in the wizard.",
      "Remove MX to this VPS when mail is fully on Microsoft.",
    ],
    mx: [
      {
        priority: 0,
        host: "YOUR-TENANT.mail.protection.outlook.com.",
        note: "Replace with the exact host from the Microsoft 365 setup wizard.",
      },
    ],
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    setupUrl: "https://www.zoho.com/mail/help/adminconsole/domain-verification.html",
    steps: [
      "Add the domain in Zoho Mail admin and verify via TXT/MX.",
      "Use the MX values Zoho assigns (mx.zoho.eu / mx.zoho.com depending on region).",
    ],
    mx: [
      {
        priority: 10,
        host: "mx.zoho.com.",
        note: "Use mx.zoho.eu for EU accounts — check Zoho admin.",
      },
    ],
  },
  {
    id: "other",
    name: "Other provider",
    steps: [
      "In your provider's admin, add the domain and note their required MX/TXT records.",
      "At your DNS host (Cloudflare, etc.), set MX to the provider — not this VPS.",
      "Keep only one active MX target; conflicting MX causes lost mail.",
      "Website can stay on this server; only mail DNS moves to the provider.",
    ],
    mx: [],
  },
];

/** DNS records users need for inbound mail on this VPS (Qadbak/Postfix). */
export async function mailDnsHints(domain) {
  const mailHost = await resolveMailHost();
  const ip = await resolveOriginIp();
  const d = String(domain).trim().toLowerCase();
  return {
    domain: d,
    mailHost,
    records: [
      {
        type: "MX",
        name: "@",
        priority: "10",
        value: `${mailHost}.`,
        note: "DNS only (not proxied in Cloudflare)",
      },
      ...(ip
        ? [
            {
              type: "A",
              name: "mail",
              value: ip,
              note: "DNS only — IMAP/SMTP host",
            },
          ]
        : []),
      {
        type: "TXT",
        name: "@",
        value: ip ? `v=spf1 mx a ip4:${ip} ~all` : "v=spf1 mx a ~all",
        note: "SPF",
      },
      {
        type: "TXT",
        name: "_dmarc",
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${d}; fo=1`,
        note: "DMARC (start with p=none, tighten later)",
      },
    ],
    ports: "Inbound SMTP: TCP 25 · Submission: 587 · IMAP: 993 (TLS)",
    externalProviders: EXTERNAL_MAIL_PROVIDERS,
    onThisServer: {
      imap: `${mailHost}`,
      smtp: `${mailHost}`,
      note: "Use the mailbox password from Mail → Accounts. Host is often mail.yourdomain.com or the server hostname.",
    },
  };
}

/** Add MX + mail A to local BIND zone when QADBAK_MAIL_AUTODNS is not false. */
export async function ensureInboundMailDns(domain) {
  const hints = await mailDnsHints(domain);
  const autodns = process.env.QADBAK_MAIL_AUTODNS?.trim().toLowerCase() !== "false";
  if (!autodns) {
    return { ok: true, applied: false, hints, source: "dns-hints-only" };
  }

  try {
    const ctx = await dnsZoneContext(domain);
    const zonePath = await findZonePath(ctx.origin);
    const text = await readFile(zonePath, "utf8");
    const recs = parseZone(text, ctx.origin);
    const mailHost = hints.mailHost;
    const mailLabel = mailHost.includes(".") ? mailHost.split(".")[0] : "mail";
    const mxName = ctx.label || "@";
    const mailAName = ctx.label ? `${mailLabel}.${ctx.label}` : mailLabel;
    const applied = [];

    if (!recs.some((r) => String(r.type).toUpperCase() === "MX" && r.name === mxName)) {
      await dnsAdd(domain, {
        name: "@",
        type: "MX",
        priority: "10",
        value: `${mailHost}.`,
      });
      applied.push("MX");
    }

    const ip = await resolveOriginIp();
    if (
      ip &&
      !recs.some((r) => String(r.type).toUpperCase() === "A" && r.name === mailAName)
    ) {
      await dnsAdd(domain, { name: mailLabel, type: "A", value: ip });
      applied.push(`${mailLabel} A`);
    }

    return {
      ok: true,
      applied: applied.length > 0,
      appliedRecords: applied,
      hints,
      zonePath,
      source: "bind-autodns",
    };
  } catch {
    return { ok: true, applied: false, hints, source: "external-dns" };
  }
}
