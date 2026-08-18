import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { dnsAdd } from "./provision-dns.mjs";
import { sslIssueBestEffort } from "./provision-ssl.mjs";
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
import { assertComposePolicyYaml } from "./compose-policy.mjs";

const exec = promisify(execFile);

function parsePayload(payloadJson) {
  if (!payloadJson) return {};
  try {
    const o = JSON.parse(payloadJson);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function jellyfinPortForDomain(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i += 1) {
    h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  }
  return 18000 + (h % 2000);
}

async function uidGid(user) {
  const { stdout: uid } = await exec("id", ["-u", user]);
  const { stdout: gid } = await exec("id", ["-g", user]);
  return { uid: uid.trim(), gid: gid.trim() };
}

async function ensureDocker() {
  const script = path.join(QADBAK_DIR, "scripts", "lib", "ensure-docker.sh");
  if (!(await access(script).then(() => true).catch(() => false))) {
    fail(`Missing ${script}`);
  }
  try {
    await exec("bash", [script], { timeout: 600_000 });
  } catch (e) {
    fail(
      `Docker is required for Jellyfin: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
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

async function reloadNginx(domain, user) {
  const script = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  await exec("bash", [script, domain, user], { timeout: 120_000 });
}

function resolveSafeMediaPath(home, requested) {
  const raw = String(requested || "").trim();
  if (!raw) fail("media path required");
  const resolved = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.normalize(path.join(home, raw));
  const homeNorm = path.normalize(home);
  if (resolved !== homeNorm && !resolved.startsWith(`${homeNorm}${path.sep}`)) {
    fail("Media path must stay inside the domain home directory.");
  }
  return resolved;
}

function mediaPathRelative(home, absPath) {
  const rel = path.relative(home, absPath);
  return rel === "" ? "." : rel;
}

async function dirUsageBytes(target) {
  try {
    const { stdout } = await exec("du", ["-sb", target], { timeout: 120_000 });
    return parseInt(stdout.split(/\s+/)[0] || "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function countMediaFiles(target) {
  try {
    const { stdout } = await exec(
      "bash",
      ["-c", `find ${JSON.stringify(target)} -type f 2>/dev/null | wc -l`],
      { timeout: 60_000 },
    );
    return parseInt(stdout.trim() || "0", 10) || 0;
  } catch {
    return 0;
  }
}

async function dockerContainerStatus(name) {
  try {
    const { stdout } = await exec(
      "docker",
      ["inspect", "-f", "{{.State.Status}}", name],
      { timeout: 15_000 },
    );
    return stdout.trim() || "unknown";
  } catch {
    return "not_found";
  }
}

function buildCompose({ user, uid, gid, port, configDir, cacheDir, mediaDir }) {
  return `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: qadbak-jellyfin-${user}
    environment:
      - PUID=${uid}
      - PGID=${gid}
      - TZ=UTC
    ports:
      - "127.0.0.1:${port}:8096"
    volumes:
      - ${configDir}:/config
      - ${cacheDir}:/cache
      - ${mediaDir}:/media
    restart: unless-stopped
`;
}

async function resolveJellyfinContext(domain) {
  const name = String(domain || "")
    .trim()
    .toLowerCase();
  let cfg = await readDomainConfigJson(name, "jellyfin.json", null);
  if (cfg) return { parent: name, cfg };

  const rows = await loadRegistry();
  const row = rows.find((r) => String(r.name).toLowerCase() === name);
  if (row?.parent) {
    const parent = String(row.parent).toLowerCase();
    cfg = await readDomainConfigJson(parent, "jellyfin.json", null);
    if (cfg) return { parent, cfg };
  }
  return { parent: name, cfg: null };
}

async function readDiskLimitMb(domain) {
  const limits = await readDomainConfigJson(domain, "limits.json", {});
  const rows = await loadRegistry();
  const hit = rows.find((r) => String(r.name).toLowerCase() === domain.toLowerCase());
  const raw = limits.disk ?? hit?.disk_limit ?? "";
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function ensureMediaSubdomain(parentDomain, user, subPrefix) {
  const mediaHost = `${subPrefix}.${parentDomain}`;
  const rows = await loadRegistry();
  if (rows.some((r) => r.name === mediaHost)) {
    return mediaHost;
  }
  const parentRow = rows.find((r) => r.name === parentDomain);
  if (!parentRow) fail(`Unknown parent domain: ${parentDomain}`);

  rows.push({
    name: mediaHost,
    user,
    disabled: false,
    plan: parentRow.plan || "Default",
    type: "sub",
    parent: parentDomain,
    isDefault: false,
  });
  await saveRegistry(rows);

  const home = `/home/${user}`;
  await mkdir(domainConfigDir(mediaHost), { recursive: true });
  await mkdir(path.join(home, "public_html"), { recursive: true });
  await reloadNginx(mediaHost, user);
  return mediaHost;
}

/**
 * Phase A — Jellyfin media server on media.{domain} with Docker + nginx reverse proxy.
 */
export async function jellyfinInstall(domain, payloadJson) {
  const parent = String(domain || "")
    .trim()
    .toLowerCase();
  if (!parent) fail("domain required");
  const payload = parsePayload(payloadJson);
  const subPrefix = String(payload.subdomain || "media").trim() || "media";
  const { user, home } = await resolveDomainUser(parent);

  const mediaHost = await ensureMediaSubdomain(parent, user, subPrefix);
  const port = jellyfinPortForDomain(parent);
  const appsDir = path.join(home, "apps", "jellyfin");
  const configDir = path.join(appsDir, "config");
  const cacheDir = path.join(appsDir, "cache");
  const libCfg = await readDomainConfigJson(parent, "media-library.json", {});
  const mediaDir = resolveSafeMediaPath(
    home,
    libCfg.mediaPath || path.join(home, "media"),
  );

  await mkdir(configDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });

  const { uid, gid } = await uidGid(user);
  const composePath = path.join(appsDir, "docker-compose.yml");
  const compose = buildCompose({
    user,
    uid,
    gid,
    port,
    configDir,
    cacheDir,
    mediaDir,
  });
  assertComposePolicyYaml(compose);
  await writeFile(composePath, compose, "utf8");
  await exec("chown", ["-R", `${user}:${user}`, appsDir, mediaDir], {
    timeout: 120_000,
  });

  await ensureDocker();
  await exec("docker", ["compose", "-f", composePath, "pull"], {
    timeout: 600_000,
  }).catch(() => {});
  await exec("docker", ["compose", "-f", composePath, "up", "-d"], {
    timeout: 600_000,
  });

  const originIp = process.env.QADBAK_ORIGIN_IP?.trim() || "";
  if (originIp) {
    await dnsAdd(parent, { name: subPrefix, type: "A", value: originIp }).catch(
      () => {},
    );
  }

  await upsertProxy(mediaHost, "/", `http://127.0.0.1:${port}`, true);
  await reloadNginx(mediaHost, user);
  await sslIssueBestEffort(mediaHost, mediaHost);

  const cfg = {
    parentDomain: parent,
    subdomain: mediaHost,
    subPrefix,
    port,
    mediaPath: mediaDir,
    composePath,
    installedAt: new Date().toISOString(),
  };
  await writeDomainConfigJson(parent, "jellyfin.json", cfg);
  await writeDomainConfigJson(parent, "media-library.json", {
    mediaPath: mediaDir,
    updatedAt: cfg.installedAt,
  });

  const installed = await readDomainConfigJson(parent, "scripts.json", []);
  const row = {
    name: "jellyfin",
    path: "apps/jellyfin",
    installedAt: cfg.installedAt,
    adminUrl: `https://${mediaHost}/`,
  };
  const idx = installed.findIndex((s) => s.name === "jellyfin");
  if (idx >= 0) installed[idx] = row;
  else installed.push(row);
  await writeDomainConfigJson(parent, "scripts.json", installed);

  emit({
    ok: true,
    domain: parent,
    subdomain: mediaHost,
    adminUrl: `https://${mediaHost}/`,
    mediaPath: mediaDir,
    port,
    postInstall: [
      `Upload films to ${mediaDir} via Domains → Files.`,
      `Open https://${mediaHost}/ and complete the Jellyfin setup wizard.`,
      "Add a media library pointing at /media inside Jellyfin.",
      "Use the Jellyfin apps on phone/TV with your server URL.",
    ],
  });
}

/** Phase B — media library panel: status, quota, Jellyfin link. */
export async function jellyfinStatus(domain) {
  const name = String(domain || "")
    .trim()
    .toLowerCase();
  if (!name) fail("domain required");

  const { parent, cfg } = await resolveJellyfinContext(name);
  const { user, home } = await resolveDomainUser(parent);
  const libCfg = await readDomainConfigJson(parent, "media-library.json", {});
  const defaultMediaPath = resolveSafeMediaPath(
    home,
    libCfg.mediaPath || cfg?.mediaPath || path.join(home, "media"),
  );

  const diskLimitMb = await readDiskLimitMb(parent);
  const homeUsedBytes = await dirUsageBytes(home);
  const mediaUsedBytes = await dirUsageBytes(defaultMediaPath);
  const mediaFileCount = await countMediaFiles(defaultMediaPath);

  if (!cfg) {
    emit({
      ok: true,
      installed: false,
      parentDomain: parent,
      mediaPath: defaultMediaPath,
      mediaPathRelative: mediaPathRelative(home, defaultMediaPath),
      mediaUsedBytes,
      mediaFileCount,
      diskLimitMb,
      homeUsedBytes,
      installUrl: "/admin/apps/jellyfin/install",
    });
    return;
  }

  const mediaPath = cfg.mediaPath || defaultMediaPath;
  const containerStatus = await dockerContainerStatus(`qadbak-jellyfin-${user}`);

  emit({
    ok: true,
    installed: true,
    parentDomain: parent,
    subdomain: cfg.subdomain,
    adminUrl: cfg.subdomain ? `https://${cfg.subdomain}/` : undefined,
    mediaPath,
    mediaPathRelative: mediaPathRelative(home, mediaPath),
    mediaUsedBytes: await dirUsageBytes(mediaPath),
    mediaFileCount: await countMediaFiles(mediaPath),
    diskLimitMb,
    homeUsedBytes,
    containerStatus,
    installedAt: cfg.installedAt,
    port: cfg.port,
  });
}

/** Phase B — choose or move the media upload folder. */
export async function jellyfinSetMediaPath(domain, payloadJson) {
  const name = String(domain || "")
    .trim()
    .toLowerCase();
  if (!name) fail("domain required");
  const payload = parsePayload(payloadJson);
  const mediaPathInput = String(payload.mediaPath || "").trim();
  if (!mediaPathInput) fail("mediaPath required");

  const { parent, cfg } = await resolveJellyfinContext(name);
  const { user, home } = await resolveDomainUser(parent);
  const mediaDir = resolveSafeMediaPath(home, mediaPathInput);

  await mkdir(mediaDir, { recursive: true });
  await exec("chown", ["-R", `${user}:${user}`, mediaDir], { timeout: 120_000 });

  const updatedAt = new Date().toISOString();
  await writeDomainConfigJson(parent, "media-library.json", {
    mediaPath: mediaDir,
    updatedAt,
  });

  if (!cfg) {
    emit({
      ok: true,
      installed: false,
      parentDomain: parent,
      mediaPath: mediaDir,
      mediaPathRelative: mediaPathRelative(home, mediaDir),
      message: "Media folder saved. Install Jellyfin from the App store to start streaming.",
    });
    return;
  }

  const appsDir = path.join(home, "apps", "jellyfin");
  const composePath = cfg.composePath || path.join(appsDir, "docker-compose.yml");
  const configDir = path.join(appsDir, "config");
  const cacheDir = path.join(appsDir, "cache");
  const port = cfg.port || jellyfinPortForDomain(parent);
  const { uid, gid } = await uidGid(user);
  const compose = buildCompose({
    user,
    uid,
    gid,
    port,
    configDir,
    cacheDir,
    mediaDir,
  });
  assertComposePolicyYaml(compose);
  await writeFile(composePath, compose, "utf8");
  await exec("chown", [`${user}:${user}`, composePath], { timeout: 30_000 }).catch(
    () => {},
  );

  await ensureDocker();
  await exec("docker", ["compose", "-f", composePath, "up", "-d"], {
    timeout: 600_000,
  });

  const nextCfg = { ...cfg, mediaPath: mediaDir, updatedAt };
  await writeDomainConfigJson(parent, "jellyfin.json", nextCfg);

  emit({
    ok: true,
    installed: true,
    parentDomain: parent,
    subdomain: cfg.subdomain,
    adminUrl: cfg.subdomain ? `https://${cfg.subdomain}/` : undefined,
    mediaPath: mediaDir,
    mediaPathRelative: mediaPathRelative(home, mediaDir),
    containerStatus: await dockerContainerStatus(`qadbak-jellyfin-${user}`),
    message:
      "Media folder updated. Existing files were not moved — copy them manually if needed.",
  });
}

const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "m4v", "mov"]);

function videoMime(name) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const map = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
  };
  return map[ext] ?? "video/mp4";
}

