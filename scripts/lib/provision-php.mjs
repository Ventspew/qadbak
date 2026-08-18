import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  emit,
  fail,
  resolveDomainUser,
  readDomainConfigJson,
  writeDomainConfigJson,
  fileExists,
  QADBAK_DIR,
} from "./provisioning-common.mjs";

const exec = promisify(execFile);

async function syncPhpFpmAndNginx(domain) {
  const { user, home } = await resolveDomainUser(domain);
  const cfg = await loadPhpConfig(domain);
  const ver = cfg.defaultVersion || "8.2";
  const poolScript = path.join(QADBAK_DIR, "scripts", "apply-php-fpm-pool.sh");
  await exec("bash", [poolScript, user, ver, home], { timeout: 120_000 });
  const nginxScript = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  await exec("bash", [nginxScript, domain, user], { timeout: 120_000 });
}

const ALLOWED_INI_KEYS = new Set([
  "memory_limit",
  "upload_max_filesize",
  "post_max_size",
  "max_execution_time",
  "max_input_time",
]);

const POOL_INI_KEYS = [
  "memory_limit",
  "upload_max_filesize",
  "post_max_size",
  "max_execution_time",
];

function userIniPath(home) {
  return path.join(home, "public_html", ".user.ini");
}

async function readUserIniMap(file) {
  const map = new Map();
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith(";") || t.startsWith("#")) continue;
      const m = t.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)$/);
      if (m) map.set(m[1], m[2].trim());
    }
  } catch {
    /* */
  }
  return map;
}

async function writeUserIniMap(file, map) {
  const lines = [
    "; Qadbak PHP overrides (public_html/.user.ini)",
    ...[...map.entries()].map(([k, v]) => `${k} = ${v}`),
    "",
  ];
  await writeFile(file, lines.join("\n"), "utf8");
}

async function loadPhpConfig(domain) {
  const cfg = await readDomainConfigJson(domain, "php.json", {});
  const defaultVersion = cfg.defaultVersion || "8.2";
  const directories = Array.isArray(cfg.directories)
    ? cfg.directories
    : [{ dir: cfg.directory || "public_html", version: defaultVersion, mode: "fpm" }];
  return { ...cfg, defaultVersion, directories };
}

export async function phpVersions(domain) {
  await resolveDomainUser(domain);
  const versions = [];
  try {
    const dirs = await readdir("/etc/php");
    for (const d of dirs) {
      if (/^\d/.test(d)) versions.push({ version: d.replace(/^php/, "") || d, id: d });
    }
  } catch {
    /* */
  }
  if (!versions.length) {
    try {
      const { stdout } = await exec("php", ["-v"], { timeout: 10_000 });
      const m = stdout.match(/PHP (\d+\.\d+)/);
      if (m) versions.push({ version: m[1], id: m[1] });
    } catch {
      versions.push({ version: "8.2", id: "8.2" });
    }
  }
  emit({ ok: true, versions, source: "native-php" });
}

export async function phpDirectories(domain) {
  const { home } = await resolveDomainUser(domain);
  const cfg = await loadPhpConfig(domain);
  const directories = [];
  for (const d of cfg.directories) {
    if (d.dir === "public_html" && !(await fileExists(path.join(home, "public_html")))) {
      continue;
    }
    directories.push(d);
  }
  emit({ ok: true, directories, source: "native-php" });
}

export async function phpIni(domain, version) {
  const { home, user } = await resolveDomainUser(domain);
  const cfg = await loadPhpConfig(domain);
  const ver = version || cfg.defaultVersion || "8.2";
  const iniPath = `/etc/php/${ver}/fpm/php.ini`;
  const overrides = await readUserIniMap(userIniPath(home));
  const settings = [];
  for (const key of POOL_INI_KEYS) {
    let value = overrides.get(key);
    if (value === undefined) {
      try {
        const text = await readFile(iniPath, "utf8");
        const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
        value = m ? m[1].trim() : undefined;
      } catch {
        /* */
      }
    }
    if (value !== undefined) {
      settings.push({
        name: key,
        value,
        source: overrides.has(key) ? "user.ini" : "pool",
      });
    }
  }
  await exec("chown", [`${user}:${user}`, userIniPath(home)]).catch(() => {});
  emit({ ok: true, ini: settings, version: ver, source: "native-php" });
}

export async function phpSetDirectory(domain, dir, version) {
  await resolveDomainUser(domain);
  const rel = String(dir || "public_html").replace(/^\/+/, "");
  const cfg = await loadPhpConfig(domain);
  const sitePool = rel === "public_html" || rel === "." || rel === "";
  const mode = sitePool ? "fpm" : "label";
  const directories = [...cfg.directories];
  const idx = directories.findIndex((d) => d.dir === rel);
  if (idx >= 0) directories[idx] = { ...directories[idx], version, mode };
  else directories.push({ dir: rel, version, mode });
  await writeDomainConfigJson(domain, "php.json", {
    ...cfg,
    defaultVersion: sitePool ? version : cfg.defaultVersion,
    directory: rel,
    directories,
  });
  await syncPhpFpmAndNginx(domain);
  emit({ ok: true, dir: rel, version, mode });
}

export async function phpModifyIni(domain, name, value, version) {
  const key = String(name || "").trim();
  const val = String(value ?? "").trim();
  if (!key || !ALLOWED_INI_KEYS.has(key)) {
    fail(`INI key not allowed: ${key || "(empty)"}. Allowed: ${[...ALLOWED_INI_KEYS].join(", ")}`);
  }
  const { home, user } = await resolveDomainUser(domain);
  const pub = path.join(home, "public_html");
  if (!(await fileExists(pub))) fail("public_html missing");
  const file = userIniPath(home);
  const map = await readUserIniMap(file);
  map.set(key, val);
  await writeUserIniMap(file, map);
  await exec("chown", [`${user}:${user}`, file]);
  const cfg = await loadPhpConfig(domain);
  await syncPhpFpmAndNginx(domain);
  emit({
    ok: true,
    name: key,
    value: val,
    version: version || cfg.defaultVersion,
    file: "public_html/.user.ini",
  });
}

export async function phpDeleteDirectory(domain, dir) {
  const rel = String(dir || "").trim().replace(/^\/+/, "");
  if (!rel) fail("dir required");
  if (rel === "public_html") {
    fail("Cannot remove PHP mapping for public_html — change version instead.");
  }
  const cfg = await loadPhpConfig(domain);
  const directories = cfg.directories.filter((d) => d.dir !== rel);
  if (directories.length === cfg.directories.length) {
    fail(`No PHP mapping for directory: ${rel}`);
  }
  await writeDomainConfigJson(domain, "php.json", { ...cfg, directories });
  emit({ ok: true, dir: rel });
}
