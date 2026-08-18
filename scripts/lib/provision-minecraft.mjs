import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { dnsAdd } from "./provision-dns.mjs";
import { sslIssueBestEffort } from "./provision-ssl.mjs";
import { ensureSharedSubdomain, publishSharedSubDocroot } from "./ensure-shared-subdomain.mjs";
import { sharedSubDocroot } from "./domain-docroot.mjs";
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

/** Curated one-click Java packages. Mods are Fabric/Forge/NeoForge; Paper uses plugins. */
export const MINECRAFT_PACKS = {
  paper: {
    type: "PAPER",
    version: "LATEST",
    label: "Paper — plugins (recommended)",
    motd: "Qadbak Paper",
    folder: "plugins",
  },
  vanilla: {
    type: "VANILLA",
    version: "LATEST",
    label: "Vanilla — official Mojang",
    motd: "Qadbak Vanilla",
    folder: null,
  },
  "fabric-perf": {
    type: "FABRIC",
    version: "LATEST",
    label: "Fabric Performance — Lithium, Krypton, Spark",
    motd: "Qadbak Fabric Performance",
    modrinth: "lithium,ferrite-core,krypton,spark",
    folder: "mods",
  },
  fabric: {
    type: "FABRIC",
    version: "LATEST",
    label: "Fabric — empty mods folder",
    motd: "Qadbak Fabric",
    folder: "mods",
  },
  create: {
    type: "FABRIC",
    version: "1.20.1",
    label: "Create — factories (Fabric 1.20.1)",
    motd: "Qadbak Create",
    modrinth: "fabric-api,create",
    folder: "mods",
    heavy: true,
  },
  cobblemon: {
    type: "FABRIC",
    version: "1.21.1",
    label: "Cobblemon — Pokémon in Minecraft",
    motd: "Qadbak Cobblemon",
    modrinth: "fabric-api,cobblemon",
    folder: "mods",
    heavy: true,
  },
  neoforge: {
    type: "NEOFORGE",
    version: "LATEST",
    label: "NeoForge — drop modern mods",
    motd: "Qadbak NeoForge",
    folder: "mods",
    heavy: true,
  },
  forge: {
    type: "FORGE",
    version: "LATEST",
    label: "Forge — drop Forge mods",
    motd: "Qadbak Forge",
    folder: "mods",
    heavy: true,
  },
};

function parsePayload(payloadJson) {
  if (!payloadJson) return {};
  try {
    const o = JSON.parse(payloadJson);
    return typeof o === "object" && o ? o : {};
  } catch {
    return {};
  }
}

function yamlQuote(s) {
  return JSON.stringify(String(s ?? ""));
}

function parseBool(v, fallback = true) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function sanitizeMods(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9_-]+$/.test(s));
}

function parsePort(raw) {
  const n = parseInt(String(raw || "").trim(), 10);
  if (Number.isFinite(n) && n >= 25565 && n <= 25665) return n;
  return 25565;
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

function notifyPortForDomain(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i += 1) h = (h * 31 + domain.charCodeAt(i)) >>> 0;
  return 18700 + (h % 800);
}

function sanitizeSecret(raw) {
  return String(raw || "").trim().replace(/[\r\n]/g, "");
}

async function loadPanelDiscordNotify() {
  try {
    const raw = await readFile(path.join(QADBAK_DIR, "data", "discord-notify.json"), "utf8");
    const o = JSON.parse(raw);
    return {
      botToken: String(o.botToken || "").trim(),
      clientId: String(o.clientId || "").trim(),
      clientSecret: String(o.clientSecret || "").trim(),
      invite: String(o.invite || "").trim(),
    };
  } catch {
    return { botToken: "", clientId: "", clientSecret: "", invite: "" };
  }
}

async function copyNotifyApp(dest) {
  const src = path.join(QADBAK_DIR, "integrations", "minecraft-notify");
  if (!(await access(src).then(() => true).catch(() => false))) {
    fail(`Missing ${src}`);
  }
  await mkdir(dest, { recursive: true });
  await exec("cp", ["-a", `${src}/.`, dest], { timeout: 30_000 });
}

