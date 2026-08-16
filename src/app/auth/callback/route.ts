import { handleDiscordAdminOAuthCallback } from "@/lib/discord-admin-oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleDiscordAdminOAuthCallback(request);
}
