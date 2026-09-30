import { describe, expect, it } from "vite-plus/test";

import { STAND_IN_HAND_OVER_MS, standInToRestore, withStandIn } from "./standInMemory";

// One reload draws a conversation's stand-in three times (the gate's stage, the chat layout's
// pending view, the route's opening view); the person typing in it keeps focus and caret across.
describe("standInToRestore", () => {
  const typed = withStandIn(new Map(), "t1", { caret: 5, focused: true, leftAtMs: null });
  it.each([
    {
      case: "handed over at once",
      memory: withStandIn(typed, "t1", { leftAtMs: 1_000 }),
      nowMs: 1_050,
      expected: { caret: 5, focus: true },
    },
    {
      case: "handed over too late: the caret, not the focus",
      memory: withStandIn(typed, "t1", { leftAtMs: 1_000 }),
      nowMs: 1_000 + STAND_IN_HAND_OVER_MS + 1,
      expected: { caret: 5, focus: false },
    },
    {
      case: "it was not focused",
      memory: withStandIn(typed, "t1", { focused: false, leftAtMs: 1_000 }),
      nowMs: 1_050,
      expected: { caret: 5, focus: false },
    },
    {
      case: "still standing (never left)",
      memory: typed,
      nowMs: 1_050,
      expected: { caret: 5, focus: false },
    },
    {
      case: "another conversation",
      memory: withStandIn(typed, "t1", { leftAtMs: 1_000 }),
      nowMs: 1_050,
      key: "t2",
      expected: { caret: null, focus: false },
    },
  ])("$case", ({ memory, nowMs, key, expected }) => {
    expect(standInToRestore(memory, key ?? "t1", nowMs)).toEqual(expected);
  });
});
