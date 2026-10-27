import { describe, expect, it } from "vite-plus/test";

import {
  BOOT_WAIT_LINE_MS,
  openingConversationLine,
  overviewStandsIn,
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

describe("overviewStandsIn — what a route draws while the app or its code loads", () => {
  it.each([
    { pathname: "/zerops", standsIn: true },
    // Any other route holds its room and paints nothing: its code arrives in a beat.
    { pathname: "/settings/general", standsIn: false },
    { pathname: "/env-1/thread-1", standsIn: false },
  ])(
    "The overview's route stands in shaped like the overview while it loads: $pathname",
    ({ pathname, standsIn }) => {
      expect(overviewStandsIn(pathname)).toBe(standsIn);
    },
  );

  // The home lands on HQ's Mate as often as on the overview: until it knows which, it paints
  // nothing it would take back, and the overview's shape is the overview's own route's.
  it("opening Mate paints only what it lands on", () => {
    expect(overviewStandsIn("/")).toBe(false);
  });
});
