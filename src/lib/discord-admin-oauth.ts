import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DISCORD_OAUTH_COOKIE,
  discordBotReady,
  discordOAuthConfigured,
  exchangeDiscordOAuthCode,
  loadDiscordNotifyConfig,
  sendDiscordDm,
  upsertPanelSubscriber,
  verifyDiscordOAuthState,
} from "@/lib/discord-notify";
import { discordOauthReturnPath } from "@/lib/discord-oauth-return";
import { discordAdminRedirectUri, panelPublicOrigin } from "@/lib/panel-origin";

export function applyNoStoreHeaders(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
  res.headers.set("CDN-Cache-Control", "no-store");
  return res;
}

function clearOauthCookie(res: NextResponse, secure: boolean) {
  res.cookies.set(DISCORD_OAUTH_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

/** Discord OAuth2 callback for panel linking (must match Developer Portal redirect). */
export async function handleDiscordAdminOAuthCallback(
  request: Request,
): Promise<NextResponse> {
  const origin = panelPublicOrigin(request);
  const redirectUri = discordAdminRedirectUri(origin);
  const secure = origin.startsWith("https://");
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim() || "";
    const state = url.searchParams.get("state")?.trim() || "";
    const dest = discordOauthReturnPath(state);
    const fail = (err: string) =>
      clearOauthCookie(
        applyNoStoreHeaders(
          NextResponse.redirect(`${origin}${dest}?discord=${err}`),
        ),
        secure,
      );

    const jar = await cookies();
    const cookieVal = jar.get(DISCORD_OAUTH_COOKIE)?.value || "";
    if (!code || !state || !(await verifyDiscordOAuthState(cookieVal, state))) {
      return fail("error");
    }
    const cfg = await loadDiscordNotifyConfig();
    if (!discordOAuthConfigured(cfg)) {
      return fail("need-oauth");
    }
    const user = await exchangeDiscordOAuthCode({
      code,
      redirectUri,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    });
    if (!user) return fail("error");
    await upsertPanelSubscriber(user);
    if (discordBotReady(cfg)) {
      const extra = cfg.invite
        ? `\nJoin the Discord first so DMs work: ${cfg.invite}`
        : "";
      await sendDiscordDm(
        cfg.botToken,
        user.id,
        `[Qadbak] Linked. You will get host, panel, and Docker updates here.${extra}`,
      ).catch(() => undefined);
    }
    return clearOauthCookie(
      applyNoStoreHeaders(
        NextResponse.redirect(`${origin}${dest}?discord=linked`),
      ),
      secure,
    );
  } catch {
    return clearOauthCookie(
      applyNoStoreHeaders(
        NextResponse.redirect(`${origin}/discord?discord=error`),
      ),
      secure,
    );
  }
}
