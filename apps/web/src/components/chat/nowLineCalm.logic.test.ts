import { describe, expect, it } from "vite-plus/test";

import {
  calmClockMs,
  calmLineDue,
  calmLineOffer,
  calmLineSettle,
  calmLineStart,
  NOW_LINE_DWELL_MS,
  type CalmLine,
} from "./nowLineCalm.logic";

const D = NOW_LINE_DWELL_MS;

/** A line arriving at a moment; `final` once the run is over. */
interface Arrival {
  readonly at: number;
  readonly words: string;
  readonly final?: boolean;
}

/**
 * Runs the line as the card does: the first arrival shows, each later one is
 * offered, and time runs to each waiting line's due moment in between. What
 * it returns is every change the person sees: when, and to which words.
 */
function watch(arrivals: ReadonlyArray<Arrival>, until: number): Array<[number, string]> {
  const [first, ...rest] = arrivals;
  if (first === undefined) return [];
  let calm: CalmLine<string> = calmLineStart(first.words, first.words, first.at);
  const seen: Array<[number, string]> = [[first.at, first.words]];
  const runTo = (at: number) => {
    const due = calmLineDue(calm);
    if (due === null || due > at) return;
    const next = calmLineSettle(calm, due);
    if (next.key !== calm.key) seen.push([due, next.key]);
    calm = next;
  };
  for (const arrival of rest) {
    runTo(arrival.at);
    const next = calmLineOffer(
      calm,
      arrival.words,
      arrival.words,
      arrival.at,
      arrival.final === true,
    );
    if (next.key !== calm.key) seen.push([arrival.at, next.key]);
    calm = next;
  }
  runTo(until);
  return seen;
}

describe("the now line, calm", () => {
  it.each<{
    readonly name: string;
    readonly arrivals: ReadonlyArray<Arrival>;
    readonly shows: ReadonlyArray<[number, string]>;
  }>([
    {
      name: "a single change after the dwell shows at once",
      arrivals: [
        { at: 0, words: "Reading index.ts" },
        { at: D + 300, words: "Running the tests" },
      ],
      shows: [
        [0, "Reading index.ts"],
        [D + 300, "Running the tests"],
      ],
    },
    {
      name: "a single change within the dwell waits for its end",
      arrivals: [
        { at: 0, words: "Reading index.ts" },
        { at: 200, words: "Running the tests" },
      ],
      shows: [
        [0, "Reading index.ts"],
        [D, "Running the tests"],
      ],
    },
    {
      name: "a burst shows its latest only, when the dwell ends",
      arrivals: [
        { at: 0, words: "Thinking" },
        { at: 120, words: "Reading a.ts" },
        { at: 240, words: "Reading b.ts" },
        { at: 390, words: "Reading c.ts" },
        { at: 610, words: "Checking /status in the browser" },
      ],
      shows: [
        [0, "Thinking"],
        [D, "Checking /status in the browser"],
      ],
    },
    {
      name: "a burst running past the dwell changes once a dwell",
      arrivals: [
        { at: 0, words: "a" },
        { at: 300, words: "b" },
        { at: 600, words: "c" },
        { at: 900, words: "d" },
        { at: D + 200, words: "e" },
        { at: D + 500, words: "f" },
        { at: D + 800, words: "g" },
      ],
      shows: [
        [0, "a"],
        [D, "d"],
        [2 * D, "g"],
      ],
    },
    {
      name: "a line that comes back within the dwell drops what waited",
      arrivals: [
        { at: 0, words: "Thinking" },
        { at: 150, words: "Reading a.ts" },
        { at: 400, words: "Thinking" },
      ],
      shows: [[0, "Thinking"]],
    },
    {
      name: "the run's end shows at once, over what waited",
      arrivals: [
        { at: 0, words: "Deploying appdev" },
        { at: 100, words: "Checking /status in the browser" },
        { at: 250, words: "Nova worked 1m 20s", final: true },
      ],
      shows: [
        [0, "Deploying appdev"],
        [250, "Nova worked 1m 20s"],
      ],
    },
    {
      name: "a return after idle shows at once",
      arrivals: [
        { at: 0, words: "Waiting for your answer" },
        { at: 45_000, words: "Reading the answer" },
        { at: 45_000 + 100, words: "Writing" },
      ],
      shows: [
        [0, "Waiting for your answer"],
        [45_000, "Reading the answer"],
        [45_000 + D, "Writing"],
      ],
    },
  ])("$name", ({ arrivals, shows }) => {
    expect(watch(arrivals, 60_000)).toEqual(shows);
  });

  it("changes nothing for words already shown or already waiting", () => {
    const shown = calmLineStart("Thinking", "Thinking", 0);
    expect(calmLineOffer(shown, "Thinking", "Thinking", 100, false)).toBe(shown);
    const waiting = calmLineOffer(shown, "Reading a.ts", "Reading a.ts", 200, false);
    expect(calmLineOffer(waiting, "Reading a.ts", "Reading a.ts", 300, false)).toBe(waiting);
    expect(calmLineDue(waiting)).toBe(D);
  });
});

describe("the run's clock", () => {
  it.each([
    { name: "the first read", last: null, run: "r1", ms: 80_000, shows: 80_000 },
    { name: "counting on", last: { run: "r1", ms: 80_000 }, run: "r1", ms: 81_000, shows: 81_000 },
    {
      name: "never back within a run",
      last: { run: "r1", ms: 80_000 },
      run: "r1",
      ms: 20_000,
      shows: 80_000,
    },
    {
      name: "another run counts from its own start",
      last: { run: "r1", ms: 80_000 },
      run: "r2",
      ms: 2_000,
      shows: 2_000,
    },
  ])("$name", ({ last, run, ms, shows }) => {
    expect(calmClockMs(last, run, ms)).toBe(shows);
  });
});
