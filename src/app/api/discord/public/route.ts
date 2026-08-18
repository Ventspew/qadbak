import { requireAdmin } from "@/lib/admin-api";
import { handleApiError, jsonOk } from "@/lib/api";
import { applyNoStoreHeaders } from "@/lib/discord-admin-oauth";
import { discordAdminRedirectUri, panelPublicOrigin } from "@/lib/panel-origin";

export const dynamic = "force-dynamic";

/** Admin-only. Never expose the host invite URL without a session. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const origin = panelPublicOrigin(request);
    return applyNoStoreHeaders(
      jsonOk({
        configured: false,
        inviteUrl: "",
        invite: "",
        redirectUri: discordAdminRedirectUri(origin),
        publicInvite: false,
      }),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
