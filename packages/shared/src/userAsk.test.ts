import { describe, expect, it } from "vite-plus/test";

import {
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  USAGE_LIMIT_RESUME_PROMPT,
  attachmentsLabel,
  isSlashCommand,
  isUsageLimitResumePrompt,
  userAskOf,
  userAskPreviewText,
} from "./userAsk.ts";

const image = { type: "image" } as const;
const file = { type: "file" } as const;

describe("isSlashCommand", () => {
  it.each([
    ["a bare command", "/compact", true],
    ["a command with arguments", "/model opus", true],
    ["a command with multi-line arguments", "/compact keep\nthe recent errors", true],
    ["a command wrapped in whitespace", "  /compact \n", true],
    ["a plugin command", "/plugin:skill run", true],
    ["a command named after a file", "/deploy.prod", true],
    ["an absolute path", "/home/theo/app.ts is broken", false],
    ["a lone slash", "/", false],
    ["a slash after words", "please run /compact", false],
    ["plain words", "Fix the login page", false],
  ])("%s", (_, text, expected) => {
    expect(isSlashCommand(text)).toBe(expected);
  });
});

describe("isUsageLimitResumePrompt", () => {
  it.each([
    ["the prompt", USAGE_LIMIT_RESUME_PROMPT, true],
    ["the prompt with whitespace around it", `\n ${USAGE_LIMIT_RESUME_PROMPT} `, true],
    ["words that mention it", `quote: ${USAGE_LIMIT_RESUME_PROMPT}`, false],
    ["plain words", "continue", false],
  ])("%s", (_, text, expected) => {
    expect(isUsageLimitResumePrompt(text)).toBe(expected);
  });
});

describe("userAskOf", () => {
  it.each([
    ["words", { text: "Fix the login page" }, { kind: "text", text: "Fix the login page" }],
    ["words in whitespace", { text: "  Fix it \n" }, { kind: "text", text: "Fix it" }],
    [
      "words beside images",
      { text: "Look at this", attachments: [image, image] },
      { kind: "text", text: "Look at this" },
    ],
    [
      "words behind the effort prefix",
      { text: "Ultrathink:\nFix the flaky test" },
      { kind: "text", text: "Fix the flaky test" },
    ],
    [
      "an absolute path",
      { text: "/var/www/app fails to build" },
      { kind: "text", text: "/var/www/app fails to build" },
    ],
    [
      "the image-only placeholder",
      { text: IMAGE_ONLY_BOOTSTRAP_PROMPT, attachments: [image] },
      { kind: "attachments", images: 1, files: 0 },
    ],
    [
      "the placeholder behind the effort prefix",
      { text: `Ultrathink:\n${IMAGE_ONLY_BOOTSTRAP_PROMPT}`, attachments: [image, image] },
      { kind: "attachments", images: 2, files: 0 },
    ],
    [
      "attachments without text",
      { text: "", attachments: [image, file, image] },
      { kind: "attachments", images: 2, files: 1 },
    ],
  ])("%s asks", (_, message, expected) => {
    expect(userAskOf(message)).toEqual(expected);
  });

  it.each([
    ["a slash command", { text: "/compact" }],
    ["a slash command with arguments", { text: "/model opus" }],
    ["a slash command beside an image", { text: "/review", attachments: [image] }],
    ["the usage-limit resume prompt", { text: USAGE_LIMIT_RESUME_PROMPT }],
    ["the placeholder without attachments", { text: IMAGE_ONLY_BOOTSTRAP_PROMPT }],
    ["nothing", { text: "  ", attachments: [] }],
  ])("%s asks nothing", (_, message) => {
    expect(userAskOf(message)).toBeNull();
  });
});

describe("attachmentsLabel", () => {
  it.each([
    [1, 0, "1 image"],
    [3, 0, "3 images"],
    [0, 1, "1 file"],
    [0, 2, "2 files"],
    [1, 2, "1 image and 2 files"],
    [2, 1, "2 images and 1 file"],
  ])("%i images and %i files read as %s", (images, files, expected) => {
    expect(attachmentsLabel({ images, files })).toBe(expected);
  });
});

describe("userAskPreviewText", () => {
  it.each([
    ["words, quoted", { text: "**Fix** the `login` page" }, "Fix the login page"],
    ["one image", { text: IMAGE_ONLY_BOOTSTRAP_PROMPT, attachments: [image] }, "1 image"],
    ["three images", { text: "", attachments: [image, image, image] }, "3 images"],
    ["a slash command", { text: "/compact" }, null],
    ["the resume prompt", { text: USAGE_LIMIT_RESUME_PROMPT }, null],
    ["marks alone", { text: "---" }, null],
  ])("%s", (_, message, expected) => {
    expect(userAskPreviewText(message)).toBe(expected);
  });
});
