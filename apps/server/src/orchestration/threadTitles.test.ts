import { IMAGE_ONLY_BOOTSTRAP_PROMPT, USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";
import { describe, expect, it } from "vite-plus/test";

import { canReplaceThreadTitle, DEFAULT_THREAD_TITLE } from "./threadTitles.ts";

describe("canReplaceThreadTitle", () => {
  it.each([
    ["the default title", DEFAULT_THREAD_TITLE, undefined, true],
    ["the title seeded from this message", "Fix the login", "Fix the login", true],
    ["a title seeded by another message", "Fix the login", "Add a footer", false],
    ["a title nobody seeded", "Fix the login", undefined, false],
    // A client that seeded the title from a slash command (older web, mobile
    // drafts) left no subject; the first real ask replaces it.
    ["a slash command", "/compact", "Add a footer", true],
    ["a slash command with arguments", "/model opus", undefined, true],
    ["the image-only placeholder", IMAGE_ONLY_BOOTSTRAP_PROMPT, "Add a footer", true],
    ["the usage-limit resume prompt", USAGE_LIMIT_RESUME_PROMPT, undefined, true],
    ["an absolute path", "/var/www/app fails", "Add a footer", false],
  ])("%s", (_, currentTitle, titleSeed, expected) => {
    expect(canReplaceThreadTitle(currentTitle, titleSeed)).toBe(expected);
  });
});
