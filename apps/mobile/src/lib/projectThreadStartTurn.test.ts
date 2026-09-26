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

  it("cuts a long ask", () => {
    const title = deriveThreadTitleFromPrompt("word ".repeat(40));
    expect(title.endsWith("...")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(72);
  });
});
