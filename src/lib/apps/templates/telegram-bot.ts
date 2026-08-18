import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import type { AppTemplate } from "../types";

export const telegramBotTemplate: AppTemplate = {
  id: "telegram-bot",
  label: "Telegram Bot",
  tagline: "Your BotFather bot, hosted — add it to your own group.",
  icon: "✈️",
  description:
    "Hosts a Telegram bot for this domain. Create a bot in BotFather (one per " +
    "customer), paste THAT token, then add the bot to YOUR group. Commands, " +
    "keyword replies, and host alerts need no code. Public page at " +
    "tg.yourdomain.com. This is not the Discord bot and does not reuse Discord tokens.",
  etaSeconds: 180,
  inputs: [
    {
      name: "domain",
      label: "Primary domain",
      type: "domain",
      required: true,
      help: "Existing domain. Status page becomes tg.example.com (or your subdomain).",
    },
    {
      name: "subdomain",
      label: "Bot subdomain",
      type: "text",
      defaultValue: "tg",
      pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$",
      help: "Default tg → tg.example.com. telegram.example.com also works.",
    },
    {
      name: "botName",
      label: "Bot display name",
      type: "text",
      defaultValue: "Qadbak",
      help: "Shown on the public page.",
    },
    {
      name: "telegramBotToken",
      label: "Telegram bot token",
      type: "password",
      required: true,
      help: "From BotFather → your bot → API token. Never reuse another customer's token.",
    },
    {
      name: "telegramBotUsername",
      label: "Bot username (optional)",
      type: "text",
      placeholder: "MyShopBot",
      help: "Without @. Must end with bot (e.g. qadbakbot). Leave blank — Qadbak reads the real username from the token.",
    },
    {
      name: "telegramChatId",
      label: "Default chat / group ID (optional)",
      type: "text",
      help: "Alerts also go here. Otherwise the bot remembers chats that send /start.",
    },
    {
      name: "taskAlerts",
      label: "Task: host alerts in Telegram",
      type: "boolean",
      defaultValue: "true",
      help: "Disk, RAM, load, Docker.",
    },
    {
      name: "taskStatus",
      label: "Task: /status",
      type: "boolean",
      defaultValue: "true",
    },
    {
      name: "taskMinecraft",
      label: "Task: /minecraft",
      type: "boolean",
      defaultValue: "true",
    },
    {
      name: "taskHelp",
      label: "Task: /help",
      type: "boolean",
      defaultValue: "true",
    },
    {
      name: "taskUptime",
      label: "Task: /uptime",
      type: "boolean",
      defaultValue: "true",
    },
  ],
  async install({ input }) {
    const domain = input.domain?.trim().toLowerCase();
    const subdomain = (input.subdomain || "tg").trim().toLowerCase();
    const botName = (input.botName || "Qadbak").trim() || "Qadbak";
    if (!domain) throw new Error("Domain is required.");
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      throw new Error("Invalid subdomain prefix.");
    }
    if (!input.telegramBotToken?.trim()) {
      throw new Error("Telegram bot token is required (your own BotFather bot).");
    }

    const result = (await runProvisioningHelper(
      "telegram-bot-install",
      domain,
      JSON.stringify({
        subdomain,
        botName,
        telegramBotToken: input.telegramBotToken || "",
        telegramBotUsername: input.telegramBotUsername || "",
        telegramChatId: input.telegramChatId || "",
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
      botUsername?: string;
      commands?: string[];
      postInstall?: string[];
    };

    const host = result.subdomain ?? `${subdomain}.${domain}`;
    const credentials = [];
    if (result.inviteUrl) {
      credentials.push({
        label: "Add this bot to YOUR Telegram group",
        value: result.inviteUrl,
        isSecret: false,
      });
    }
    credentials.push({
      label: "Public page",
      value: result.adminUrl ?? `https://${host}/`,
      isSecret: false,
    });
    if (result.botUsername) {
      credentials.push({
        label: "Bot username",
        value: `@${String(result.botUsername).replace(/^@/, "")}`,
        isSecret: false,
      });
    }
    if (result.commands?.length) {
      credentials.push({
        label: "Commands",
        value: result.commands.join(" "),
        isSecret: false,
      });
    }
    credentials.push({
      label: "Manage tasks in panel",
      value: `/domains/${domain}/telegram`,
      isSecret: false,
    });

    return {
      domain,
      primaryUrl: result.inviteUrl || result.adminUrl || `https://${host}/`,
      secondaryUrl: result.adminUrl,
      credentials,
      postInstall:
        result.postInstall?.join(" ") ??
        "Create the bot in BotFather, paste that token, then add the bot to your Telegram group. Edit commands later under this domain → Telegram.",
    };
  },
};
