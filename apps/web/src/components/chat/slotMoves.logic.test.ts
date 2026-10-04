import { describe, expect, it } from "vite-plus/test";

import type { LiveSlot, SlotEntry } from "./liveSlot.logic";
import { slotMoves } from "./slotMoves.logic";

const entry = (key: string, riders: ReadonlyArray<string> = []): SlotEntry => ({
  key,
  shownAt: 0,
  endedAt: null,
  riders,
});

const slot = (overrides: Partial<LiveSlot> = {}): LiveSlot => ({
  entries: [],
  live: [],
  seen: new Set(),
  quietSince: null,
  pending: [],
  ...overrides,
});

describe("slotMoves", () => {
  it.each([
    {
      what: "nothing changed",
      from: slot({ entries: [entry("a")] }),
      to: slot({ entries: [entry("a")] }),
      leaving: [],
      entering: false,
    },
    {
      what: "an item ended and lands in the history, with what rode along",
      from: slot({ entries: [entry("a", ["r1"])] }),
      to: slot(),
      leaving: ["a", "r1"],
      entering: false,
    },
    {
      what: "a new item goes live in the slot",
      from: slot({ entries: [entry("a")] }),
      to: slot({ entries: [entry("a"), entry("b")] }),
      leaving: [],
      entering: true,
    },
    // P7's fix: held behind "Thinking", an arrival was among what the slot
    // held, yet never drawn — its entrance still makes its room, and the
    // history glides.
    {
      what: "an arrival held behind Thinking takes the slot",
      from: slot({ pending: ["p1"], quietSince: 0 }),
      to: slot({ entries: [entry("p1")] }),
      leaving: [],
      entering: true,
    },
  ])("$what", ({ from, to, leaving, entering }) => {
    expect(slotMoves(from, to)).toEqual({ leaving, entering });
  });
});
