import { describe, expect, it } from "vitest";
import {
  discordBotInviteUrl,
  normalizeDiscordBotRecipes,
  slashCommandsFromTasks,
} from "./discord-bot-tasks";

describe("discord bot recipes", () => {
  it("defaults to Qadbak alert/status/help/uptime tasks", () => {
    const recipes = normalizeDiscordBotRecipes({});
    expect(recipes.botName).toBe("Qadbak");
    expect(recipes.tasks.some((t) => t.type === "qadbak.alerts" && t.enabled)).toBe(true);
    expect(recipes.tasks.some((t) => t.type === "qadbak.status")).toBe(true);
    expect(recipes.tasks.some((t) => t.type === "qadbak.help")).toBe(true);
    expect(recipes.tasks.some((t) => t.type === "qadbak.uptime")).toBe(true);
  });

  it("drops unknown task types and sanitizes slash names", () => {
    const recipes = normalizeDiscordBotRecipes({
      botName: "Demo",
      tasks: [
        { id: "x", enabled: true, type: "shell.exec", params: { cmd: "rm" } },
        {
          id: "r",
          enabled: true,
          type: "slash.reply",
          params: { name: "Hello World!", text: "Hi" },
        },
      ],
    });
    expect(recipes.tasks.map((t) => t.type)).toEqual(["slash.reply"]);
    const cmds = slashCommandsFromTasks(recipes);
    expect(cmds.some((c) => c.name === "helloworld")).toBe(true);
  });

  it("builds an invite URL without a token", () => {
    const url = discordBotInviteUrl("123456789");
    expect(url).toContain("client_id=123456789");
    expect(url).toContain("scope=bot%20applications.commands");
    expect(url).toContain("integration_type=0");
    expect(url).toContain("permissions=85056");
    expect(url).not.toMatch(/token/i);
  });
});

describe("discord oauth return path", () => {
  it("sends admin OAuth back to the admin page and everyone else to /discord", async () => {
    const { discordOauthReturnPath } = await import("./discord-oauth-return");
    expect(discordOauthReturnPath("abc.admin")).toBe("/admin/discord");
    expect(discordOauthReturnPath("abc.public")).toBe("/discord");
    expect(discordOauthReturnPath("legacy-state")).toBe("/discord");
  });
});
