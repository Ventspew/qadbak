import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_SESSION_REVOCATION_HEADER = "x-qadbak-internal";

export function internalSessionRevocationToken(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret)
    .update("qadbak-internal-session-revocation-v1")
    .digest("hex");
}

export function discordBotStatusToken(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHmac("sha256", secret)
    .update("qadbak-discord-bot-status-v1")
    .digest("hex");
}

export function discordBotStatusAuthorized(
  authorization: string | null | undefined,
): boolean {
  const expected = discordBotStatusToken();
  if (!expected || !authorization?.trim()) return false;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const got = match?.[1] ?? authorization.trim();
  try {
    const a = Buffer.from(got, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function internalRequestAuthorized(
  header: string | null | undefined,
): boolean {
  const expected = internalSessionRevocationToken();
  if (!expected || !header?.trim()) return false;
  try {
    const a = Buffer.from(header.trim(), "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
