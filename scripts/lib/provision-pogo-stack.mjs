import { execFile, spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { dnsAdd } from "./provision-dns.mjs";
import { sslIssue } from "./provision-ssl.mjs";
import {
  emit,
  fail,
  loadRegistry,
  saveRegistry,
  resolveDomainUser,
  domainConfigDir,
  readDomainConfigJson,
  writeDomainConfigJson,
  QADBAK_DIR,
} from "./provisioning-common.mjs";

const exec = promisify(execFile);

const POGO_DIR = path.join(QADBAK_DIR, "integrations", "pogo-stack");
const STATE_PATH = path.join(QADBAK_DIR, "data", "pogo-stack.json");

/** Cached docker compose invocation: `docker compose` or legacy `docker-compose`. */
let composeRunner = null;

function execDetail(err) {
  if (!err || typeof err !== "object") {
    return err instanceof Error ? err.message : String(err);
  }
  const stderr = "stderr" in err ? String(err.stderr).trim() : "";
  const stdout = "stdout" in err ? String(err.stdout).trim() : "";
  const msg = err instanceof Error ? err.message : String(err);
  return stderr || stdout || msg;
}

async function runStep(label, fn) {
  try {
    return await fn();
  } catch (e) {
    fail(`${label} failed: ${execDetail(e).slice(0, 4000)}`);
  }
}

async function hostArch() {
  const { stdout } = await exec("uname", ["-m"], { timeout: 10_000 });
  return stdout.trim().toLowerCase();
}

function isArmArch(arch) {
  return arch === "aarch64" || arch === "arm64";
}

function redroidImageForArch(arch) {
  return isArmArch(arch)
    ? "abing7k/redroid:a11_magisk_arm"
    : "redroid/redroid:11.0.0-latest";
}

function upsertEnvLine(body, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(body)) {
    return body.replace(re, `${key}=${value}`);
  }
  return `${body.replace(/\s*$/, "")}\n${key}=${value}\n`;
}

async function applyRedroidArchEnv() {
  const envPath = path.join(POGO_DIR, ".env");
  const arch = await hostArch();
  const image = redroidImageForArch(arch);
  let body = await readFile(envPath, "utf8");
  const current = body.match(/^REDROID_IMAGE=(.*)$/m)?.[1]?.trim() || "";
  const staleArmOnX86 =
    !isArmArch(arch) && /arm|a11_magisk/i.test(current);
  const defaultOfficialOnArm =
    isArmArch(arch) && /^redroid\/redroid:/.test(current);
  if (!current || staleArmOnX86 || defaultOfficialOnArm) {
    body = upsertEnvLine(body, "REDROID_IMAGE", image);
    await writeFile(envPath, body, "utf8");
  }
  emit(
    `Host arch ${arch} — Redroid image ${
      current && !staleArmOnX86 && !defaultOfficialOnArm ? current : image
    }`,
  );
  return { arch, arm: isArmArch(arch) };
}

async function resolveComposeRunner() {
  if (composeRunner) return composeRunner;
  try {
    await exec("docker", ["compose", "version"], { timeout: 30_000 });
    composeRunner = { cmd: "docker", prefix: ["compose"] };
    return composeRunner;
  } catch {
    /* try legacy binary */
  }
  try {
    await exec("docker-compose", ["version"], { timeout: 30_000 });
    composeRunner = { cmd: "docker-compose", prefix: [] };
    return composeRunner;
  } catch {
    fail(
      "Docker Compose is not installed. Run: sudo bash /opt/qadbak/scripts/lib/ensure-docker.sh",
    );
  }
}

