import { describe, expect, it } from "vite-plus/test";

import {
  initialWakeState,
  makePlatformSignals,
  wakeStep,
  type PageEvent,
  type PlatformSignal,
  type SignalClocks,
} from "./signals.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const START_WALL_MS = Date.UTC(2026, 8, 23, 10, 0, 0);

/** One page event at `atMs` on the monotonic clock; `wallAheadMs` is how far the wall clock ran ahead so far. */
type Step = readonly [atMs: number, event: PageEvent, wallAheadMs?: number];

/** The signals the definition emits for `steps`, each with the monotonic time it was heard at. */
function heard(
  steps: ReadonlyArray<Step>,
  page: { readonly hidden?: boolean; readonly online?: boolean } = {},
): ReadonlyArray<readonly [number, PlatformSignal]> {
  const clocks = (atMs: number, wallAheadMs = 0): SignalClocks => ({
    wall: START_WALL_MS + atMs + wallAheadMs,
    mono: atMs,
  });
  let state = initialWakeState(
    { hidden: page.hidden ?? false, online: page.online ?? true },
    clocks(0),
  );
  const out: Array<readonly [number, PlatformSignal]> = [];
  for (const [atMs, event, wallAheadMs] of steps) {
    const step = wakeStep(state, event, clocks(atMs, wallAheadMs));
    state = step.state;
    for (const signal of step.signals) out.push([atMs, signal]);
  }
  return out;
}

const wakes = (steps: ReadonlyArray<Step>, page?: Parameters<typeof heard>[1]) =>
  heard(steps, page).filter(([, signal]) => signal.type === "wake");

describe("the wake definition (DESIGN §6.4)", () => {
  it("an iframe focus round trip triggers no resubscribe", () => {
    expect(
      wakes([
        [0, { type: "blur" }],
        [4 * SECOND, { type: "focus" }],
      ]),
    ).toEqual([]);
  });

  it.each([
    ["a tab switch back after 29 s", "visibility", 29 * SECOND, []],
    ["a tab switch back after 30 s", "visibility", 30 * SECOND, ["shown"]],
    ["focus back after 29 s in another window", "focus", 29 * SECOND, []],
    ["focus back after 30 s in another window", "focus", 30 * SECOND, ["focus"]],
  ] as const)("%s", (_case, away, afterMs, causes) => {
    const steps: ReadonlyArray<Step> =
      away === "visibility"
        ? [
            [0, { type: "visibility", hidden: true }],
            [afterMs, { type: "visibility", hidden: false }],
          ]
        : [
            [0, { type: "blur" }],
            [afterMs, { type: "focus" }],
          ];
    expect(wakes(steps).map(([, signal]) => signal)).toEqual(
      causes.map((cause) => ({ type: "wake", visible: true, cause })),
    );
  });

  it("a hidden tab's throttled ticks never fire retries", () => {
    // Hidden for an hour, ticked once a minute or two as a throttled tab is.
    const steps: Step[] = [[0, { type: "visibility", hidden: true }]];
    for (let atMs = 0, turn = 0; atMs < 60 * MINUTE; turn++) {
      atMs += turn % 3 === 0 ? 2 * MINUTE : MINUTE;
      steps.push([atMs, { type: "tick" }]);
    }
    expect(wakes(steps)).toEqual([]);
  });

  it.each([
    ["visible", false, true],
    ["hidden", true, false],
  ] as const)(
    "a sleep while %s shows as the clocks drifting apart between ticks",
    (_page, hidden, visible) => {
      expect(
        wakes(
          [
            [0, { type: "tick" }],
            [15 * SECOND, { type: "tick" }],
            // The monotonic clock stood still for 10 minutes of the wall clock's.
            [30 * SECOND, { type: "tick" }, 10 * MINUTE],
          ],
          { hidden },
        ),
      ).toEqual([[30 * SECOND, { type: "wake", visible, cause: "sleep" }]]);
    },
  );

  it.each([
    ["5 s", 5 * SECOND, []],
    ["5.001 s", 5 * SECOND + 1, [{ type: "wake", visible: true, cause: "sleep" }]],
  ] as const)("a wall clock %s ahead of the monotonic one between ticks", (_gap, ahead, out) => {
    expect(
      wakes([
        [0, { type: "tick" }],
        [15 * SECOND, { type: "tick" }, ahead],
      ]).map(([, signal]) => signal),
    ).toEqual(out);
  });

  it("a tick gap over 5 minutes on both clocks is a sleep", () => {
    expect(
      wakes([
        [0, { type: "tick" }],
        [5 * MINUTE, { type: "tick" }],
        [10 * MINUTE + 1, { type: "tick" }],
      ]),
    ).toEqual([[10 * MINUTE + 1, { type: "wake", visible: true, cause: "sleep" }]]);
  });

  it.each([
    ["resume", { type: "resume" }, false, [{ type: "wake", visible: true, cause: "resume" }]],
    [
      "resume while hidden",
      { type: "resume" },
      true,
      [{ type: "wake", visible: false, cause: "resume" }],
    ],
    [
      "a back-forward cache return",
      { type: "pageshow", persisted: true },
      false,
      [{ type: "restored" }, { type: "wake", visible: true, cause: "pageshow" }],
    ],
    [
      "a back-forward cache return before the page reports it shown",
      { type: "pageshow", persisted: true },
      true,
      [{ type: "restored" }, { type: "wake", visible: true, cause: "pageshow" }],
    ],
    ["a first page load", { type: "pageshow", persisted: false }, false, []],
    [
      "online",
      { type: "online" },
      false,
      [
        { type: "network", online: true },
        { type: "wake", visible: true, cause: "online" },
      ],
    ],
    ["online while hidden", { type: "online" }, true, [{ type: "network", online: true }]],
    ["offline", { type: "offline" }, false, [{ type: "network", online: false }]],
  ] as const)("%s", (_case, event, hidden, out) => {
    const page = { hidden, online: event.type !== "online" };
    expect(heard([[MINUTE, event]], page).map(([, signal]) => signal)).toEqual(out);
  });

  it("coalesces wakes to at most one per 10 s", () => {
    expect(
      wakes([
        [0, { type: "resume" }],
        [3 * SECOND, { type: "online" }],
        [4 * SECOND, { type: "offline" }],
        [9 * SECOND, { type: "pageshow", persisted: true }],
        [9_999, { type: "online" }],
        [10 * SECOND, { type: "resume" }],
        [15 * SECOND, { type: "resume" }],
      ]).map(([atMs]) => atMs),
    ).toEqual([0, 10 * SECOND]);
  });

  it.each([
    ["resume", { type: "resume" }],
    ["shown", { type: "visibility", hidden: false }],
  ] as const)("a restore within 10 s of a wake by %s still says restored", (_case, first) => {
    expect(
      heard(
        [
          [MINUTE, first],
          [MINUTE + 5, { type: "pageshow", persisted: true }],
        ],
        { hidden: true },
      )
        .map(([, signal]) => signal)
        .filter((signal) => signal.type === "restored"),
    ).toEqual([{ type: "restored" }]);
  });

  it("a hidden wake never holds back the visible wake after it", () => {
    expect(
      wakes(
        [
          [MINUTE, { type: "resume" }],
          [MINUTE + 2 * SECOND, { type: "visibility", hidden: false }],
        ],
        { hidden: true },
      ).map(([, signal]) => signal),
    ).toEqual([
      { type: "wake", visible: false, cause: "resume" },
      { type: "wake", visible: true, cause: "shown" },
    ]);
  });
});

