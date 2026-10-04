import { describe, expect, it } from "vite-plus/test";

import {
  PACE_GAP_MS,
  PACE_MIN_GAP_MS,
  paceDue,
  paceGap,
  paceHolds,
  paceOffer,
  paceStart,
  type Pace,
} from "./runPace.logic";

/** What a run shows at a moment: the keys present, in order, and what lands at once. */
interface Moment {
  readonly at: number;
  readonly keys: ReadonlyArray<string>;
  readonly landing?: ReadonlyArray<string>;
  readonly flush?: boolean;
}

/**
 * Plays moments through the pace, as `usePace` does — an offer at each, the
 * pace's own clock between them — and says when each key first showed.
 */
function play(start: ReadonlyArray<string>, moments: ReadonlyArray<Moment>, until: number) {
  let pace: Pace = paceStart(start);
  const shown = new Map<string, number>();
  const look = (at: number, keys: ReadonlyArray<string>) => {
    const holds = paceHolds(pace, keys);
    for (const key of keys) if (!holds.has(key) && !shown.has(key)) shown.set(key, at);
  };
  let keys = start;
  look(0, keys);
  const queue = [...moments];
  let at = 0;
  while (at <= until) {
    const due = paceDue(pace);
    const next = queue[0];
    if (next !== undefined && (due === null || next.at <= due)) {
      queue.shift();
      at = next.at;
      keys = next.keys;
      pace = paceOffer(pace, {
        keys,
        at,
        landing: new Set(next.landing ?? []),
        flush: next.flush ?? false,
      });
    } else if (due !== null) {
      at = due;
      pace = paceOffer(pace, { keys, at, landing: new Set(), flush: false });
    } else {
      break;
    }
    look(at, keys);
  }
  return shown;
}

describe("the pace of a run's arrivals", () => {
  it("shows what stood at the first draw at once", () => {
    const shown = play(["a", "b", "c"], [], 1000);
    expect([...shown.values()]).toEqual([0, 0, 0]);
  });

  it.each([
    { what: "one arrival", keys: ["n1"] },
    { what: "three at once", keys: ["n1", "n2", "n3"] },
    { what: "six at once", keys: ["n1", "n2", "n3", "n4", "n5", "n6"] },
    { what: "twelve at once", keys: Array.from({ length: 12 }, (_, i) => `n${i + 1}`) },
  ])("lets $what in one after another, in order, never 3 within 100 ms", ({ keys }) => {
    const shown = play(["a"], [{ at: 1000, keys: ["a", ...keys] }], 10_000);
    const times = keys.map((key) => shown.get(key)!);
    // In order, the first at once.
    expect(times[0]).toBe(1000);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]!).toBeGreaterThan(times[index - 1]!);
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(PACE_MIN_GAP_MS);
    }
    // Never far behind: a burst drains within a second and a half.
    expect(times.at(-1)! - 1000).toBeLessThanOrEqual(1500);
  });

  it("keeps its gap from the last entrance for what arrives on its own", () => {
    const shown = play(
      ["a"],
      [
        { at: 1000, keys: ["a", "n1"] },
        { at: 1050, keys: ["a", "n1", "n2"] },
        { at: 2000, keys: ["a", "n1", "n2", "n3"] },
      ],
      5000,
    );
    expect(shown.get("n1")).toBe(1000);
    expect(shown.get("n2")).toBe(1000 + PACE_GAP_MS);
    // Long after the last: at once.
    expect(shown.get("n3")).toBe(2000);
  });

  it("lets a line landing from the live slot in at once, and what follows waits its gap", () => {
    const shown = play(
      ["a"],
      [{ at: 1000, keys: ["a", "host", "rider1", "rider2"], landing: ["host"] }],
      5000,
    );
    expect(shown.get("host")).toBe(1000);
    expect(shown.get("rider1")).toBe(1000 + paceGap(2));
    expect(shown.get("rider2")! - shown.get("rider1")!).toBeGreaterThanOrEqual(PACE_MIN_GAP_MS);
  });

  it("shows everything at once when the run is over or caught up", () => {
    const shown = play(
      ["a"],
      [
        { at: 1000, keys: ["a", "n1", "n2", "n3", "n4"] },
        { at: 1010, keys: ["a", "n1", "n2", "n3", "n4"], flush: true },
      ],
      5000,
    );
    expect(shown.get("n2")).toBe(1010);
    expect(shown.get("n4")).toBe(1010);
  });

  // The review, 2026-10-04: "Load earlier" paced the older rows in above the
  // reader, one by one. What comes before what stands is history.
  it("shows at once what arrives before what already stands", () => {
    const shown = play(
      ["a", "b"],
      [
        { at: 1000, keys: ["o1", "o2", "o3", "o4", "a", "b"] },
        { at: 1001, keys: ["o1", "o2", "o3", "o4", "a", "b", "n1", "n2"] },
      ],
      5000,
    );
    for (const key of ["o1", "o2", "o3", "o4"]) expect(shown.get(key)).toBe(1000);
    // What arrives at the end still enters one after another.
    expect(shown.get("n1")).toBe(1001);
    expect(shown.get("n2")).toBe(1001 + PACE_GAP_MS);
  });

  it("forgets what left before it showed", () => {
    let pace = paceStart(["a"]);
    pace = paceOffer(pace, { keys: ["a", "n1", "n2"], at: 1000, landing: new Set(), flush: false });
    pace = paceOffer(pace, { keys: ["a", "n1"], at: 1010, landing: new Set(), flush: false });
    expect(paceDue(pace)).toBeNull();
  });

  it("holds what it has not heard of yet, so nothing shows a frame early", () => {
    const pace = paceStart(["a"]);
    expect([...paceHolds(pace, ["a", "new"])]).toEqual(["new"]);
  });

  it.each([
    { backlog: 1, gap: PACE_GAP_MS },
    { backlog: 3, gap: PACE_GAP_MS },
    { backlog: 4, gap: 135 },
    { backlog: 8, gap: 67.5 },
    { backlog: 40, gap: PACE_MIN_GAP_MS },
  ])("waits $gap ms between entrances with $backlog waiting", ({ backlog, gap }) => {
    expect(paceGap(backlog)).toBe(gap);
  });
});
