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
import { discordAdminRedirectUri, panelPublicOrigin } from "@/lib/panel-origin";

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
  const fail = (code: string) =>
    clearOauthCookie(
      NextResponse.redirect(`${origin}/admin/discord?discord=${code}`),
      secure,
    );

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim() || "";
    const state = url.searchParams.get("state")?.trim() || "";
    const jar = await cookies();
    const cookieVal = jar.get(DISCORD_OAUTH_COOKIE)?.value || "";
    if (!code || !state || !verifyDiscordOAuthState(cookieVal, state)) {
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
      NextResponse.redirect(`${origin}/admin/discord?discord=linked`),
      secure,
    );
  } catch {
    return fail("error");
  }
}
