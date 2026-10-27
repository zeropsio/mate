import { describe, expect, it } from "vite-plus/test";

import { deriveThreadTitleFromPrompt } from "./projectThreadStartTurn";

describe("deriveThreadTitleFromPrompt", () => {
  it.each([
    ["an ask", "Fix the login page", "Fix the login page"],
    ["an ask with runs of whitespace", "  Fix\n\nthe   login ", "Fix the login"],
    ["nothing", "   ", "New thread"],
    ["a slash command", "/compact", "New thread"],
    ["a slash command with arguments", "/model opus", "New thread"],
    ["an absolute path", "/var/www/app fails", "/var/www/app fails"],
  ])("titles %s", (_, prompt, expected) => {
    expect(deriveThreadTitleFromPrompt(prompt)).toBe(expected);
  });

  const shot = { type: "image", name: "shot.png" } as const;
  const archive = { type: "file", name: "shop-export.zip" } as const;

  it.each([
    ["words beside a file", "Stand up the shop", [archive], "Stand up the shop"],
    [
      "a file's label before the words",
      "[File 1]\nStand up the shop",
      [archive],
      "Stand up the shop",
    ],
    ["a file alone", "", [archive], "File: shop-export.zip"],
    ["a file's label alone", "[File 1]", [archive], "File: shop-export.zip"],
    ["a picture alone", "", [shot, archive], "Image: shot.png"],
    ["a slash command beside a file", "/review", [archive], "New thread"],
  ])("titles %s", (_, prompt, attachments, expected) => {
    expect(deriveThreadTitleFromPrompt(prompt, attachments)).toBe(expected);
  });

  it("cuts a long ask", () => {
    const title = deriveThreadTitleFromPrompt("word ".repeat(40));
    expect(title.endsWith("...")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(72);
  });
});
