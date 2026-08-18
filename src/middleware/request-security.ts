import type { NextRequest } from "next/server";
import { trustProxyHeaders } from "@/lib/security-config";
import { sessionCookieNames } from "@/lib/session-cookies";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Routes that accept cross-site or unauthenticated writes (no Origin check). */
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/mobile",
  "/api/health",
  "/api/branding",
  "/api/v1/",
  "/api/newsletter/",
  "/api/contact/",
  "/api/internal/",
] as const;

function isGitWebhook(pathname: string): boolean {
  return /\/git-webhook$/.test(pathname);
}

function isCsrfExempt(pathname: string): boolean {
  if (isGitWebhook(pathname)) return true;
  return CSRF_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function requestOrigin(request: NextRequest): string | null {
  // Use Host, not X-Forwarded-Host: a cross-site caller can spoof forwarded headers.
  const host =
    request.headers.get("host")?.trim() || request.nextUrl.host;
  if (!host) return null;
  const proto = trustProxyHeaders()
    ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (request.nextUrl.protocol === "https:" ? "https" : "http")
    : request.nextUrl.protocol === "https:"
      ? "https"
      : "http";
  return `${proto}://${host}`;
}

/** Block browser CSRF on session cookie API (same-origin Origin/Referer required). */
export function csrfCheckFailed(request: NextRequest): boolean {
  if (!MUTATING.has(request.method)) return false;
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/")) return false;
  if (isCsrfExempt(pathname)) return false;

  const auth = request.headers.get("authorization")?.trim();
  const hasBearer = Boolean(auth && /^Bearer\s+\S+/i.test(auth));
  const hasCookieSession = sessionCookieNames().some(
    (name) => Boolean(request.cookies.get(name)?.value),
  );
  // iOS / API-key clients send Bearer without Origin. Cookie sessions must not
  // skip CSRF just because a fake Authorization header is present.
  if (hasBearer && !hasCookieSession) return false;

  const expected = requestOrigin(request);
  if (!expected) return true;

  const origin = request.headers.get("origin")?.trim();
  if (origin && origin === expected) return false;

  const referer = request.headers.get("referer")?.trim();
  if (referer && (referer === expected || referer.startsWith(`${expected}/`))) {
    return false;
  }

  return true;
}

/** Extra API paths clients must never call (belt over handler checks). */
export function clientMutationBlocked(
  pathname: string,
  method: string,
): boolean {
  if (!MUTATING.has(method)) return false;
  if (pathname === "/api/domains") return true;
  if (/\/(enable|disable)$/.test(pathname)) return true;
  if (pathname.startsWith("/api/server/")) return true;
  return false;
}