async function resolveMediaRoot(parent, cfg) {
  const { home } = await resolveDomainUser(parent);
  const libCfg = await readDomainConfigJson(parent, "media-library.json", {});
  const mediaRoot = resolveSafeMediaPath(
    home,
    libCfg.mediaPath || cfg?.mediaPath || path.join(home, "media"),
  );
  return { home, mediaRoot, mediaRelative: mediaPathRelative(home, mediaRoot) };
}

/** Phase C — list playable video files in the media library folder. */
export async function jellyfinListVideos(domain) {
  const name = String(domain || "")
    .trim()
    .toLowerCase();
  if (!name) fail("domain required");

  const { parent, cfg } = await resolveJellyfinContext(name);
  const { mediaRoot, mediaRelative } = await resolveMediaRoot(parent, cfg);

  try {
    await mkdir(mediaRoot, { recursive: true });
  } catch {
    /* */
  }

  const videos = [];
  const { home } = await resolveDomainUser(parent);
  try {
    const { stdout } = await exec(
      "bash",
      [
        "-c",
        `find ${JSON.stringify(mediaRoot)} -type f \\( -iname '*.mp4' -o -iname '*.webm' -o -iname '*.ogv' -o -iname '*.m4v' -o -iname '*.mov' \\) -printf '%p\\t%s\\n' 2>/dev/null | head -200`,
      ],
      { timeout: 120_000 },
    );
    for (const line of stdout.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const abs = line.slice(0, tab);
      const sizeBytes = parseInt(line.slice(tab + 1), 10) || 0;
      const base = path.basename(abs);
      if (!VIDEO_EXT.has(fileExt(base))) continue;
      videos.push({
        path: mediaPathRelative(home, abs),
        name: base,
        sizeBytes,
        mime: videoMime(base),
      });
    }
  } catch {
    /* empty list */
  }

  videos.sort((a, b) => a.name.localeCompare(b.name, "en"));

  emit({
    ok: true,
    parentDomain: parent,
    mediaPathRelative: mediaRelative,
    videos,
  });
}

