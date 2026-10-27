import { describe, expect, it } from "vite-plus/test";

import {
  CREW_CARD_OPENER,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  USAGE_LIMIT_RESUME_PROMPT,
  attachmentsLabel,
  isCrewCard,
  isSlashCommand,
  isUsageLimitResumePrompt,
  userAskOf,
  userAskPreviewText,
} from "./userAsk.ts";

const image = { type: "image" } as const;
const file = { type: "file" } as const;
const card = `${CREW_CARD_OPENER}\n#12 Camera rig · from you\nDone when: the camera follows the player`;

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

describe("isCrewCard", () => {
  it.each([
    ["a task card", card, true],
    ["a task card with whitespace before it", `\n ${card}`, true],
    ["words that quote the opener", `see ${CREW_CARD_OPENER}`, false],
    ["plain words", "Add the camera rig", false],
  ])("%s", (_, text, expected) => {
    expect(isCrewCard(text)).toBe(expected);
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
      "words around a picture, its label left out and its notes kept",
      {
        text: "The header feels off:\n[Picture 1]\nNotes on picture 1:\n1. Bigger logo\nFix it",
        attachments: [image],
      },
      { kind: "text", text: "The header feels off:\nBigger logo\nFix it" },
    ],
    [
      "a picture with nothing written asks by its picture",
      { text: "[Picture 1]\nNotes on picture 1:\n1. Marked, no note.", attachments: [image] },
      { kind: "attachments", images: 1, files: 0 },
    ],
    [
      "a label with no picture behind it is words",
      { text: "[Picture 1]" },
      { kind: "text", text: "[Picture 1]" },
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
    [
      "a typed [File 1] stays the person's words when the only other attachment is a picture's original",
      {
        text: "[Picture 1]\n[File 1]",
        attachments: [
          { type: "image", mimeType: "image/png" },
          { type: "file", mimeType: "image/png" },
        ],
      },
      { kind: "text", text: "[File 1]" },
    ],
    [
      "a picture kept with its original asks as one picture",
      {
        text: "[Picture 1]",
        attachments: [
          { type: "image", mimeType: "image/png" },
          { type: "file", mimeType: "image/png" },
        ],
      },
      { kind: "attachments", images: 1, files: 0 },
    ],
    [
      "a file after a picture that is no picture of its own counts as a file",
      {
        text: "[Picture 1]",
        attachments: [
          { type: "image", mimeType: "image/png" },
          { type: "file", mimeType: "text/plain" },
        ],
      },
      { kind: "attachments", images: 1, files: 1 },
    ],
    [
      "words after a file, its label left out",
      { text: "[File 1]\nStand up the shop from this export", attachments: [file] },
      { kind: "text", text: "Stand up the shop from this export" },
    ],
    [
      "a file with nothing written asks by its file",
      { text: "[File 1]", attachments: [file] },
      { kind: "attachments", images: 0, files: 1 },
    ],
  ])("%s asks", (_, message, expected) => {
    expect(userAskOf(message)).toEqual(expected);
  });

  it.each([
    ["a slash command", { text: "/compact" }],
    ["a slash command with arguments", { text: "/model opus" }],
    ["a slash command beside an image", { text: "/review", attachments: [image] }],
    ["the usage-limit resume prompt", { text: USAGE_LIMIT_RESUME_PROMPT }],
    ["a crew task card", { text: card }],
    ["the engine's typed crew card", { text: "#12 Camera rig · from you", crewCard: {} }],
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
    [
      "words after a file, without its label",
      { text: "[File 1]\nStand up the shop from this export", attachments: [file] },
      "Stand up the shop from this export",
    ],
    ["a file alone", { text: "[File 1]", attachments: [file] }, "1 file"],
  ])("%s", (_, message, expected) => {
    expect(userAskPreviewText(message)).toBe(expected);
  });
});
