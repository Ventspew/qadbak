import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-api";
import { handleApiError } from "@/lib/api";
import { applyNoStoreHeaders } from "@/lib/discord-admin-oauth";
import { panelPublicOrigin } from "@/lib/panel-origin";

export const dynamic = "force-dynamic";

/** Host Discord OAuth is admin-only — send stragglers to the admin login. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const origin = panelPublicOrigin(request);
    return applyNoStoreHeaders(
      NextResponse.redirect(`${origin}/api/admin/discord/login`),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
