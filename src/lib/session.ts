import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import type { SessionPayload } from "./types";

import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  bearerTokenFromAuthorizationHeader,
  sessionCookieName,
  sessionCookieNames,
} from "./session-cookies";
import { MOBILE_ACCESS_TTL_SEC } from "./mobile-auth-constants";
import {
  sessionMaxAgeSec,
  sessionSameSite,
  sessionSecretMinLength,
} from "./security-config";

export { sessionCookieName, sessionCookieNames } from "./session-cookies";

/**
 * Cookie Secure flag is set per-request to match the actual response
 * protocol. This makes first-time installs over plain HTTP (e.g. the
 * bootstrap panel on http://<ip>:11000/login before the operator
 * configures HTTPS) work out of the box — browsers silently drop
 * Set-Cookie with Secure when the response was over HTTP, which would
 * otherwise prevent login.
 *
 * The QADBAK_COOKIE_SECURE env var still acts as an explicit override
 * (set "true" or "false") for operators who want to lock the behaviour.
 */
function isHttpsRequest(request?: Request | NextRequest): boolean {
  if (!request) return false;
  const xfp = request.headers.get("x-forwarded-proto");
  if (xfp) return xfp.toLowerCase().split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function sessionCookieSecure(request?: Request | NextRequest): boolean {
  if (process.env.QADBAK_COOKIE_SECURE === "false") return false;
  // Never mark cookies Secure on plain HTTP (e.g. bootstrap panel :11000) even when
  // .env.local has QADBAK_COOKIE_SECURE=true after certbot on the HTTPS vhost.
  if (request && !isHttpsRequest(request)) return false;
  if (process.env.QADBAK_COOKIE_SECURE === "true") return true;
  if (request) return isHttpsRequest(request);
  return process.env.NODE_ENV === "production";
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  const min = sessionSecretMinLength();
  if (!secret || secret.length < 16) {
    throw new Error(
      `SESSION_SECRET is missing or too short (min. 16 characters, ${min} recommended in production).`,
    );
  }
  if (process.env.NODE_ENV === "production" && secret.length < min) {
    throw new Error(
      `SESSION_SECRET must be at least ${min} characters in production.`,
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(payload: SessionPayload): Promise<string> {
  const maxAge = sessionMaxAgeSec();
  return new SignJWT({ ...payload, jti: randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secretKey());
}

/** Short-lived JWT for native apps (same claims as browser session). */
export async function createMobileAccessToken(
  payload: SessionPayload,
): Promise<string> {
  return new SignJWT({ ...payload, typ: "mobile-access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime(`${MOBILE_ACCESS_TTL_SEC}s`)
    .sign(secretKey());
}

export async function signLoginTotpChallenge(userId: string): Promise<string> {
  return new SignJWT({ typ: "totp-login", userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secretKey());
}

export async function verifyLoginTotpChallenge(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.typ !== "totp-login") return null;
    return String(payload.userId);
  } catch {
    return null;
  }
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const { isSessionRevoked, isUserSessionRevoked } = await import(
      "./session-revocation"
    );
    const jti = payload.jti ? String(payload.jti) : undefined;
    if (await isSessionRevoked(jti)) return null;
    const userId = String(payload.userId);
    const iat =
      typeof payload.iat === "number" ? payload.iat : Math.floor(Date.now() / 1000);
    if (await isUserSessionRevoked(userId, iat)) return null;
    const { findUserById } = await import("./users");
    const live = await findUserById(userId);
    if (!live) return null;
    return {
      userId,
      username: live.username,
      role: live.role,
      domains: live.domains ?? [],
      jti,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  let token: string | undefined;
  for (const name of sessionCookieNames()) {
    token = jar.get(name)?.value;
    if (token) break;
  }
  if (!token) {
    const hdrs = await headers();
    token = bearerTokenFromAuthorizationHeader(hdrs.get("authorization")) ?? undefined;
  }
  if (!token) return null;
  return verifySessionToken(token);
}

export function sessionCookieOptions(
  token: string,
  request?: Request | NextRequest,
) {
  return {
    name: sessionCookieName(),
    value: token,
    httpOnly: true,
    secure: sessionCookieSecure(request),
    sameSite: sessionSameSite(),
    path: "/",
    maxAge: sessionMaxAgeSec(),
  };
}

/** Attach session to a Route Handler response (required for browser login). */
export function applySessionCookie(
  response: NextResponse,
  token: string,
  request?: Request | NextRequest,
) {
  const opts = sessionCookieOptions(token, request);
  response.cookies.set(opts.name, opts.value, {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    maxAge: opts.maxAge,
  });
  for (const legacy of ["panel_session"]) {
    if (legacy === opts.name) continue;
    response.cookies.set(legacy, "", {
      httpOnly: true,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export function clearSessionCookieOptions(request?: Request | NextRequest) {
  return {
    name: sessionCookieName(),
    value: "",
    httpOnly: true,
    secure: sessionCookieSecure(request),
    sameSite: sessionSameSite(),
    path: "/",
    maxAge: 0,
  };
}

/** Clear every session cookie name (primary + legacy) on logout. */
export function clearAllSessionCookies(
  response: NextResponse,
  request?: Request | NextRequest,
) {
  const opts = clearSessionCookieOptions(request);
  const names = new Set(sessionCookieNames());
  names.add("panel_session");
  for (const name of names) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  const { checkSessionApiRateLimit } = await import("./api-session-rate-limit");
  const rl = await checkSessionApiRateLimit(session);
  if (!rl.ok) {
    const err = new Error(
      `Too many requests. Retry in ${rl.retryAfterSec ?? 60}s.`,
    );
    (err as Error & { status?: number }).status = 429;
    throw err;
  }
  return session;
}
