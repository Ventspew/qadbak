import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import type { AppTemplate } from "../types";

export const discordBotTemplate: AppTemplate = {
  id: "discord-bot",
  label: "Discord Bot",
  tagline: "One-click hosted bot — invite it, then assign tasks without code.",
  icon: "🤖",
  description:
    "Hosts a Discord bot on your VPS. Paste a Developer Portal token once (or reuse the " +
    "panel bot), click Invite to add it to your server, then assign slash commands, " +
    "keyword replies, welcomes, and Qadbak alerts in the panel — no coding. " +
    "Public page at bot.yourdomain.com, plus /discord on the panel for invite and DM linking.",
  etaSeconds: 180,
  inputs: [
    {
      name: "domain",
      label: "Primary domain",
      type: "domain",
      required: true,
      help: "Existing domain. Status page becomes bot.example.com (or your subdomain).",
    },
    {
      name: "subdomain",
      label: "Bot subdomain",
      type: "text",
      defaultValue: "bot",
      pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$",
      help: "Default bot → bot.example.com",
    },
    {
      name: "botName",
      label: "Bot display name",
      type: "text",
      defaultValue: "Qadbak",
      help: "Shown on the public page and in DMs.",
    },
    {
      name: "discordBotToken",
      label: "Discord bot token (optional)",
      type: "password",
      help: "Leave empty to reuse the panel bot from /admin/discord.",
    },
    {
      name: "discordClientId",
      label: "Discord OAuth client ID (optional)",
      type: "text",
      help: "Leave empty to reuse panel Discord OAuth. Add both https://YOUR-PANEL/auth/callback and https://bot.yourdomain/auth/callback in the Discord Developer Portal.",
    },
    {
      name: "discordClientSecret",
      label: "Discord OAuth client secret (optional)",
      type: "password",
    },
    {
      name: "discordInvite",
      label: "Guild invite URL (optional)",
      type: "text",
      placeholder: "https://discord.gg/...",
      help: "Needed so the bot can DM people (they must share a server).",
    },
    {
      name: "taskAlerts",
      label: "Task: Qadbak host alerts (DMs)",
      type: "boolean",
      defaultValue: "true",
      help: "Disk, RAM, load, nginx/pm2, Docker, app installs, panel updates.",
    },
    {
      name: "taskStatus",
      label: "Task: slash /status",
      type: "boolean",
      defaultValue: "true",
      help: "Replies with disk, RAM, load, and Docker summary.",
    },
    {
      name: "taskMinecraft",
      label: "Task: slash /minecraft",
      type: "boolean",
      defaultValue: "true",
      help: "If a Minecraft app exists, replies online/offline (does not duplicate join/leave DMs).",
    },
  ],
  async install({ input }) {
    const domain = input.domain?.trim().toLowerCase();
    const subdomain = (input.subdomain || "bot").trim().toLowerCase();
    const botName = (input.botName || "Qadbak").trim() || "Qadbak";
    if (!domain) throw new Error("Domain is required.");
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      throw new Error("Invalid subdomain prefix.");
    }

    const result = (await runProvisioningHelper(
      "discord-bot-install",
      domain,
      JSON.stringify({
        subdomain,
        botName,
        discordBotToken: input.discordBotToken || "",
        discordClientId: input.discordClientId || "",
        discordClientSecret: input.discordClientSecret || "",
        discordInvite: input.discordInvite || "",
        taskAlerts: input.taskAlerts,
        taskStatus: input.taskStatus,
        taskMinecraft: input.taskMinecraft,
      }),
    )) as {
      adminUrl?: string;
      subdomain?: string;
      inviteUrl?: string;
      discordLogin?: string;
      botRedirectUri?: string;
      slashCommands?: string[];
      postInstall?: string[];
    };

    const host = result.subdomain ?? `${subdomain}.${domain}`;
    const credentials = [];
    if (result.inviteUrl) {
      credentials.push({
        label: "Invite the bot to Discord",
        value: result.inviteUrl,
        isSecret: false,
      });
    }
    credentials.push({
      label: "Public page",
      value: result.adminUrl ?? `https://${host}/`,
      isSecret: false,
    });
    if (result.discordLogin) {
      credentials.push({
        label: "Link Discord (DMs)",
        value: result.discordLogin,
        isSecret: false,
      });
    }
    if (result.botRedirectUri) {
      credentials.push({
        label: "OAuth redirect URI (Developer Portal)",
        value: result.botRedirectUri,
        isSecret: false,
      });
    }
    if (result.slashCommands?.length) {
      credentials.push({
        label: "Slash commands",
        value: result.slashCommands.join(" "),
        isSecret: false,
      });
    }

    return {
      domain,
      primaryUrl: result.inviteUrl || result.adminUrl || `https://${host}/`,
      secondaryUrl: result.adminUrl,
      credentials,
      postInstall:
        result.postInstall?.join(" ") ??
        `Open /admin/discord to assign more commands without code. Invite URL: ${result.inviteUrl || "save a client ID first"}.`,
    };
  },
};