function parseMemory(raw) {
  const s = String(raw || "4G").trim().toUpperCase();
  if (["2G", "4G", "8G"].includes(s)) return s;
  return "4G";
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
    fail(`Docker is required for Minecraft: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function openFirewall(port) {
  const script = path.join(QADBAK_DIR, "scripts", "open-host-firewall-port.sh");
  if (!(await access(script).then(() => true).catch(() => false))) return;
  await exec("bash", [script, String(port)], { timeout: 30_000 }).catch(() => {
    emit(`WARN: could not open host firewall TCP ${port}`);
  });
}

async function reloadNginx(domain, user) {
  const script = path.join(QADBAK_DIR, "scripts", "apply-domain-nginx.sh");
  await exec("bash", [script, domain, user], { timeout: 120_000 });
}

async function ensureMcSubdomain(parentDomain, user, subPrefix) {
  return ensureSharedSubdomain(parentDomain, user, subPrefix);
}

function landingHtml({ joinHost, port, packLabel, motd }) {
  const join = port === 25565 ? joinHost : `${joinHost}:${port}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${motd}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; min-height:100vh; display:grid; place-items:center; }
    main { max-width: 36rem; padding: 2rem; }
    h1 { font-size: 1.75rem; margin: 0 0 .5rem; }
    p { color:#94a3b8; line-height:1.5; }
    code { display:block; background:#1e293b; color:#f8fafc; padding:1rem 1.25rem; border-radius:.75rem; font-size:1.15rem; letter-spacing:.02em; }
    .tag { display:inline-block; background:#334155; color:#cbd5e1; font-size:.8rem; padding:.2rem .55rem; border-radius:999px; margin-bottom:1rem; }
  </style>
</head>
<body>
  <main>
    <span class="tag">${packLabel}</span>
    <h1>Java Minecraft server</h1>
    <p>Open Minecraft Java Edition → Multiplayer → Add server, then paste:</p>
    <code>${join}</code>
    <p>Bedrock / phone edition is not this package. Extra mods: drop <code style="display:inline;padding:.15rem .4rem;font-size:.9rem">.jar</code> files in the server mods or plugins folder on the VPS, then restart the container.</p>
  </main>
</body>
</html>
`;
}

function dropReadme(folder) {
  if (folder === "mods") {
    return `Drop Fabric / Forge / NeoForge mod JARs in this folder, then:

  cd ~/apps/minecraft && docker compose restart

Client and server mods must match (same Minecraft version + loader).
Performance mods like Lithium are server-side only.
`;
  }
  if (folder === "plugins") {
    return `Drop Paper / Spigot plugin JARs in this folder, then:

  cd ~/apps/minecraft && docker compose restart

Do not mix Forge/Fabric mods into a Paper server.
`;
  }
  return `Vanilla has no mods folder. Switch package to Paper, Fabric, Forge, or NeoForge to add extras.
`;
}

function buildCompose({
  user,
  uid,
  gid,
  port,
  dataDir,
  pack,
  extraMods,
  memory,
  onlineMode,
  rconPassword,
  motd,
  notifyDir,
  notifyPort,
  publicUrl,
  joinAddress,
  packLabel,
  discordBotToken,
  discordClientId,
  discordClientSecret,
  discordInvite,
  sessionSecret,
  hostDiscordClientId,
}) {
  const projects = [
    ...(pack.modrinth ? pack.modrinth.split(",") : []),
    ...extraMods,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = [...new Set(projects)];
  const env = [
    `      EULA: "TRUE"`,
    `      TYPE: ${yamlQuote(pack.type)}`,
    `      VERSION: ${yamlQuote(pack.version)}`,
    `      MEMORY: ${yamlQuote(memory)}`,
    `      MOTD: ${yamlQuote(motd)}`,
    `      ONLINE_MODE: ${onlineMode ? '"TRUE"' : '"FALSE"'}`,
    `      ENABLE_RCON: "TRUE"`,
    `      RCON_PASSWORD: ${yamlQuote(rconPassword)}`,
    `      USE_AIKAR_FLAGS: "TRUE"`,
    `      TZ: UTC`,
    `      UID: ${yamlQuote(uid)}`,
    `      GID: ${yamlQuote(gid)}`,
    `      MAX_PLAYERS: "20"`,
    `      VIEW_DISTANCE: "10"`,
    `      MODRINTH_DOWNLOAD_DEPENDENCIES: "required"`,
  ];
  if (unique.length) {
    env.push(`      MODRINTH_PROJECTS: ${yamlQuote(unique.join(","))}`);
  }
  if (pack.heavy) {
    env.push(`      MAX_TICK_TIME: "-1"`);
  }
  return `services:
  mc:
    image: itzg/minecraft-server:java21
    container_name: qadbak-mc-${user}
    restart: unless-stopped
    tty: true
    stdin_open: true
    ports:
      - "0.0.0.0:${port}:25565"
    environment:
${env.join("\n")}
    volumes:
      - ${dataDir}:/data
    healthcheck:
      test: ["CMD-SHELL", "mc-health"]
      interval: 30s
      timeout: 10s
      retries: 20
      start_period: 180s
  notify:
    build: ${notifyDir}
    container_name: qadbak-mc-notify-${user}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${notifyPort}:8787"
    environment:
      PUBLIC_URL: ${yamlQuote(publicUrl)}
      JOIN_ADDRESS: ${yamlQuote(joinAddress)}
      PACK_LABEL: ${yamlQuote(packLabel)}
      MOTD: ${yamlQuote(motd)}
      HOST_DISCORD_CLIENT_ID: ${yamlQuote(hostDiscordClientId)}
      DISCORD_BOT_TOKEN: ${yamlQuote(discordBotToken)}
      DISCORD_CLIENT_ID: ${yamlQuote(discordClientId)}
      DISCORD_CLIENT_SECRET: ${yamlQuote(discordClientSecret)}
      DISCORD_GUILD_INVITE: ${yamlQuote(discordInvite)}
      SESSION_SECRET: ${yamlQuote(sessionSecret)}
      LOG_PATH: /data/logs/latest.log
      SUBSCRIBERS_PATH: /data/discord-subscribers.json
      MC_HOST: mc
      MC_PORT: "25565"
    volumes:
      - ${dataDir}:/data
    depends_on:
      - mc
`;
}

export async function minecraftInstall(domain, payloadJson) {
  const parent = String(domain || "").trim().toLowerCase();
  if (!parent) fail("domain required");
  const payload = parsePayload(payloadJson);
  const subPrefix = String(payload.subdomain || "mc").trim() || "mc";
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subPrefix)) {
    fail("Invalid subdomain prefix.");
  }
  const packId = String(payload.pack || "paper").trim();
  const pack = MINECRAFT_PACKS[packId];
  if (!pack) fail(`Unknown pack "${packId}".`);
  const memory = parseMemory(payload.memory);
  const onlineMode = parseBool(payload.onlineMode, true);
  const extraMods = sanitizeMods(payload.extraMods);
  if ((pack.type === "VANILLA" || pack.type === "PAPER") && extraMods.length) {
    emit("WARN: extra Modrinth mods are ignored on Vanilla/Paper — use Fabric, Forge, or NeoForge.");
  }
  const port = parsePort(payload.port);
  const { user, home } = await resolveDomainUser(parent);
  const mcHost = await ensureMcSubdomain(parent, user, subPrefix);

  const appsDir = path.join(home, "apps", "minecraft");
  const dataDir = path.join(appsDir, "data");
  const wwwDir = sharedSubDocroot(home, mcHost);
  await mkdir(dataDir, { recursive: true });
  await mkdir(wwwDir, { recursive: true });
  if (pack.folder) {
    await mkdir(path.join(dataDir, pack.folder), { recursive: true });
    await writeFile(path.join(dataDir, pack.folder, "README.txt"), dropReadme(pack.folder));
  }

  const existing = await readDomainConfigJson(parent, "minecraft.json", null);
  const rconPassword =
    existing?.rconPassword || `mc-${randomBytes(12).toString("hex")}`;
  const sessionSecret =
    existing?.sessionSecret || randomBytes(24).toString("hex");
  const panelDiscord = await loadPanelDiscordNotify();
  let discordBotToken =
    sanitizeSecret(payload.discordBotToken) || existing?.discordBotToken || "";
  let discordClientId =
    sanitizeSecret(payload.discordClientId) || existing?.discordClientId || "";
  let discordClientSecret =
    sanitizeSecret(payload.discordClientSecret) || existing?.discordClientSecret || "";
  let discordInvite =
    sanitizeSecret(payload.discordInvite) || existing?.discordInvite || "";
  if (
    (panelDiscord.clientId && discordClientId === panelDiscord.clientId) ||
    (panelDiscord.botToken && discordBotToken === panelDiscord.botToken)
  ) {
    emit(
      "WARN: refusing panel host Discord app on the public Minecraft page — use a separate Discord application.",
    );
    discordBotToken = "";
    discordClientId = "";
    discordClientSecret = "";
    discordInvite = "";
  }
  const motd = pack.motd;
  const join = port === 25565 ? mcHost : `${mcHost}:${port}`;
  const publicUrl = `https://${mcHost}`;
  const notifyPort = notifyPortForDomain(parent);
  const notifyDir = path.join(appsDir, "notify");
  await copyNotifyApp(notifyDir);
  const { uid, gid } = await uidGid(user);
  const composePath = path.join(appsDir, "docker-compose.yml");
  const compose = buildCompose({
    user,
    uid,
    gid,
    port,
    dataDir,
    pack,
    extraMods: pack.type === "VANILLA" || pack.type === "PAPER" ? [] : extraMods,
    memory,
    onlineMode,
    rconPassword,
    motd,
    notifyDir,
    notifyPort,
    publicUrl,
    joinAddress: join,
    packLabel: pack.label,
    discordBotToken,
    discordClientId,
    discordClientSecret,
    discordInvite,
    sessionSecret,
    hostDiscordClientId: panelDiscord.clientId || "",
  });
  assertComposePolicyYaml(compose);
  await writeFile(composePath, compose, "utf8");

  await publishSharedSubDocroot(home, mcHost, user, path.join(appsDir, "www"));
  await writeFile(
    path.join(wwwDir, "index.html"),
    landingHtml({
      joinHost: mcHost,
      port,
      packLabel: pack.label,
      motd,
    }),
    "utf8",
  );
  await exec("chown", ["-R", `${user}:${user}`, appsDir, wwwDir], { timeout: 60_000 });

  await ensureDocker();
  await openFirewall(port);
  await exec("docker", ["compose", "-f", composePath, "build", "notify"], {
    timeout: 600_000,
  }).catch((e) => emit(`WARN: notify build: ${e instanceof Error ? e.message : String(e)}`));
  await exec("docker", ["compose", "-f", composePath, "up", "-d"], {
    timeout: 600_000,
  });

  const originIp = process.env.QADBAK_ORIGIN_IP?.trim() || "";
  if (originIp) {
    await dnsAdd(parent, { name: subPrefix, type: "A", value: originIp }).catch(() => {});
  }

  await writeDomainConfigJson(mcHost, "website.json", {
    webRoot: wwwDir,
    mode: "static",
    wwwRedirect: "none",
  });
  await upsertProxy(mcHost, "/", `http://127.0.0.1:${notifyPort}/`, false);
  await reloadNginx(mcHost, user);
  await sslIssueBestEffort(mcHost, mcHost);

  const cfg = {
    parentDomain: parent,
    subdomain: mcHost,
    subPrefix,
    pack: packId,
    port,
    notifyPort,
    memory,
    onlineMode,
    extraMods,
    rconPassword,
    sessionSecret,
    discordBotToken,
    discordClientId,
    discordClientSecret,
    discordInvite,
    discordEnabled: Boolean(discordBotToken && discordClientId && discordClientSecret),
    composePath,
    dataDir,
    installedAt: new Date().toISOString(),
  };
  await writeDomainConfigJson(parent, "minecraft.json", cfg);

  const installed = await readDomainConfigJson(parent, "scripts.json", []);
  const row = {
    name: "minecraft",
    path: "apps/minecraft",
    installedAt: cfg.installedAt,
    adminUrl: `https://${mcHost}/`,
  };
  const idx = installed.findIndex((s) => s.name === "minecraft");
  if (idx >= 0) installed[idx] = row;
  else installed.push(row);
  await writeDomainConfigJson(parent, "scripts.json", installed);

  const extras =
    pack.folder === "mods"
      ? `Drop extra .jar mods in ${path.join(dataDir, "mods")} then: docker compose -f ${composePath} restart`
      : pack.folder === "plugins"
        ? `Drop Paper plugins in ${path.join(dataDir, "plugins")} then: docker compose -f ${composePath} restart`
        : "Vanilla has no mods. Reinstall with Paper or Fabric to add extras.";

  const result = {
    ok: true,
    domain: parent,
    subdomain: mcHost,
    adminUrl: `https://${mcHost}/`,
    joinAddress: join,
    pack: packId,
    packLabel: pack.label,
    port,
    memory,
    rconPassword,
    dataDir,
    discordEnabled: Boolean(discordBotToken && discordClientId && discordClientSecret),
    discordLogin: `https://${mcHost}/login`,
    postInstall: [
      `Join in Java Edition: ${join}`,
      `Status page: https://${mcHost}/`,
      extras,
      discordBotToken && discordClientId
        ? `Players log in with Discord at https://${mcHost}/login and get join/leave + online/offline DMs. Redirect URI: https://${mcHost}/auth/callback`
        : `Add a Discord application (bot token + OAuth2 client id/secret) and re-run this install to enable DM updates. Redirect URI: https://${mcHost}/auth/callback`,
      "First boot downloads the server jar (1–3 minutes). Open TCP 25565 on the provider firewall if players cannot connect.",
      pack.heavy && memory === "2G"
        ? "This pack is heavy — raise RAM to 4G or 8G if it crashes."
        : "",
    ].filter(Boolean),
  };
  emit(result);
  return result;
}

export async function minecraftStatus(domain) {
  const name = String(domain || "").trim().toLowerCase();
  if (!name) fail("domain required");
  const rows = await loadRegistry();
  const row = rows.find((r) => String(r.name).toLowerCase() === name);
  const parent = row?.parent ? String(row.parent).toLowerCase() : name;
  const cfg = await readDomainConfigJson(parent, "minecraft.json", null);
  if (!cfg) {
    emit({ ok: true, installed: false, parentDomain: parent });
    return;
  }
  let containerStatus = "unknown";
  try {
    const { user } = await resolveDomainUser(parent);
    const { stdout } = await exec(
      "docker",
      ["inspect", "-f", "{{.State.Status}}", `qadbak-mc-${user}`],
      { timeout: 15_000 },
    );
    containerStatus = stdout.trim() || "unknown";
  } catch {
    containerStatus = "not_found";
  }
  emit({
    ok: true,
    installed: true,
    parentDomain: cfg.parentDomain,
    subdomain: cfg.subdomain,
    pack: cfg.pack,
    port: cfg.port,
    memory: cfg.memory,
    discordEnabled: Boolean(cfg.discordEnabled),
    containerStatus,
    joinAddress: cfg.port === 25565 ? cfg.subdomain : `${cfg.subdomain}:${cfg.port}`,
    installedAt: cfg.installedAt,
  });
}
