import { describe, expect, it } from "vite-plus/test";

import { formatElapsed, formatEstimate, progressClock, progressFraction } from "./progress.logic";

const MIN = 60_000;

describe("progressClock — what a long operation's row says about time", () => {
  it.each([
    {
      name: "a wait inside its estimate says how long it has run and how long it usually takes",
      input: { startedAtMs: 0, nowMs: 80_000, endedAtMs: null, estimateMs: 5 * MIN },
      want: { elapsed: "1:20", note: "usually about 5 min", overrun: false },
    },
    {
      name: "a wait past its estimate says it is taking longer than usual, never a countdown",
      input: { startedAtMs: 0, nowMs: 6 * MIN + 10_000, endedAtMs: null, estimateMs: 5 * MIN },
      want: { elapsed: "6:10", note: "Taking longer than usual", overrun: true },
    },
    {
      name: "a wait with no measured estimate says only how long it has run",
      input: { startedAtMs: 0, nowMs: 5_000, endedAtMs: null, estimateMs: null },
      want: { elapsed: "0:05", note: null, overrun: false },
    },
    {
      name: "a wait whose start is unknown says only its estimate",
      input: { startedAtMs: null, nowMs: 5_000, endedAtMs: null, estimateMs: 2 * MIN },
      want: { elapsed: null, note: "usually about 2 min", overrun: false },
    },
    {
      name: "an ended wait's clock stops where it ended",
      input: { startedAtMs: 0, nowMs: 9 * MIN, endedAtMs: 35_000, estimateMs: 2 * MIN },
      want: { elapsed: "0:35", note: null, overrun: false },
    },
  ])("$name", ({ input, want }) => {
    expect(progressClock(input)).toEqual(want);
  });

  it("a clock read from the start time shows the true elapsed time after the tab slept", () => {
    const asleep = progressClock({
      startedAtMs: 1_000,
      nowMs: 1_000 + 4 * MIN + 44_000,
      endedAtMs: null,
      estimateMs: 2 * MIN,
    });
    expect(asleep.elapsed).toBe("4:44");
  });
});

describe("formatElapsed and formatEstimate", () => {
  it.each([
    [0, "0:00"],
    [59_999, "0:59"],
    [61_000, "1:01"],
    [65 * MIN + 3_000, "1:05:03"],
    [-5_000, "0:00"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  it.each([
    [20_000, "about 20 s"],
    [45_000, "about 1 min"],
    [90_000, "about 2 min"],
    [5 * MIN, "about 5 min"],
  ])("estimates %d ms as %s", (ms, text) => {
    expect(formatEstimate(ms)).toBe(text);
  });
});

describe("progressFraction — how far the bar reaches", () => {
  it("A long operation's bar never reaches past the step it is on", () => {
    const fraction = progressFraction({
      at: 1,
      count: 4,
      elapsedMs: 100 * MIN,
      estimateMs: 2 * MIN,
      state: "running",
    });
    expect(fraction).toBeLessThan(0.5);
    expect(fraction).toBeGreaterThanOrEqual(0.25);
  });

  it("A long operation's bar moves on with time inside a step", () => {
    const early = progressFraction({
      at: 0,
      count: 2,
      elapsedMs: 10_000,
      estimateMs: 100_000,
      state: "running",
    });
    const later = progressFraction({
      at: 0,
      count: 2,
      elapsedMs: 30_000,
      estimateMs: 100_000,
      state: "running",
    });
    expect(later).toBeGreaterThan(early);
  });

  it("A finished operation's bar is full; a stopped one stays where it stopped", () => {
    expect(
      progressFraction({ at: 1, count: 3, elapsedMs: 0, estimateMs: null, state: "done" }),
    ).toBe(1);
    expect(
      progressFraction({ at: 1, count: 3, elapsedMs: 0, estimateMs: null, state: "failed" }),
    ).toBeCloseTo(1 / 3);
  });
});
