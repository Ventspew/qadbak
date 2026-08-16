import { handleDiscordAdminOAuthCallback } from "@/lib/discord-admin-oauth";

export const dynamic = "force-dynamic";

/** Kept as an alias; panel OAuth uses /auth/callback to match Discord Portal. */
export async function GET(request: Request) {
  return handleDiscordAdminOAuthCallback(request);
}
