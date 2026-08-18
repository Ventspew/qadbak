import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import {
  emit,
  fail,
  QADBAK_DIR,
  loadRegistry,
  writeJsonFileAtomic,
} from "./provisioning-common.mjs";
import { assertAdminReadablePath } from "./validate-admin-path.mjs";

const exec = promisify(execFile);

const USERS_PATH = path.join(QADBAK_DIR, "data", "users.json");
const ADMIN_STATE = path.join(QADBAK_DIR, "data", "native-admin-state.json");
const TEMPLATES_PATH = path.join(QADBAK_DIR, "data", "native-templates.json");

const DEFAULT_TEMPLATES = [
  { name: "Default", id: "default", desc: "Standard LAMP/LEMP site" },
  { name: "WordPress", id: "wordpress", desc: "PHP + MySQL for WordPress" },
  { name: "Minimal", id: "minimal", desc: "Static site only" },
];

const DEFAULT_GLOBAL_FEATURES = [
  { feature: "web", label: "Website (HTTP/HTTPS)", enabled: "1" },
  { feature: "dns", label: "DNS zone", enabled: "1" },
  { feature: "mail", label: "Mail (Postfix/Dovecot)", enabled: "1" },
  { feature: "mysql", label: "MariaDB databases", enabled: "1" },
  { feature: "ssl", label: "SSL / Let's Encrypt", enabled: "1" },
  { feature: "ftp", label: "FTP accounts", enabled: "0" },
  { feature: "spam", label: "Spam filtering", enabled: "0" },
];

async function ensureTemplates() {
  try {
    await readFile(TEMPLATES_PATH, "utf8");
  } catch {
    await mkdir(path.dirname(TEMPLATES_PATH), { recursive: true });
    await writeFile(
      TEMPLATES_PATH,
      `${JSON.stringify(DEFAULT_TEMPLATES, null, 2)}\n`,
      "utf8",
    );
  }
}

