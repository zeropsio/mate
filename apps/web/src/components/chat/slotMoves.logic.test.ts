import { describe, expect, it } from "vite-plus/test";

import type { LiveSlot, SlotEntry } from "./liveSlot.logic";
import { landingHosts, slotMoves } from "./slotMoves.logic";

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

// The review, 2026-10-04: a question and its answer landing together — the
// answer, drawn under the question in the slot, waited its turn, vanished
// for a moment and came back without the plop.
describe("landingHosts", () => {
  it.each([
    {
      what: "an item that stood in the slot",
      from: slot({ entries: [entry("a")] }),
      leaving: ["a"],
      drawn: ["a"],
      hosts: ["a"],
    },
    {
      what: "a question and the answer drawn under it: the pair lands as one",
      from: slot({ entries: [entry("question:q1", ["person:q1-answer"])] }),
      leaving: ["question:q1", "person:q1-answer"],
      drawn: ["question:q1", "person:q1-answer"],
      hosts: ["question:q1", "person:q1-answer"],
    },
    {
      what: "what rode along unseen enters after, in its turn",
      from: slot({ entries: [entry("a", ["r1", "r2"])] }),
      leaving: ["a", "r1", "r2"],
      drawn: ["a"],
      hosts: ["a"],
    },
  ])("$what", ({ from, leaving, drawn, hosts }) => {
    expect([...landingHosts(from, leaving, new Set(drawn))]).toEqual(hosts);
  });
});