function fileExt(name) {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/** Phase C — validate a panel-relative video path for streaming. */
export async function jellyfinStreamResolve(domain, payloadJson) {
  const name = String(domain || "")
    .trim()
    .toLowerCase();
  if (!name) fail("domain required");
  const payload = parsePayload(payloadJson);
  const rel = String(payload.path || payload.relativePath || "").trim();
  if (!rel) fail("path required");

  const { parent, cfg } = await resolveJellyfinContext(name);
  const { home, mediaRoot } = await resolveMediaRoot(parent, cfg);
  const abs = resolveSafeMediaPath(home, rel);
  const rootNorm = path.normalize(mediaRoot);
  if (abs !== rootNorm && !abs.startsWith(`${rootNorm}${path.sep}`)) {
    fail("Video must be inside the media library folder.");
  }

  const base = path.basename(abs);
  if (!VIDEO_EXT.has(fileExt(base))) {
    fail("Unsupported video format.");
  }

  let sizeBytes = 0;
  try {
    const { stdout } = await exec("stat", ["-c", "%s", abs], { timeout: 15_000 });
    sizeBytes = parseInt(stdout.trim(), 10) || 0;
  } catch {
    fail("Video file not found.");
  }
  if (sizeBytes <= 0) fail("Video file is empty.");

  emit({
    ok: true,
    absPath: abs,
    path: mediaPathRelative(home, abs),
    name: base,
    sizeBytes,
    mime: videoMime(base),
  });
}