async function loadAdminState() {
  try {
    const raw = await readFile(ADMIN_STATE, "utf8");
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

async function saveAdminState(state) {
  await mkdir(path.dirname(ADMIN_STATE), { recursive: true });
  await writeFile(ADMIN_STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function loadUsers() {
  try {
    const raw = await readFile(USERS_PATH, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    fail("data/users.json missing — create panel users first.");
  }
}

async function saveUsers(users) {
  await writeJsonFileAtomic(USERS_PATH, users);
}

export async function adminLicenseGet() {
  const licensePath = path.join(QADBAK_DIR, "data", "license.json");
  try {
    const raw = await readFile(licensePath, "utf8");
    const lic = JSON.parse(raw);
    const rows = await loadRegistry();
    emit({
      ok: true,
      license: {
        type: lic.plan ? `Qadbak Premium (${lic.plan})` : "Qadbak Core (evaluation)",
        domains: String(lic.maxDomains ?? rows.length),
        expiry: lic.expiresAt ?? "N/A — evaluation / no expiry set",
        status: lic.status ?? "none",
        features: Array.isArray(lic.features) ? lic.features.join(", ") : "",
      },
    });
    return;
  } catch {
    /* fall through */
  }
  const rows = await loadRegistry();
  emit({
    ok: true,
    license: {
      type: "Qadbak Core (evaluation)",
      domains: String(rows.length),
      expiry: "N/A — activate Premium at Server admin → License",
    },
  });
}

export async function adminTemplatesList() {
  await ensureTemplates();
  const raw = await readFile(TEMPLATES_PATH, "utf8");
  const templates = JSON.parse(raw);
  emit({ ok: true, templates: Array.isArray(templates) ? templates : DEFAULT_TEMPLATES });
}

export async function adminAdminsList() {
  const users = await loadUsers();
  const admins = users
    .filter((u) => u.role === "admin")
    .map((u) => ({
      user: u.username,
      domains: (u.domains ?? []).join(", ") || "all",
    }));
  emit({ ok: true, admins });
}

export async function adminAdminsCreate(username, pass) {
  const name = String(username || "").trim();
  if (!name || !pass) fail("username and password required");
  const users = await loadUsers();
  if (users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
    fail(`User already exists: ${name}`);
  }
  const hash = await bcrypt.hash(String(pass), 10);
  users.push({
    id: `admin-${Date.now()}`,
    username: name,
    passwordHash: hash,
    role: "admin",
    domains: [],
  });
  await saveUsers(users);
  emit({ ok: true, user: name });
}

export async function adminAdminsDelete(username) {
  const name = String(username || "").trim();
  const users = await loadUsers();
  const admins = users.filter((u) => u.role === "admin");
  const target = users.find((u) => u.username === name);
  if (!target || target.role !== "admin") fail(`Admin not found: ${name}`);
  if (admins.length <= 1) fail("Cannot delete the last panel administrator.");
  await saveUsers(users.filter((u) => u.username !== name));
  emit({ ok: true, user: name });
}

export async function adminGlobalFeaturesList() {
  const state = await loadAdminState();
  const stored = state.globalFeatures;
  if (Array.isArray(stored) && stored.length) {
    emit({ ok: true, features: stored });
    return;
  }
  await saveAdminState({ ...state, globalFeatures: DEFAULT_GLOBAL_FEATURES });
  emit({ ok: true, features: DEFAULT_GLOBAL_FEATURES });
}

export async function adminGlobalFeatureSet(feature, enabled) {
  const feat = String(feature || "").trim();
  if (!feat) fail("feature required");
  const state = await loadAdminState();
  let features = state.globalFeatures;
  if (!Array.isArray(features) || !features.length) {
    features = [...DEFAULT_GLOBAL_FEATURES];
  }
  const idx = features.findIndex((f) => f.feature === feat);
  const row = {
    feature: feat,
    label: feat,
    enabled: enabled === "true" || enabled === "1" || enabled === true ? "1" : "0",
  };
  if (idx >= 0) {
    features[idx] = { ...features[idx], ...row };
  } else {
    features.push(row);
  }
  await saveAdminState({ ...state, globalFeatures: features });
  emit({ ok: true, features });
}

export async function adminConfigSystem(bundle) {
  const b = String(bundle || "Default").trim();
  const lines = [`Qadbak native config-system (${b})`];
  const services = [
    "nginx",
    "postfix",
    "dovecot",
    "mariadb",
    "php8.4-fpm",
    "php8.3-fpm",
    "php8.2-fpm",
    "php8.1-fpm",
  ];
  for (const svc of services) {
    try {
      const { stdout } = await exec("systemctl", ["is-active", svc], { timeout: 8000 });
      lines.push(`${svc}: ${stdout.trim()}`);
    } catch {
      lines.push(`${svc}: not active or not installed`);
    }
  }
  try {
    await exec("nginx", ["-t"], { timeout: 15_000 });
    await exec("systemctl", ["reload", "nginx"], { timeout: 30_000 });
    lines.push("nginx: config test OK, reloaded");
  } catch (e) {
    lines.push(`nginx: ${e instanceof Error ? e.message : String(e)}`);
  }
  emit({ ok: true, message: lines.join("\n"), result: lines.join("\n") });
}

export async function adminCheckConfig() {
  const lines = ["Qadbak native server check"];
  try {
    await exec("nginx", ["-t"], { timeout: 15_000 });
    lines.push("nginx -t: OK");
  } catch (e) {
    lines.push(`nginx -t: FAIL — ${e instanceof Error ? e.message : e}`);
  }
  for (const svc of ["nginx", "postfix", "dovecot", "mariadb", "bind9"]) {
    try {
      const { stdout: st } = await exec("systemctl", ["is-active", svc], { timeout: 8000 });
      lines.push(`${svc}: ${st.trim()}`);
    } catch {
      lines.push(`${svc}: inactive`);
    }
  }
  const rows = await loadRegistry();
  lines.push(`registered domains: ${rows.length}`);
  const message = lines.join("\n");
  const state = await loadAdminState();
  await saveAdminState({ ...state, lastCheckConfig: message });
  emit({ ok: true, message });
}

export async function adminS3ListBuckets(accessKey, secretKey) {
  if (!accessKey?.trim() || !secretKey?.trim()) {
    fail("AWS access key and secret key required");
  }
  try {
    const { stdout } = await exec(
      "aws",
      ["s3", "ls", "--output", "json"],
      {
        timeout: 60_000,
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKey.trim(),
          AWS_SECRET_ACCESS_KEY: secretKey.trim(),
          AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || "eu-central-1",
        },
      },
    );
    const buckets = [];
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          const name = row.Name ?? row.name;
          if (name) buckets.push({ name, region: row.Region });
        }
      }
    } catch {
      for (const line of stdout.split("\n")) {
        const m = line.match(/^\d{4}-\d{2}-\d{2}\s+\d+:\d+:\d+\s+(\S+)/);
        if (m) buckets.push({ name: m[1] });
      }
    }
    emit({ ok: true, buckets });
  } catch (e) {
    fail(
      `S3 list failed (install aws CLI and check credentials): ${e instanceof Error ? e.message : e}`,
    );
  }
}

export async function adminS3ListFiles(bucket, accessKey, secretKey) {
  const b = String(bucket || "").trim();
  if (!b) fail("bucket required");
  try {
    const { stdout } = await exec(
      "aws",
      ["s3", "ls", `s3://${b}/`, "--output", "json"],
      {
        timeout: 60_000,
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKey.trim(),
          AWS_SECRET_ACCESS_KEY: secretKey.trim(),
        },
      },
    );
    const files = [];
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          const name = row.Key ?? row.key ?? row.Name;
          if (name) files.push({ name, size: String(row.Size ?? ""), modified: row.LastModified });
        }
      }
    } catch {
      for (const line of stdout.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          files.push({ name: parts.slice(3).join(" "), size: parts[2] });
        }
      }
    }
    emit({ ok: true, files });
  } catch (e) {
    fail(`S3 list files failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function adminS3Upload(bucket, key, accessKey, secretKey, source) {
  const b = String(bucket || "").trim();
  const k = String(key || "").trim();
  const src = await assertAdminReadablePath(source);
  if (!b || !k) fail("bucket, key, and source path required");
  try {
    await exec(
      "aws",
      ["s3", "cp", src, `s3://${b}/${k}`],
      {
        timeout: 600_000,
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKey.trim(),
          AWS_SECRET_ACCESS_KEY: secretKey.trim(),
        },
      },
    );
    emit({ ok: true, bucket: b, key: k });
  } catch (e) {
    fail(`S3 upload failed: ${e instanceof Error ? e.message : e}`);
  }
}

export async function adminServerStatus() {
  const rows = await loadRegistry();
  const services = [];
  for (const svc of ["nginx", "postfix", "dovecot", "mariadb", "bind9", "fail2ban"]) {
    try {
      const { stdout } = await exec("systemctl", ["is-active", svc], { timeout: 5000 });
      services.push({ name: svc, status: stdout.trim() });
    } catch {
      services.push({ name: svc, status: "inactive" });
    }
  }
  let nginxTest = "unknown";
  try {
    await exec("nginx", ["-t"], { timeout: 10_000 });
    nginxTest = "ok";
  } catch {
    nginxTest = "fail";
  }
  emit({
    ok: true,
    mode: "native",
    provisioner: "native",
    legacyApiConfigured: false,
    domainCount: rows.length,
    domains: rows.map((r) => r.name),
    services,
    nginxTest,
  });
}
