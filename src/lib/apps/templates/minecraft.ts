import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import type { AppTemplate } from "../types";

const PACKS = new Set([
  "paper",
  "vanilla",
  "fabric-perf",
  "fabric",
  "create",
  "cobblemon",
  "neoforge",
  "forge",
]);

export const minecraftTemplate: AppTemplate = {
  id: "minecraft",
  label: "Minecraft Java",
  tagline: "One-click Java server — Vanilla, Paper plugins, or Fabric/Forge mods.",
  icon: "⛏️",
  description:
    "Installs a Java Edition Minecraft server in Docker. Pick a complete package: " +
    "official Vanilla, Paper (drop plugins), Fabric Performance, Create, Cobblemon, " +
    "or an empty Fabric/Forge/NeoForge mods folder. Players join mc.yourdomain.com, " +
    "can log in with Discord, and receive join/leave and online/offline updates in DMs. " +
    "The game uses TCP 25565.",
  etaSeconds: 240,
  inputs: [
    {
      name: "domain",
      label: "Primary domain",
      type: "domain",
      required: true,
      help: "Existing domain. Join address becomes mc.example.com (or your subdomain).",
    },
    {
      name: "subdomain",
      label: "Join subdomain",
      type: "text",
      defaultValue: "mc",
      pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$",
      help: "Default mc → mc.example.com in Multiplayer.",
    },
    {
      name: "pack",
      label: "Server package",
      type: "select",
      required: true,
      defaultValue: "paper",
      options: [
        { value: "paper", label: "Paper — plugins (recommended, just works)" },
        { value: "vanilla", label: "Vanilla — official Mojang, no mods" },
        { value: "fabric-perf", label: "Fabric Performance — Lithium, Krypton, Spark" },
        { value: "fabric", label: "Fabric — empty mods folder (drop JARs)" },
        { value: "create", label: "Create — factories (Fabric 1.20.1)" },
        { value: "cobblemon", label: "Cobblemon — Pokémon in Minecraft" },
        { value: "neoforge", label: "NeoForge — empty modern mods folder" },
        { value: "forge", label: "Forge — empty Forge mods folder" },
      ],
      help: "Paper = plugins. Fabric/Forge/NeoForge = mods. Create and Cobblemon include the mods already.",
    },
    {
      name: "memory",
      label: "RAM",
      type: "select",
      required: true,
      defaultValue: "4G",
      options: [
        { value: "2G", label: "2 GB — Vanilla / small Paper" },
        { value: "4G", label: "4 GB — recommended" },
        { value: "8G", label: "8 GB — Create, Cobblemon, heavy modpacks" },
      ],
    },
    {
      name: "onlineMode",
      label: "Online mode (official Minecraft accounts)",
      type: "boolean",
      defaultValue: "true",
      help: "Keep on unless you run a cracked/offline LAN. Official accounts recommended.",
    },
    {
      name: "extraMods",
      label: "Extra Modrinth mods (optional)",
      type: "text",
      placeholder: "lithium,spark",
      help: "Comma-separated Modrinth slugs. Ignored on Vanilla and Paper. Fabric/Forge/NeoForge only.",
    },
    {
      name: "discordBotToken",
      label: "Discord bot token (optional)",
      type: "password",
      help: "From Discord Developer Portal → Bot. Enables login + DM updates for every player.",
    },
    {
      name: "discordClientId",
      label: "Discord OAuth client ID (optional)",
      type: "text",
      help: "Same application → OAuth2. Redirect: https://mc.yourdomain/auth/callback",
    },
    {
      name: "discordClientSecret",
      label: "Discord OAuth client secret (optional)",
      type: "password",
    },
    {
      name: "discordInvite",
      label: "Discord invite URL (optional)",
      type: "text",
      placeholder: "https://discord.gg/...",
      help: "Players may need to join this server before the bot can DM them.",
    },
  ],
  async install({ input }) {
    const domain = input.domain?.trim().toLowerCase();
    const subdomain = (input.subdomain || "mc").trim().toLowerCase();
    const pack = (input.pack || "paper").trim();
    const memory = (input.memory || "4G").trim();
    if (!domain) throw new Error("Domain is required.");
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      throw new Error("Invalid subdomain prefix.");
    }
    if (!PACKS.has(pack)) throw new Error(`Unknown package "${pack}".`);

    const result = (await runProvisioningHelper(
      "minecraft-install",
      domain,
      JSON.stringify({
        subdomain,
        pack,
        memory,
        onlineMode: input.onlineMode,
        extraMods: input.extraMods || "",
        discordBotToken: input.discordBotToken || "",
        discordClientId: input.discordClientId || "",
        discordClientSecret: input.discordClientSecret || "",
        discordInvite: input.discordInvite || "",
      }),
    )) as {
      adminUrl?: string;
      subdomain?: string;
      joinAddress?: string;
      packLabel?: string;
      rconPassword?: string;
      dataDir?: string;
      postInstall?: string[];
    };

    const host = result.subdomain ?? `${subdomain}.${domain}`;
    const credentials = [
      {
        label: "Join address (Java Edition)",
        value: result.joinAddress || host,
        isSecret: false,
      },
    ];
    if (result.dataDir) {
      credentials.push({
        label: "Mods / plugins folder",
        value: result.dataDir,
        isSecret: false,
      });
    }
    if (result.rconPassword) {
      credentials.push({
        label: "RCON password",
        value: result.rconPassword,
        isSecret: true,
      });
    }

    return {
      domain,
      primaryUrl: result.adminUrl ?? `https://${host}/`,
      credentials,
      postInstall:
        result.postInstall?.join(" ") ??
        `Join with Minecraft Java Edition at ${result.joinAddress || host}. First boot takes a few minutes.`,
    };
  },
};
