import { jsonOk } from "@/lib/api";
import { applyNoStoreHeaders } from "@/lib/discord-admin-oauth";
import { discordBotInviteUrl } from "@/lib/discord-bot-tasks";
import {
  discordOAuthConfigured,
  loadDiscordNotifyConfig,
} from "@/lib/discord-notify";
import { discordAdminRedirectUri, panelPublicOrigin } from "@/lib/panel-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cfg = await loadDiscordNotifyConfig();
  const origin = panelPublicOrigin(request);
  return applyNoStoreHeaders(
    jsonOk({
      configured: discordOAuthConfigured(cfg),
      inviteUrl: discordBotInviteUrl(cfg.clientId),
      invite: cfg.invite,
      redirectUri: discordAdminRedirectUri(origin),
    }),
  );
}
