import { describe, expect, it } from "vitest";
import {
  mergeDiscordAppCredentials,
  mergeDiscordNotifyPatch,
  normalizeDiscordNotifyConfig,
  normalizeSubscribersFile,
  redactDiscordNotifyConfig,
  signDiscordOAuthState,
  verifyDiscordOAuthState,
} from "./discord-notify";

const SECRET = "test-session-secret-32chars-min";

describe("discord-notify config", () => {
  it("normalizes missing fields", () => {
    const cfg = normalizeDiscordNotifyConfig({});
    expect(cfg).toEqual({
      botToken: "",
      clientId: "",
      clientSecret: "",
      publicKey: "",
      invite: "",
      updatesChannelId: "",
      enabled: true,
    });
  });

  it("redacts tokens from public settings", () => {
    const cfg = normalizeDiscordNotifyConfig({
      botToken: "super-secret-bot-token",
      clientId: "123456789",
      clientSecret: "super-secret-client",
      invite: "https://discord.gg/abc",
      enabled: true,
    });
    const publicSettings = redactDiscordNotifyConfig(
      cfg,
      "https://panel.example/auth/callback",
    );
    const dumped = JSON.stringify(publicSettings);
    expect(dumped).not.toContain("super-secret-bot-token");
    expect(dumped).not.toContain("super-secret-client");
    expect(publicSettings).not.toHaveProperty("botToken");
    expect(publicSettings).not.toHaveProperty("clientSecret");
    expect(publicSettings.botTokenSet).toBe(true);
    expect(publicSettings.clientSecretSet).toBe(true);
    expect(publicSettings.clientId).toBe("123456789");
    expect(publicSettings.redirectUri).toContain("/auth/callback");
  });

  it("keeps existing secrets when PATCH fields are blank", () => {
    const current = normalizeDiscordNotifyConfig({
      botToken: "keep-token",
      clientId: "old-id",
      clientSecret: "keep-secret",
      invite: "https://discord.gg/old",
      enabled: true,
    });
    const merged = mergeDiscordNotifyPatch(current, {
      botToken: "  ",
      clientSecret: "",
      clientId: "new-id",
      invite: "",
      enabled: false,
    });
    expect(merged.botToken).toBe("keep-token");
    expect(merged.clientSecret).toBe("keep-secret");
    expect(merged.clientId).toBe("new-id");
    expect(merged.invite).toBe("");
    expect(merged.enabled).toBe(false);
  });

  it("fills missing OAuth fields from a hosted app even when a bot token exists", () => {
    const cfg = normalizeDiscordNotifyConfig({
      botToken: "panel-token",
      clientId: "",
      clientSecret: "",
      invite: "",
    });
    const merged = mergeDiscordAppCredentials(cfg, {
      discordBotToken: "app-token-ignored",
      discordClientId: "1538664643998912632",
      discordClientSecret: "app-secret",
      discordInvite: "https://discord.gg/abc",
    });
    expect(merged.botToken).toBe("panel-token");
    expect(merged.clientId).toBe("1538664643998912632");
    expect(merged.clientSecret).toBe("app-secret");
    expect(merged.invite).toBe("https://discord.gg/abc");
  });
});

describe("discord subscribers", () => {
  it("drops invalid user ids", () => {
    const file = normalizeSubscribersFile({
      users: {
        "123456789012345678": { id: "123456789012345678", username: "ok" },
        bad: { id: "nope", username: "x" },
      },
    });
    expect(Object.keys(file.users)).toEqual(["123456789012345678"]);
  });
});

describe("discord oauth state", () => {
  it("round-trips a signed state cookie", async () => {
    const prev = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = SECRET;
    try {
      const state = "abc123state";
      const cookie = await signDiscordOAuthState(state);
      expect(cookie).not.toContain(SECRET);
      await expect(verifyDiscordOAuthState(cookie, state)).resolves.toBe(true);
      await expect(verifyDiscordOAuthState(cookie, "other")).resolves.toBe(false);
      await expect(verifyDiscordOAuthState("tampered", state)).resolves.toBe(false);
    } finally {
      process.env.SESSION_SECRET = prev;
    }
  });
});
