import { describe, expect, it } from "vite-plus/test";

import {
  HANDED_OVER_FOR_MS,
  draftWithTyped,
  handOverMateConversation,
  handedOverRecently,
  standInForConversation,
  takeHandedOverCaret,
} from "./mateHandOver";

describe("a Mate's own view handing over to its conversation", () => {
  it("counts as handed over for a moment, then not", () => {
    handOverMateConversation("env:a", { nowMs: 1_000, caret: null });
    expect(handedOverRecently("env:a", 1_000)).toBe(true);
    expect(handedOverRecently("env:a", 1_000 + HANDED_OVER_FOR_MS)).toBe(false);
    expect(handedOverRecently("env:other", 1_000)).toBe(false);
  });

  it("tells the caret once", () => {
    handOverMateConversation("env:b", { nowMs: 0, caret: 7 });
    expect(takeHandedOverCaret("env:b", 10)).toBe(7);
    expect(takeHandedOverCaret("env:b", 20)).toBeNull();
  });

  it("tells no caret for a hand-over long gone", () => {
    handOverMateConversation("env:c", { nowMs: 0, caret: 3 });
    expect(takeHandedOverCaret("env:c", HANDED_OVER_FOR_MS)).toBeNull();
  });
});

describe("draftWithTyped", () => {
  it.each([
    { case: "nothing typed", held: "kept", text: "", at: 0, prompt: "kept", caret: 4 },
    { case: "nothing held", held: "", text: "deploy it", at: 6, prompt: "deploy it", caret: 6 },
    { case: "blank held", held: "  ", text: "go", at: 2, prompt: "go", caret: 2 },
    { case: "both", held: "first", text: "then", at: 4, prompt: "first\n\nthen", caret: 11 },
    { case: "a caret past the end", held: "", text: "go", at: 9, prompt: "go", caret: 2 },
  ])("$case", ({ held, text, at, prompt, caret }) => {
    expect(draftWithTyped(held, { text, caret: at })).toEqual({ prompt, caret });
  });
});

describe("a Mate's opening view standing in for its conversation", () => {
  // A reload draws the Mate's stage until the conversation takes over; the
  // conversation mounts while the stage still stands, and counts as handed
  // over from then, the caret with it.
  it("counts as handed over while it stands, and for a moment after it goes", () => {
    const standing = standInForConversation("env:reload");
    expect(handedOverRecently("env:reload", 50_000)).toBe(true);
    standing.caret(4);
    standing.release(60_000);
    expect(handedOverRecently("env:reload", 60_000 + HANDED_OVER_FOR_MS - 1)).toBe(true);
    expect(takeHandedOverCaret("env:reload", 60_001)).toBe(4);
    expect(handedOverRecently("env:reload", 60_000 + HANDED_OVER_FOR_MS)).toBe(false);
  });

  it("tells no caret when nothing was typed", () => {
    standInForConversation("env:quiet").release(0);
    expect(takeHandedOverCaret("env:quiet", 1)).toBeNull();
  });
});
