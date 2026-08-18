import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import type { AppTemplate } from "../types";

export const discordBotTemplate: AppTemplate = {
  id: "discord-bot",
  label: "Discord Bot",
  tagline: "Your Discord application, hosted — invite it to your own server.",
  icon: "🤖",
  description:
    "Hosts a Discord bot for this domain. Create a Discord application in the " +
    "Developer Portal (one per customer), paste that token and client ID, then " +
    "invite the bot to YOUR server. Type !status in Discord, plus keywords, " +
    "and alerts are assigned without code. Public page at bot.yourdomain.com. " +
    "The panel /admin/discord bot is the host operator bot — not this app.",
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
      label: "Discord bot token",
      type: "password",
      required: true,
      help: "From YOUR Discord application → Bot. Never reuse another customer's token.",
    },
    {
      name: "discordClientId",
      label: "Discord application / client ID",
      type: "text",
      required: true,
      help: "Same application as the token. Redirect: https://bot.yourdomain/auth/callback",
    },
    {
      name: "discordClientSecret",
      label: "Discord OAuth client secret",
      type: "password",
      help: "Needed for “Link Discord” DMs on the public page.",
    },
    {
      name: "discordInvite",
      label: "Guild invite URL (optional)",
      type: "text",
      placeholder: "https://discord.gg/...",
      help: "Your Discord server invite so the bot can DM people who share that server.",
    },
    {
      name: "taskAlerts",
      label: "Task: host alerts in Discord",
      type: "boolean",
      defaultValue: "true",
      help: "Disk, RAM, load, nginx/pm2, Docker, app installs.",
    },
    {
      name: "taskStatus",
      label: "Task: !status",
      type: "boolean",
      defaultValue: "true",
    },
    {
      name: "taskMinecraft",
      label: "Task: !minecraft",
      type: "boolean",
      defaultValue: "true",
    },
    {
      name: "taskHelp",
      label: "Task: !help",
      type: "boolean",
      defaultValue: "true",
    },
    {
      name: "taskUptime",
      label: "Task: !uptime",
      type: "boolean",
      defaultValue: "true",
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
    if (!input.discordBotToken?.trim() || !input.discordClientId?.trim()) {
      throw new Error(
        "Bot token and application client ID are required (your own Discord application).",
      );
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
        taskHelp: input.taskHelp,
        taskUptime: input.taskUptime,
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
        label: "Invite this bot to YOUR Discord server",
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
        label: "OAuth redirect URI (this application only)",
        value: result.botRedirectUri,
        isSecret: false,
      });
    }
    if (result.slashCommands?.length) {
      credentials.push({
        label: "Commands",
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
        `Invite the bot to your Discord server, then add ${result.botRedirectUri || "https://bot.yourdomain/auth/callback"} in that application's OAuth2 redirects.`,
    };
  },
};
