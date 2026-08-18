import { auditLog } from "@/lib/audit";
import {
  checkLoginRateLimit,
  recordLoginRateLimitFailure,
} from "@/lib/api-rate-limit";
import { jsonError, jsonOk } from "@/lib/api";
import { getClientIp } from "@/lib/client-ip";
import {
  applySessionCookie,
  createSession,
  signLoginTotpChallenge,
  verifyLoginTotpChallenge,
} from "@/lib/session";
import { verifyTotpCode } from "@/lib/totp";
import { requireAdminTotp } from "@/lib/security-config";
import { getPanelPolicy } from "@/lib/panel-policy";
import { findUserById, findUserByUsername, verifyPassword, isWeakPasswordLoginBlocked } from "@/lib/users";

async function authFailureDelay(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 300);
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
      loginToken?: string;
      totp?: string;
    };

    const clientIp = (await getClientIp()) ?? "unknown";

    if (body.loginToken && body.totp) {
      const userId = await verifyLoginTotpChallenge(body.loginToken);
      if (!userId) {
        return jsonError("Sign-in challenge expired. Enter password again.", 401);
      }
      const user = await findUserById(userId);
      if (!user?.totpSecret) {
        return jsonError("Two-factor is not enabled for this account.", 401);
      }
      const totpRl = await checkLoginRateLimit(clientIp, user.username);
      if (!totpRl.ok) {
        await auditLog(user.username, "login-rate-limited", undefined, clientIp);
        return jsonError(
          `Too many sign-in attempts. Try again in ${totpRl.retryAfterSec ?? 900} seconds.`,
          429,
        );
      }
      if (!verifyTotpCode(user.totpSecret, body.totp)) {
        await authFailureDelay();
        await recordLoginRateLimitFailure(clientIp, user.username);
        await auditLog(user.username, "login-totp-failed", undefined, clientIp);
        return jsonError("Invalid authenticator code.", 401);
      }
      const token = await createSession({
        userId: user.id,
        username: user.username,
        role: user.role,
        domains: user.domains,
      });
      const response = jsonOk({
        username: user.username,
        role: user.role,
        domains: user.domains,
      });
      applySessionCookie(response, token, request);
      await auditLog(user.username, "login");
      return response;
    }

    if (!body.username || !body.password) {
      return jsonError("Username and password are required.");
    }

    const loginRl = await checkLoginRateLimit(clientIp, body.username);
    if (!loginRl.ok) {
      await auditLog(body.username, "login-rate-limited", undefined, clientIp);
      return jsonError(
        `Too many login attempts. Try again in ${loginRl.retryAfterSec ?? 900} seconds.`,
        429,
      );
    }

    const user = await findUserByUsername(body.username);
    if (!user || !(await verifyPassword(user, body.password))) {
      await recordLoginRateLimitFailure(clientIp, body.username);
      await authFailureDelay();
      await auditLog(body.username, "login-failed", undefined, clientIp);
      return jsonError("Invalid credentials.", 401);
    }

    if (isWeakPasswordLoginBlocked(body.password)) {
      await auditLog(body.username, "login-weak-password-blocked", user.id, clientIp);
      return jsonError(
        "This account uses a default password. Change it on the server (data/users.json) before signing in.",
        403,
      );
    }

    if (user.role === "admin" && requireAdminTotp() && !user.totpSecret) {
      return jsonError(
        "Administrator sign-in requires two-factor authentication. Enable TOTP under Account → Security.",
        403,
      );
    }

    const panelPolicy = await getPanelPolicy();
    if (user.role === "client" && panelPolicy.requireClientTotp && !user.totpSecret) {
      return jsonError(
        "Your hosting provider requires two-factor authentication. Enable TOTP under Account → Security before signing in.",
        403,
      );
    }

    if (user.totpSecret) {
      const loginToken = await signLoginTotpChallenge(user.id);
      return jsonOk({ requiresTotp: true, loginToken });
    }

    const token = await createSession({
      userId: user.id,
      username: user.username,
      role: user.role,
      domains: user.domains,
    });

    const response = jsonOk({
      username: user.username,
      role: user.role,
      domains: user.domains,
    });
    applySessionCookie(response, token, request);

    await auditLog(user.username, "login");

    return response;
  } catch (err) {
    if (err instanceof Error && err.message.includes("SESSION_SECRET")) {
      return jsonError(err.message, 500);
    }
    return jsonError("Sign-in failed.", 500);
  }
}
