import { describe, expect, it } from "vitest";
import {
  normalizeTelegramBotRecipes,
  telegramBotInviteUrl,
  telegramCommandsFromTasks,
} from "./telegram-bot-tasks";

describe("telegram bot recipes", () => {
  it("defaults to alert/status/help/uptime tasks", () => {
    const recipes = normalizeTelegramBotRecipes({});
    expect(recipes.botName).toBe("Qadbak");
    expect(recipes.tasks.some((t) => t.type === "qadbak.alerts" && t.enabled)).toBe(true);
    expect(recipes.tasks.some((t) => t.type === "qadbak.status")).toBe(true);
    expect(recipes.tasks.some((t) => t.type === "qadbak.help")).toBe(true);
    expect(recipes.tasks.some((t) => t.type === "qadbak.uptime")).toBe(true);
  });

  it("drops Discord-only types and sanitizes command names", () => {
    const recipes = normalizeTelegramBotRecipes({
      botName: "Shop",
      tasks: [
        { id: "x", enabled: true, type: "slash.reply", params: { name: "nope" } },
        {
          id: "r",
          enabled: true,
          type: "command.reply",
          params: { name: "Hello World!", text: "Hi" },
        },
      ],
    });
    expect(recipes.tasks.map((t) => t.type)).toEqual(["command.reply"]);
    expect(recipes.tasks[0]?.params.name).toBe("helloworld");
    const cmds = telegramCommandsFromTasks(recipes);
    expect(cmds.some((c) => c.command === "start")).toBe(true);
    expect(cmds.some((c) => c.command === "helloworld")).toBe(true);
  });

  it("builds a group invite without a token", () => {
    const url = telegramBotInviteUrl("@My_ShopBot");
    expect(url).toBe("https://t.me/My_ShopBot?startgroup=1");
    expect(url).not.toMatch(/token/i);
  });
});
