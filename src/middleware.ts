import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { installFingerprintTag } from "./lib/install-salt";
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  bearerTokenFromAuthorizationHeader,
  sessionCookieNames,
} from "./lib/session-cookies";
import {
  clientRbacEnabled,
  isClientBlockedPath,
} from "./middleware/client-rbac";
import { demoMutationBlocked } from "./middleware/demo-readonly";
import {
  clientMutationBlocked,
  csrfCheckFailed,
} from "./middleware/request-security";
import { applySecurityHeaders } from "./middleware/security-headers";
import { sessionSecretMinLength } from "./lib/security-config";
import { isSessionRevokedAtEdge } from "./lib/session-revocation-middleware";

export const runtime = "nodejs";

const PUBLIC_EXACT = new Set([
  "/",
  "/login",
  "/about",
  "/privacy",
  "/refund",
  "/terms",
  "/api/auth/login",
  "/api/auth/mobile",
  "/api/auth/mobile/refresh",
  "/api/health",
  "/api/branding",
  "/api/newsletter/subscribe",
  "/api/newsletter/confirm",
  "/api/newsletter/unsubscribe",
  "/api/newsletter/track",
  "/api/contact/submit",
  "/api/demo/info",
  "/api/internal/session-revocation",
  "/api/internal/discord-status",
  "/api/admin/discord/callback",
  "/auth/callback",
  "/discord",
  "/landing.css",
  "/landing.js",
  "/favicon.svg",
  "/logo.svg",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (/\/git-webhook$/.test(pathname)) return true;
  if (pathname.startsWith("/api/branding")) return true;
  if (pathname.startsWith("/api/auth/mobile")) return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname.startsWith("/assets/")) return true;
  return false;
}

function sessionTokenFromRequest(request: NextRequest): string | undefined {
  for (const name of sessionCookieNames()) {
    const value = request.cookies.get(name)?.value;
    if (value) return value;
  }
  return bearerTokenFromAuthorizationHeader(
    request.headers.get("authorization"),
  ) ?? undefined;
}

function isApiV1Path(pathname: string): boolean {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

function getSecret(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  const min =
    process.env.NODE_ENV === "production" ? sessionSecretMinLength() : 16;
  if (!secret || secret.length < min) return null;
  return new TextEncoder().encode(secret);
}

function passPathname(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-qadbak-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function finish(request: NextRequest, response: NextResponse): NextResponse {
  const tag = installFingerprintTag();
  if (tag) response.headers.set("X-QB-Tag", tag);
  return applySecurityHeaders(request, response);
}

function clientForbiddenResponse(request: NextRequest, pathname: string) {
  if (pathname.startsWith("/api/")) {
    return finish(
      request,
      NextResponse.json(
        { error: "This action is only available to administrators." },
        { status: 403 },
      ),
    );
  }
  return finish(
    request,
    NextResponse.redirect(new URL("/dashboard", request.url)),
  );
}

function csrfForbidden(request: NextRequest) {
  return finish(
    request,
    NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 }),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (csrfCheckFailed(request)) {
    return csrfForbidden(request);
  }

  if (isPublicPath(pathname)) {
    return finish(request, passPathname(request));
  }

  if (isApiV1Path(pathname)) {
    return finish(request, passPathname(request));
  }

  let token = sessionTokenFromRequest(request);
  const secret = getSecret();

  if (!token || !secret) {
    if (pathname.startsWith("/api/")) {
      return finish(
        request,
        NextResponse.json({ error: "Not logged in." }, { status: 401 }),
      );
    }
    return finish(
      request,
      NextResponse.redirect(new URL("/login", request.url)),
    );
  }

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const jti = payload.jti ? String(payload.jti) : undefined;
    const userId = String(payload.userId ?? "");
    const iat =
      typeof payload.iat === "number" ? payload.iat : Math.floor(Date.now() / 1000);
    if (await isSessionRevokedAtEdge(request, jti, userId, iat)) {
      if (pathname.startsWith("/api/")) {
        return finish(
          request,
          NextResponse.json({ error: "Session revoked." }, { status: 401 }),
        );
      }
      return finish(
        request,
        NextResponse.redirect(new URL("/login", request.url)),
      );
    }
    const role = String(payload.role ?? "");
    const username = String(payload.username ?? "");
    if (demoMutationBlocked(pathname, request.method, username)) {
      return finish(
        request,
        NextResponse.json(
          {
            error:
              "Demo panel is read-only. Install Qadbak on your own VPS to make changes.",
          },
          { status: 403 },
        ),
      );
    }
    if (role === "client" && clientRbacEnabled()) {
      if (isClientBlockedPath(pathname)) {
        return clientForbiddenResponse(request, pathname);
      }
      if (clientMutationBlocked(pathname, request.method)) {
        return clientForbiddenResponse(request, pathname);
      }
    }
    return finish(request, passPathname(request));
  } catch {
    if (pathname.startsWith("/api/")) {
      return finish(
        request,
        NextResponse.json({ error: "Session expired." }, { status: 401 }),
      );
    }
    return finish(
      request,
      NextResponse.redirect(new URL("/login", request.url)),
    );
  }
}

export const config = {
  // Skip multipart upload routes so Next does not buffer the whole body in
  // middleware (default 10MB truncate caused HTML 500 on zip uploads).
  // Auth still runs in the route handlers via requireDomainApi / requireSession.
  matcher: [
    "/((?!_next/static|_next/image|.*\\/files\\/upload$|.*\\/backups\\/upload$).*)",
  ],
};
