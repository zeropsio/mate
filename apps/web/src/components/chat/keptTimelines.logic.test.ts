import { describe, expect, it } from "vite-plus/test";

import { keepTimelines, warmingTimeline, type KeptTimeline } from "./keptTimelines.logic";

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
