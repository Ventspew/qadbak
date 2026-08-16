import { auditLog } from "@/lib/audit";
import { requireAdmin } from "@/lib/admin-api";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import {
  discordBotInviteUrl,
  discoverDiscordUpdatesChannel,
  fetchDiscordBotPresence,
  listDiscordBotInstalls,
  loadDiscordBotRecipes,
  normalizeDiscordBotRecipes,
  registerDiscordSlashCommands,
  saveDiscordBotRecipes,
  sendDiscordChannelMessage,
  slashCommandsFromTasks,
} from "@/lib/discord-bot-tasks";
import {
  discordBotReady,
  dmAllLinkedSubscribers,
  listMergedSubscribers,
  loadDiscordNotifyConfig,
  mergeDiscordNotifyPatch,
  redactDiscordNotifyConfig,
  saveDiscordNotifyConfig,
} from "@/lib/discord-notify";
import { discordAdminRedirectUri, panelPublicOrigin } from "@/lib/panel-origin";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

export const dynamic = "force-dynamic";

async function publicPayload(request: Request) {
  const cfg = await loadDiscordNotifyConfig();
  const recipes = await loadDiscordBotRecipes();
  const redirectUri = discordAdminRedirectUri(panelPublicOrigin(request));
  const settings = {
    ...redactDiscordNotifyConfig(cfg, redirectUri),
    inviteUrl: discordBotInviteUrl(cfg.clientId),
  };
  const subscribers = await listMergedSubscribers();
  const installs = await listDiscordBotInstalls();
  const bot = cfg.botToken
    ? await fetchDiscordBotPresence(cfg.botToken)
    : { ok: false, username: "", id: "", guilds: [] };
  return {
    settings,
    subscribers,
    recipes,
    slashCommands: slashCommandsFromTasks(recipes),
    installs,
    bot,
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    return jsonOk(await publicPayload(request));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();
    const current = await loadDiscordNotifyConfig();
    const next = mergeDiscordNotifyPatch(current, await request.json());
    await saveDiscordNotifyConfig(next);
    await auditLog(session.username, "discord-notify-save");
    return jsonOk({ ok: true, ...(await publicPayload(request)) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const body = (await request.json()) as {
      action?: string;
      tasks?: unknown;
      botName?: string;
      channelId?: string;
      message?: string;
    };
    const action = body.action || "";

    if (action === "test") {
      const cfg = await loadDiscordNotifyConfig();
      if (!discordBotReady(cfg)) {
        return jsonError("Enable Discord and save a bot token first.", 400);
      }
      const result = await dmAllLinkedSubscribers(
        "[Qadbak] Test DM from the panel. If you can read this, host notifications are working.",
      );
      await auditLog(session.username, "discord-notify-test");
      if (result.sent === 0 && result.skipped === 0 && result.failed === 0) {
        return jsonError("No linked Discord users yet. Use Link my Discord first.", 400);
      }
      return jsonOk({ ok: true, ...result });
    }

    if (action === "test-channel") {
      const cfg = await loadDiscordNotifyConfig();
      if (!discordBotReady(cfg)) {
        return jsonError("Enable Discord and save a bot token first.", 400);
      }
      const channelId = await discoverDiscordUpdatesChannel(
        cfg.botToken,
        cfg.updatesChannelId,
      );
      if (!channelId) {
        return jsonError(
          "Bot is in 0 servers (or has no text channel). Click Invite / Add this bot to Discord first.",
          400,
        );
      }
      const sent = await sendDiscordChannelMessage({
        botToken: cfg.botToken,
        channelId,
        content:
          "[Qadbak] Test: channel updates work. If you see this, live server alerts will land here.",
      });
      if (!sent.ok) {
        return jsonError(
          sent.skipped
            ? "The bot cannot post in that channel. Give it Send Messages permission."
            : "Could not post in the Discord server.",
          502,
        );
      }
      if (!cfg.updatesChannelId) {
        await saveDiscordNotifyConfig({ ...cfg, updatesChannelId: channelId });
      }
      await auditLog(session.username, "discord-notify-test-channel");
      return jsonOk({ ok: true, channelId, ...(await publicPayload(request)) });
    }

    if (action === "save-tasks") {
      const recipes = normalizeDiscordBotRecipes({
        botName: body.botName,
        tasks: body.tasks,
      });
      await saveDiscordBotRecipes(recipes);
      let synced = 0;
      try {
        const helper = await runProvisioningHelper("discord-bot-sync-tasks");
        synced = Number((helper.synced as number | undefined) ?? 0);
      } catch {
        synced = 0;
      }
      await auditLog(session.username, "discord-bot-tasks-save");
      return jsonOk({ ok: true, synced, ...(await publicPayload(request)) });
    }

    if (action === "register-commands") {
      const cfg = await loadDiscordNotifyConfig();
      if (!cfg.botToken || !cfg.clientId) {
        return jsonError("Save a bot token and client ID first.", 400);
      }
      const recipes = await loadDiscordBotRecipes();
      const commands = slashCommandsFromTasks(recipes);
      const registered = await registerDiscordSlashCommands({
        botToken: cfg.botToken,
        applicationId: cfg.clientId,
        commands,
      });
      if (!registered.ok) {
        return jsonError(
          `Discord rejected slash command registration (HTTP ${registered.status ?? "?"}).`,
          502,
        );
      }
      try {
        await runProvisioningHelper("discord-bot-sync-tasks");
      } catch {
        /* recipes still saved locally */
      }
      await auditLog(session.username, "discord-bot-register-commands");
      return jsonOk({ ok: true, registered: registered.count, ...(await publicPayload(request)) });
    }

    if (action === "announce") {
      const cfg = await loadDiscordNotifyConfig();
      if (!cfg.botToken) return jsonError("Save a bot token first.", 400);
      const channelId = String(body.channelId || "").trim();
      const message = String(body.message || "").trim();
      if (!/^\d{5,32}$/.test(channelId)) {
        return jsonError("Channel ID must be a Discord snowflake.", 400);
      }
      if (!message) return jsonError("Message is required.", 400);
      const sent = await sendDiscordChannelMessage({
        botToken: cfg.botToken,
        channelId,
        content: `[Qadbak] ${message}`,
      });
      if (!sent.ok) {
        return jsonError(
          sent.skipped
            ? "The bot cannot post in that channel (missing access)."
            : "Could not send the announcement.",
          502,
        );
      }
      await auditLog(session.username, "discord-bot-announce");
      return jsonOk({ ok: true });
    }

    return jsonError("Unknown action.", 400);
  } catch (err) {
    return handleApiError(err);
  }
}
