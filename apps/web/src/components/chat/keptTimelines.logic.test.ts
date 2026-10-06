import { describe, expect, it } from "vite-plus/test";

import {
  keepTimelines,
  keptRests,
  warmingTimeline,
  type KeptTimeline,
} from "./keptTimelines.logic";

const slots = (...entries: Array<[string, number]>): ReadonlyArray<KeptTimeline> =>
  entries.map(([key, openedAt]) => ({ key, openedAt }));
const alive = () => true;

describe("keepTimelines", () => {
  it.each([
    {
      case: "a first conversation",
      kept: slots(),
      open: "a",
      expected: slots(["a", 1]),
    },
    {
      case: "another opens: the one left stays, and the new one comes last",
      kept: slots(["a", 1]),
      open: "b",
      expected: slots(["a", 1], ["b", 2]),
    },
    {
      case: "a return keeps every list where it stands in the page",
      kept: slots(["a", 1], ["b", 2]),
      open: "a",
      expected: slots(["a", 3], ["b", 2]),
    },
    {
      case: "past the cap the one opened longest ago goes",
      kept: slots(["a", 1], ["b", 4], ["c", 2], ["d", 3]),
      open: "e",
      expected: slots(["b", 4], ["c", 2], ["d", 3], ["e", 5]),
    },
  ])("$case", ({ kept, open, expected }) => {
    expect(keepTimelines(kept, { open, alive })).toEqual(expected);
  });

  it("drops a kept list whose Mate or conversation is gone, never the open one", () => {
    const kept = slots(["a", 1], ["b", 2], ["c", 3]);
    expect(keepTimelines(kept, { open: "c", alive: (key) => key === "b" })).toEqual(
      slots(["b", 2], ["c", 3]),
    );
    expect(keepTimelines(kept, { open: "c", alive: () => false })).toEqual(slots(["c", 3]));
  });

  it("answers the same list while nothing changed, so the pane draws nothing new", () => {
    const kept = slots(["a", 1], ["b", 2]);
    expect(keepTimelines(kept, { open: "b", alive })).toBe(kept);
  });

  it("keeps at least the open one", () => {
    expect(keepTimelines(slots(["a", 1]), { open: "b", alive, atMost: 0 })).toEqual(
      slots(["b", 2]),
    );
  });
});

describe("warmingTimeline", () => {
  const kept = slots(["a", 1], ["b", 2]);
  it.each([
    { case: "the row rested on", asked: "c", placing: false, warms: "c" },
    { case: "nothing asked", asked: null, placing: false, warms: null },
    { case: "the open one", asked: "b", placing: false, warms: null },
    { case: "one already kept", asked: "a", placing: false, warms: null },
    { case: "while the open one is still being placed", asked: "c", placing: true, warms: null },
  ])("$case", ({ asked, placing, warms }) => {
    expect(warmingTimeline({ asked, open: "b", kept, placing })).toBe(warms);
  });
});

// A kept list rests unlaid only once nothing it reads can still need placing:
// out of sight, nobody about to open it, no run going on, nothing read lately.
describe("keptRests", () => {
  const quietHidden = { hidden: true, readsLive: false, working: false, quiet: true };
  it.each([
    { name: "out of sight and gone quiet: it rests", input: quietHidden, rests: true },
    { name: "shown: it is laid out", input: { ...quietHidden, hidden: false }, rests: false },
    {
      name: "someone rests on its menu row: laid out before the press",
      input: { ...quietHidden, readsLive: true },
      rests: false,
    },
    {
      name: "a run going on in it reads again within the second: laid out",
      input: { ...quietHidden, working: true },
      rests: false,
    },
    {
      name: "it read a moment ago: laid out until its list has placed it",
      input: { ...quietHidden, quiet: false },
      rests: false,
    },
  ])("$name", ({ input, rests }) => {
    expect(keptRests(input)).toBe(rests);
  });
});