function parsePayload(payloadJson) {
  if (!payloadJson) return {};
  try {
    const o = JSON.parse(payloadJson);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function secret(prefix = "") {
  return `${prefix}${randomBytes(24).toString("hex")}`;
}

async function readState() {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function upsertProxy(domain, loc, dest, websocket = false) {
  const proxies = await readDomainConfigJson(domain, "proxies.json", []);
  let pathKey = String(loc || "/").trim();
  if (!pathKey.startsWith("/")) pathKey = `/${pathKey}`;
  if (pathKey !== "/") pathKey = `${pathKey.replace(/\/+$/, "")}/`;
  const idx = proxies.findIndex((p) => p.path === pathKey);
  const row = {
    path: pathKey,
    dest: String(dest).trim(),
    type: "proxy",
    ...(websocket ? { websocket: true } : {}),
  };
  if (idx >= 0) proxies[idx] = row;
  else proxies.push(row);
  await writeDomainConfigJson(domain, "proxies.json", proxies);
}

async function reloadNginx(domain, user, { ssl = false } = {}) {
  const script = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  const args = [script, domain, user];
  if (ssl) args.push("--ssl");
  await exec("bash", args, {
    env: { ...process.env, ...(ssl ? { ISSUE_SSL: "1" } : {}) },
    timeout: 360_000,
  });
}

async function ensurePogoWebsiteConfig(pogoHost, user) {
  const home = `/home/${user}`;
  const pub = path.join(home, "public_html");
  await mkdir(pub, { recursive: true });
  await writeDomainConfigJson(pogoHost, "website.json", {
    webRoot: pub,
    mode: "static",
    wwwRedirect: "none",
  });
}

async function ensureDashboardProxy(pogoHost, user) {
  const envBody = await readFile(path.join(POGO_DIR, ".env"), "utf8").catch(() => "");
  const dashboardPort =
    envBody.match(/^DASHBOARD_PORT=(.*)$/m)?.[1]?.trim() ||
    process.env.POGO_DASHBOARD_PORT ||
    "18080";
  await ensurePogoWebsiteConfig(pogoHost, user);
  await upsertProxy(pogoHost, "/", `http://127.0.0.1:${dashboardPort}/`, true);
  await reloadNginx(pogoHost, user, { ssl: true });
  return dashboardPort;
}

async function ensureDocker() {
  const script = path.join(QADBAK_DIR, "scripts", "lib", "ensure-docker.sh");
  await runStep("Docker setup", async () => {
    await exec("bash", [script], { timeout: 600_000 });
  });
  await resolveComposeRunner();
}

async function ensureHostPrep(workers) {
  if (!workers) return;
  const script = path.join(POGO_DIR, "scripts", "setup-qadbak-host.sh");
  if (await access(script).then(() => true).catch(() => false)) {
    await exec("bash", [script], { timeout: 300_000 }).catch((e) => {
      emit(`WARN: setup-qadbak-host.sh: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

async function ensureEnv(mode) {
  const envPath = path.join(POGO_DIR, ".env");
  const example = path.join(POGO_DIR, ".env.example");
  if (!(await access(envPath).then(() => true).catch(() => false))) {
    if (!(await access(example).then(() => true).catch(() => false))) {
      fail("Missing integrations/pogo-stack/.env.example");
    }
    await copyFile(example, envPath);
    let body = await readFile(envPath, "utf8");
    body = body
      .replace(/change-me-root/g, secret("root-"))
      .replace(/change-me-pogo/g, secret("db-"))
      .replace(/change-me-api-key/g, secret("api-"))
      .replace(/change-me-dashboard-secret/g, secret("dash-"))
      .replace(/change-me-koji-token/g, secret("koji-"))
      .replace(/change-me-poracle/g, secret("por-"))
      .replace(/change-me-reactmap/g, secret("rm-"))
      .replace(/change-me-cosmog-token/g, secret("cos-"))
      .replace(/change-me-rotom-secret/g, secret("rot-"));
    const originIp = process.env.QADBAK_ORIGIN_IP?.trim();
    if (originIp) {
      body = body.replace(/SERVER_PUBLIC_IP=127\.0\.0\.1/, `SERVER_PUBLIC_IP=${originIp}`);
    }
    await writeFile(envPath, body, "utf8");
  }
  emit(`PoGo stack mode: ${mode}`);
}

async function ensureSafePorts() {
  const envPath = path.join(POGO_DIR, ".env");
  let body = await readFile(envPath, "utf8");
  const dash = body.match(/^DASHBOARD_PORT=(.*)$/m)?.[1]?.trim();
  const api = body.match(/^ACCOUNT_API_PORT=(.*)$/m)?.[1]?.trim();
  if (!dash || dash === "8080") {
    body = upsertEnvLine(body, "DASHBOARD_PORT", "18080");
  }
  if (!api || api === "4242") {
    body = upsertEnvLine(body, "ACCOUNT_API_PORT", "14242");
  }
  await writeFile(envPath, body, "utf8");
}

const MAPPING_SERVICES = ["golbat", "rotom", "reactmap", "poracle", "dragonite", "koji"];
const WORKER_SERVICES = ["redroid-1", "redroid-2", "worker-agent", "houndour"];

function composeLogPath() {
  return path.join(POGO_DIR, "compose-install.log");
}

function spawnCompose(cmd, args, timeoutMs = 1_800_000) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(composeLogPath(), { flags: "a" });
    log.write(`\n==> ${cmd} ${args.join(" ")}\n`);
    const child = spawn(cmd, args, {
      cwd: POGO_DIR,
      env: process.env,
    });
    let tail = "";
    const onData = (buf) => {
      const text = buf.toString();
      tail = `${tail}${text}`.slice(-12_000);
      log.write(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timed out after ${Math.round(timeoutMs / 60000)}m. Last output:\n${tail}`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      log.end();
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      log.end();
      if (code === 0) resolve(tail);
      else reject(new Error(`exit ${code}. ${composeFailureDetail() || `Last output:\n${tail}`}`));
    });
  });
}

function composeFailureDetail() {
  try {
    const raw = readFileSync(composeLogPath(), "utf8");
    const lines = raw.split("\n");
    const interesting = lines.filter((line) =>
      /error|failed|fatal|address already|no space|denied|unhealthy|cannot/i.test(line),
    );
    const hits = interesting.slice(-25).join("\n");
    const tail = lines.slice(-30).join("\n");
    return `Log:\n${hits || tail}`.slice(-4000);
  } catch {
    return "";
  }
}

async function composeUp(services, profiles = []) {
  const runner = await resolveComposeRunner();
  const args = [...runner.prefix];
  for (const p of profiles) args.push("--profile", p);
  args.push("up", "-d", "--build", ...services);
  const label = services.join(", ");
  emit(`Starting ${label}`);
  await spawnCompose(runner.cmd, args);
}

async function startStack(mode) {
  const warnings = [];
  await runStep("Start MariaDB + Redis", async () => {
    await composeUp(["mariadb", "redis"]);
  });
  await runStep("Start account-api", async () => {
    await composeUp(["account-api"]);
  });
  await runStep("Start dashboard", async () => {
    await composeUp(["dashboard"]);
  });
  if (mode === "core") return warnings;

  for (const svc of MAPPING_SERVICES) {
    try {
      await composeUp([svc], ["mapping"]);
    } catch (e) {
      const detail = execDetail(e).slice(0, 500);
      warnings.push(`${svc}: ${detail}`);
      emit(`WARN: mapping service ${svc} failed — continuing. ${detail}`);
    }
  }

  if (mode === "full" || mode === "workers") {
    try {
      await composeUp(WORKER_SERVICES, ["workers"]);
    } catch (e) {
      const detail = execDetail(e).slice(0, 800);
      warnings.push(`workers: ${detail}`);
      emit(`WARN: Redroid workers failed — core/mapping stay up. ${detail}`);
    }
  }
  return warnings;
}

async function renderConfig() {
  const script = path.join(POGO_DIR, "scripts", "render-config.sh");
  await runStep("Render PoGo config", async () => {
    await exec("bash", [script], { cwd: POGO_DIR, timeout: 120_000 });
  });
}

async function ensurePogoSubdomain(parentDomain, user, subPrefix) {
  const host = `${subPrefix}.${parentDomain}`;
  const rows = await loadRegistry();
  if (rows.some((r) => r.name === host)) return host;
  const parentRow = rows.find((r) => r.name === parentDomain);
  if (!parentRow) fail(`Unknown parent domain: ${parentDomain}`);
  rows.push({
    name: host,
    user,
    disabled: false,
    plan: parentRow.plan || "Default",
    type: "sub",
    parent: parentDomain,
    isDefault: false,
  });
  await saveRegistry(rows);
  await mkdir(domainConfigDir(host), { recursive: true });
  await mkdir(path.join(`/home/${user}`, "public_html"), { recursive: true });
  await reloadNginx(host, user);
  return host;
}

/**
 * Install bundled PoGo stack from integrations/pogo-stack (one-click app store).
 */
export async function pogoStackInstall(domain, payloadJson) {
  const parent = String(domain || "").trim().toLowerCase();
  if (!parent) fail("domain required");
  if (!(await access(POGO_DIR).then(() => true).catch(() => false))) {
    fail(`Missing ${POGO_DIR} — update Qadbak to latest release.`);
  }

  const payload = parsePayload(payloadJson);
  const subPrefix = String(payload.subdomain || "pogo").trim() || "pogo";
  const mode = String(payload.mode || "full").trim();
  if (!["core", "mapping", "full", "workers"].includes(mode)) {
    fail("Invalid mode — use core, mapping, workers, or full");
  }

  const { user } = await resolveDomainUser(parent);
  const pogoHost = await runStep("Create PoGo subdomain", async () =>
    ensurePogoSubdomain(parent, user, subPrefix),
  );

  await ensureDocker();
  await ensureHostPrep(mode === "full" || mode === "workers");
  await ensureEnv(mode);
  await ensureSafePorts();
  const { arch, arm } = await applyRedroidArchEnv();
  await renderConfig();
  const warnings = await startStack(mode);

  const dashboardPort = await runStep("Configure reverse proxy + TLS", async () =>
    ensureDashboardProxy(pogoHost, user),
  );

  const originIp = process.env.QADBAK_ORIGIN_IP?.trim() || "";
  if (originIp) {
    await dnsAdd(parent, { name: subPrefix, type: "A", value: originIp }).catch(() => {});
  }

  const adminUrl = `https://${pogoHost}/`;
  const postInstall = buildPostInstall(mode, pogoHost, { arch, arm, warnings });
  const state = {
    installedAt: new Date().toISOString(),
    domain: parent,
    pogoHost,
    mode,
    arch,
    dashboardPort,
    stackDir: POGO_DIR,
    warnings,
    postInstall,
  };
  await writeState(state);

  const result = { adminUrl, pogoHost, mode, postInstall, warnings };
  emit({ ok: true, ...result });
  return result;
}

function buildPostInstall(mode, host, { arch, arm, warnings } = {}) {
  const lines = [
    `Dashboard: https://${host}/`,
    "Add Pokémon GO accounts in the dashboard or via Account API.",
  ];
  if (mode === "full" || mode === "workers") {
    lines.push(
      "Place cosmog.apk (and optional pogo.apk) in integrations/pogo-stack/services/cosmog/apk/ then restart worker-agent.",
    );
    if (arm) {
      lines.push("ARM64 host: Magisk Redroid image is used for Cosmog workers.");
    } else {
      lines.push(
        `x86 host (${arch || "amd64"}): official Redroid amd64 is used so Full can start. Cosmog/PoGo ARM APKs work more reliably on ARM64.`,
      );
    }
  }
  if (mode !== "core") {
    lines.push("Run scripts/install-dragonite.sh for the Dragonite binary (closed source).");
  }
  if (warnings?.length) {
    lines.push(`Some services had warnings (see ${composeLogPath()}): ${warnings.length} skipped.`);
  }
  return lines;
}

export async function pogoStackStatus() {
  const state = await readState();
  if (!state) {
    emit({ installed: false });
    return { installed: false };
  }
  let containers = "unknown";
  try {
    const { stdout } = await exec(
      "docker",
      ["compose", "ps", "--format", "json"],
      { cwd: POGO_DIR, timeout: 60_000 },
    );
    containers = stdout.trim() ? "running" : "stopped";
  } catch {
    containers = "error";
  }
  const out = { installed: true, ...state, containers };
  emit(out);
  return out;
}

/** Called from update-qadbak.sh when PoGo stack is installed. */
export async function pogoStackUpdate() {
  const state = await readState();
  if (!state) return { updated: false, reason: "not_installed" };
  if (!(await access(POGO_DIR).then(() => true).catch(() => false))) {
    return { updated: false, reason: "missing_stack_dir" };
  }
  await applyRedroidArchEnv();
  await ensureSafePorts();
  await renderConfig();
  await startStack(state.mode || "full");

  const pogoHost = state.pogoHost || (state.domain ? `pogo.${state.domain}` : "");
  if (pogoHost && state.domain) {
    try {
      const { user } = await resolveDomainUser(state.domain);
      const dashboardPort = await ensureDashboardProxy(pogoHost, user);
      state.dashboardPort = dashboardPort;
      emit(`Re-applied nginx proxy ${pogoHost} → 127.0.0.1:${dashboardPort}`);
    } catch (e) {
      emit(`WARN: could not re-apply PoGo proxy: ${execDetail(e).slice(0, 500)}`);
    }
  }

  state.updatedAt = new Date().toISOString();
  await writeState(state);
  const result = { updated: true, mode: state.mode, pogoHost };
  emit(result);
  return result;
}
