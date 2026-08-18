import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  fileExists,
  loadRegistry,
  readDomainConfigJson,
  QADBAK_DIR,
} from "./provisioning-common.mjs";

const exec = promisify(execFile);

// 05- so this userdb runs before 10-auth/99 passwd (continue-ok merges quota_rule).
const QUOTA_CONF = "/etc/dovecot/conf.d/05-qadbak-quota.conf";
const QUOTA_USERS = "/etc/dovecot/qadbak-quota-users";
const NATIVE_CONF = "/etc/dovecot/conf.d/99-qadbak-native.conf";

const QUOTA_CONF_BODY = [
  "# Qadbak — Dovecot quota plugin (limits from mailbox-quotas.json)",
  "mail_plugins = $mail_plugins quota",
  "",
  "plugin {",
  "  quota = count:User quota",
  "  quota_vsizes = yes",
  "  quota_rule = *:storage=0",
  "  quota_grace = 0",
  "}",
  "",
  "userdb {",
  "  driver = passwd-file",
  "  args = username_format=%n " + QUOTA_USERS,
  "  result_success = continue-ok",
  "  result_failure = continue",
  "  result_internalfail = continue",
  "}",
  "",
].join("\n");

async function reloadDovecot() {
  try {
    await exec("doveconf", ["-n"], { timeout: 15_000 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Dovecot config check failed: ${msg.slice(0, 400)}`);
  }
  await exec("systemctl", ["reload", "dovecot"], { timeout: 30_000 }).catch(async () => {
    await exec("systemctl", ["reload", "dovecot-core"], { timeout: 30_000 }).catch(
      async () => {
        await exec("systemctl", ["restart", "dovecot"], { timeout: 30_000 });
      },
    );
  });
}

async function patchNativeMailPlugins() {
  if (!(await fileExists(NATIVE_CONF))) return;
  let text = await readFile(NATIVE_CONF, "utf8");
  const next = text
    .replace(
      /protocol imap \{[\s\S]*?mail_plugins\s*=\s*[^\n]+/,
      (block) => {
        if (block.includes("imap_quota")) return block;
        return block.replace(
          /mail_plugins\s*=\s*([^\n]+)/,
          "mail_plugins = $1 imap_quota",
        );
      },
    )
    .replace(
      /protocol lmtp \{[\s\S]*?mail_plugins\s*=\s*[^\n]+/,
      (block) => {
        if (/\bquota\b/.test(block) && !block.includes("imap_quota")) return block;
        if (block.includes(" quota") || /mail_plugins =.*\bquota\b/.test(block)) {
          return block;
        }
        return block.replace(
          /mail_plugins\s*=\s*([^\n]+)/,
          "mail_plugins = $1 quota",
        );
      },
    );
  if (next !== text) await writeFile(NATIVE_CONF, next, "utf8");
}

/** passwd-file extra_fields line (7 colons before extra_fields). */
export function quotaUserdbLine(localPart, quotaMb) {
  const user = String(localPart || "")
    .trim()
    .toLowerCase()
    .split("@")[0];
  const mb = parseInt(String(quotaMb), 10);
  if (!user || !/^[a-z0-9._-]+$/i.test(user) || !Number.isFinite(mb) || mb <= 0) {
    return null;
  }
  return `${user}:::::::userdb_quota_rule=*:storage=${mb}M`;
}

async function collectQuotaUsers() {
  const lines = ["# user:::::::userdb_quota_rule=*:storage=NM"];
  const seen = new Set();
  const rows = await loadRegistry();
  const cfgRoot = path.join(QADBAK_DIR, "data", "domain-config");
  let names = rows.map((r) => String(r.name || "").toLowerCase()).filter(Boolean);
  try {
    const dirs = await readdir(cfgRoot);
    for (const d of dirs) {
      if (!names.includes(d.toLowerCase())) names.push(d);
    }
  } catch {
    /* */
  }
  for (const domain of names) {
    const data = await readDomainConfigJson(domain, "mailbox-quotas.json", {
      limits: {},
    });
    const limits = data.limits && typeof data.limits === "object" ? data.limits : {};
    for (const [local, row] of Object.entries(limits)) {
      const line = quotaUserdbLine(local, row?.quotaMb ?? row?.quota);
      if (!line) continue;
      const user = line.split(":")[0];
      if (seen.has(user)) continue;
      seen.add(user);
      lines.push(line);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function syncDovecotQuota() {
  await mkdir("/etc/dovecot/conf.d", { recursive: true });
  await writeFile(QUOTA_CONF, QUOTA_CONF_BODY, "utf8");
  await writeFile(QUOTA_USERS, await collectQuotaUsers(), "utf8");
  try {
    await unlink("/etc/dovecot/conf.d/98-qadbak-quota.conf");
  } catch {
    /* older path */
  }
  await patchNativeMailPlugins();
  await reloadDovecot();
}
