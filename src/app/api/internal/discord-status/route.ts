import { NextResponse } from "next/server";
import { discordBotStatusAuthorized } from "@/lib/internal-api-auth";
import { getDiscordStatusSnapshot } from "@/lib/discord-status-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Host snapshot for the Discord bot container (Bearer token, no session). */
export async function GET(request: Request) {
  if (!discordBotStatusAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  try {
    const snapshot = await getDiscordStatusSnapshot();
    return NextResponse.json(snapshot);
  } catch {
    return NextResponse.json({ error: "Status unavailable." }, { status: 503 });
  }
}
