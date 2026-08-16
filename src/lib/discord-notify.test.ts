import { describe, expect, it } from "vitest";
import {
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
  it("round-trips a signed state cookie", () => {
    const prev = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = SECRET;
    try {
      const state = "abc123state";
      const cookie = signDiscordOAuthState(state);
      expect(cookie).not.toContain(SECRET);
      expect(verifyDiscordOAuthState(cookie, state)).toBe(true);
      expect(verifyDiscordOAuthState(cookie, "other")).toBe(false);
      expect(verifyDiscordOAuthState("tampered", state)).toBe(false);
    } finally {
      process.env.SESSION_SECRET = prev;
    }
  });
});
