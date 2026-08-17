import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { applyNoStoreHeaders } from "@/lib/discord-admin-oauth";
import {
  DISCORD_OAUTH_COOKIE,
  discordOAuthConfigured,
  loadDiscordNotifyConfig,
  signDiscordOAuthState,
} from "@/lib/discord-notify";
import { discordAdminRedirectUri, panelPublicOrigin } from "@/lib/panel-origin";

export const dynamic = "force-dynamic";

/** Public Discord OAuth start — works on every Qadbak panel, no admin session. */
export async function GET(request: Request) {
  const origin = panelPublicOrigin(request);
  const redirectUri = discordAdminRedirectUri(origin);
  const cfg = await loadDiscordNotifyConfig();
  if (!discordOAuthConfigured(cfg)) {
    return applyNoStoreHeaders(
      NextResponse.redirect(`${origin}/discord?discord=need-oauth`),
    );
  }
  const state = `${randomBytes(16).toString("hex")}.public`;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });
  const res = applyNoStoreHeaders(
    NextResponse.redirect(
      `https://discord.com/oauth2/authorize?${params.toString()}`,
    ),
  );
  res.cookies.set(DISCORD_OAUTH_COOKIE, signDiscordOAuthState(state), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
