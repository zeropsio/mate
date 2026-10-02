import { describe, expect, it } from "vite-plus/test";

import {
  BOOT_WAIT_LINE_MS,
  bootWaitLine,
  openingConversationLine,
  READING_PROJECTS_LINE,
  waitLineDueInMs,
  waitLineShows,
} from "./waitLine.logic";

describe("a wait's one line", () => {
  it.each([
    { name: "no words", text: null, said: null, elapsedMs: 5_000, due: null },
    { name: "the first beat", text: "Reading…", said: null, elapsedMs: 0, due: 600 },
    { name: "part of the beat gone", text: "Reading…", said: null, elapsedMs: 450, due: 150 },
    { name: "the beat passed", text: "Reading…", said: null, elapsedMs: 900, due: 0 },
    { name: "the same words on screen", text: "Reading…", said: "Reading…", elapsedMs: 0, due: 0 },
    { name: "other words on screen", text: "Reading…", said: "Opening…", elapsedMs: 0, due: 600 },
  ])("shows in $due ms with $name", (row) => {
    expect(
      waitLineDueInMs({
        text: row.text,
        said: row.said,
        elapsedMs: row.elapsedMs,
        delayMs: BOOT_WAIT_LINE_MS,
      }),
    ).toBe(row.due);
  });

  it.each([
    { conversationRoute: false, mateName: undefined, line: READING_PROJECTS_LINE },
    { conversationRoute: false, mateName: "Gita", line: READING_PROJECTS_LINE },
    { conversationRoute: true, mateName: undefined, line: null },
    { conversationRoute: true, mateName: "Gita", line: "Opening Gita's conversation…" },
  ])(
    "the boot says $line on a conversation's route: $conversationRoute, the Mate: $mateName",
    (row) => {
      expect(bootWaitLine(row)).toBe(row.line);
    },
  );

  it.each([
    {
      name: "before it has spoken",
      text: "Opening the conversation…",
      spoken: false,
      shows: false,
    },
    { name: "once it has spoken", text: "Opening the conversation…", spoken: true, shows: true },
    // Its words changing ("…the conversation…" → "…Gita's conversation…") never blank a frame.
    {
      name: "with new words, having spoken",
      text: "Opening Gita's conversation…",
      spoken: true,
      shows: true,
    },
    { name: "with no words", text: null, spoken: true, shows: false },
  ])("shows $shows $name", ({ text, spoken, shows }) => {
    expect(waitLineShows({ text, spoken })).toBe(shows);
  });

  it("names the Mate whose conversation opens, or the conversation", () => {
    expect(openingConversationLine("Milo")).toBe("Opening Milo's conversation…");
    expect(openingConversationLine(undefined)).toBe("Opening the conversation…");
  });
});