describe("makePlatformSignals", () => {
  /** A page whose events the test sends, on a clock the test moves. */
  const fakePage = () => {
    let nowMs = 0;
    let hidden = false;
    const hearers = new Set<(event: PageEvent) => void>();
    return {
      source: {
        hidden: () => hidden,
        online: () => true,
        now: () => ({ wall: START_WALL_MS + nowMs, mono: nowMs }),
        listen: (hear: (event: PageEvent) => void) => {
          hearers.add(hear);
          return () => {
            hearers.delete(hear);
          };
        },
      },
      heard: () => hearers.size,
      send: (atMs: number, event: PageEvent) => {
        nowMs = atMs;
        if (event.type === "visibility") hidden = event.hidden;
        for (const hear of hearers) hear(event);
      },
    };
  };

  it("runs one definition for every listener, and hears the page only while one listens", () => {
    const page = fakePage();
    const signals = makePlatformSignals(page.source);
    const first: PlatformSignal[] = [];
    const second: PlatformSignal[] = [];
    expect(page.heard()).toBe(0);

    const stopFirst = signals.listen((signal) => first.push(signal));
    const stopSecond = signals.listen((signal) => second.push(signal));
    expect(page.heard()).toBe(1);
    page.send(0, { type: "visibility", hidden: true });
    expect(signals.hidden()).toBe(true);
    page.send(40 * SECOND, { type: "visibility", hidden: false });
    page.send(41 * SECOND, { type: "resume" });

    const expected: PlatformSignal[] = [
      { type: "visibility", hidden: true },
      { type: "visibility", hidden: false },
      { type: "wake", visible: true, cause: "shown" },
    ];
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    stopFirst();
    stopSecond();
    expect(page.heard()).toBe(0);
  });
});
