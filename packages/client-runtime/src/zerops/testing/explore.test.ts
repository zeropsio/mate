import { describe, expect, it } from "vite-plus/test";

import { explore } from "./explore.ts";

/** A counter modulo 5 that can add 1 or 2: few states, many sequences. */
const counter = (
  depth: number,
  check: (before: number, event: number, after: number) => ReadonlyArray<string> = () => [],
) => {
  const expanded: Array<number> = [];
  const report = explore({
    roots: [0],
    depth,
    events: (state: number) => {
      expanded.push(state);
      return [1, 2];
    },
    step: (state: number, event: number) => ({ state: (state + event) % 5 }),
    key: (state) => String(state),
    check: (before, event, result) => check(before, event, result.state),
  });
  return { report, expanded };
};

describe("explore", () => {
  it.each([
    { depth: 0, expanded: [], transitions: 0 },
    { depth: 1, expanded: [0], transitions: 2 },
    { depth: 2, expanded: [0, 1, 2], transitions: 6 },
    { depth: 6, expanded: [0, 1, 2, 3, 4], transitions: 10 },
  ])(
    "expands each state once, at its shallowest depth, to depth $depth",
    ({ depth, expanded, transitions }) => {
      const run = counter(depth);
      expect(run.expanded).toEqual(expanded);
      expect(run.report).toEqual({ transitions, expanded: expanded.length, violations: [] });
    },
  );

  it("checks every transition, also those into a state already seen", () => {
    const checked: Array<string> = [];
    counter(6, (before, event, after) => {
      checked.push(`${before}+${event}=${after}`);
      return [];
    });
    expect(checked).toEqual([
      "0+1=1",
      "0+2=2",
      "1+1=2",
      "1+2=3",
      "2+1=3",
      "2+2=4",
      "3+1=4",
      "3+2=0",
      "4+1=0",
      "4+2=1",
    ]);
  });
  it("stops at the first violating transition and names the events that reached it", () => {
    const { report } = counter(6, (_before, _event, after) =>
      after === 4 ? ["reached 4", "and again"] : [],
    );
    expect(report).toEqual({
      transitions: 6,
      expanded: 3,
      violations: ["reached 4\n  after 2\n  2", "and again\n  after 2\n  2"],
    });
  });

  it("explores from every root", () => {
    const report = explore({
      roots: [{ at: "a" }, { at: "b" }],
      depth: 1,
      events: () => [{ go: "x" }],
      step: (state: { at: string }, event: { go: string }) => ({
        state: { at: state.at + event.go },
      }),
      key: (state) => state.at,
      check: (before, _event, result) =>
        before.at === "b" ? [`from b to ${result.state.at}`] : [],
    });
    expect(report).toEqual({
      transitions: 2,
      expanded: 2,
      violations: ['from b to bx\n  after {"go":"x"}'],
    });
  });

  it("expands a state that two roots share once", () => {
    const report = explore({
      roots: [3, 3],
      depth: 1,
      events: () => [1],
      step: (state: number, event: number) => ({ state: state + event }),
      key: (state) => String(state),
      check: () => [],
    });
    expect(report).toEqual({ transitions: 1, expanded: 1, violations: [] });
  });

  it("keys no state a step returns unchanged, nor one reached at the last depth", () => {
    const keyed: Array<number> = [];
    const report = explore({
      roots: [0],
      depth: 3,
      events: () => ["stay", "move"],
      step: (state: number, event: string) => ({ state: event === "stay" ? state : state + 1 }),
      key: (state) => {
        keyed.push(state);
        return String(state);
      },
      check: () => [],
    });
    expect(keyed).toEqual([0, 1, 2]);
    expect(report).toEqual({ transitions: 6, expanded: 3, violations: [] });
  });
});
