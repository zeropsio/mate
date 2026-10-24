import { describe, expect, it } from "@effect/vitest";

import {
  initialReconnect,
  reconnectStep,
  reconnectView,
  type ReconnectEvent,
  type ReconnectState,
} from "./reconnectSchedule.logic.ts";

const T0 = 1_000_000;

/** Feeds events with the instants they happen at. */
const run = (
  events: ReadonlyArray<readonly [at: number, event: ReconnectEvent]>,
  from: ReconnectState = initialReconnect(),
): ReconnectState => events.reduce((state, [at, event]) => reconnectStep(state, event, at), from);

/** One refused attempt at `at`: a try begins and fails. */
const failedTry = (
  at: number,
  failure: "network" | "not_mate_opener" | "below_floor" = "network",
) =>
  [
    [at, { tag: "attempt-started" }],
    [at, { tag: "attempt-failed", failure }],
  ] as const;

describe("a Mate connection's reconnect schedule", () => {
  it.each([
    { failures: 1, onScreen: true, waitMs: 2_000 },
    { failures: 2, onScreen: true, waitMs: 4_000 },
    { failures: 3, onScreen: true, waitMs: 8_000 },
    { failures: 4, onScreen: true, waitMs: 15_000 },
    { failures: 5, onScreen: true, waitMs: 30_000 },
    { failures: 6, onScreen: true, waitMs: 60_000 },
    { failures: 40, onScreen: true, waitMs: 60_000 },
    { failures: 5, onScreen: false, waitMs: 30_000 },
    { failures: 6, onScreen: false, waitMs: 300_000 },
    { failures: 40, onScreen: false, waitMs: 300_000 },
  ])(
    "waits $waitMs ms after failure $failures (on screen: $onScreen)",
    ({ failures, onScreen, waitMs }) => {
      let state = reconnectStep(initialReconnect(), { tag: "screen", onScreen }, T0);
      for (let n = 0; n < failures; n += 1) {
        state = run([...failedTry(T0)], state);
      }
      expect(reconnectView(state, T0)).toEqual({
        kind: "waiting",
        dueAtMs: T0 + waitMs,
        inMs: waitMs,
      });
    },
  );

  it("counts no wait while the tab is hidden, and tries at once when it is seen again", () => {
    const failed = run([...failedTry(T0), [T0 + 500, { tag: "visibility", visible: false }]]);
    // An hour hidden is still no deadline: the wait is paused, not running out.
    expect(reconnectView(failed, T0 + 3_600_000)).toEqual({ kind: "paused" });
    const seen = reconnectStep(failed, { tag: "visibility", visible: true }, T0 + 3_600_000);
    expect(reconnectView(seen, T0 + 3_600_000)).toEqual({
      kind: "waiting",
      dueAtMs: T0 + 3_600_000,
      inMs: 0,
    });
  });

  it.each(["wake", "network", "mate-state"] as const)(
    "a %s releases the wait at once, and the next failure waits its own rung",
    (cause) => {
      const waiting = run([...failedTry(T0), ...failedTry(T0 + 2_000)]);
      const released = reconnectStep(waiting, { tag: "release", cause }, T0 + 3_000);
      expect(reconnectView(released, T0 + 3_000)).toEqual({
        kind: "waiting",
        dueAtMs: T0 + 3_000,
        inMs: 0,
      });
      const failedAgain = run([...failedTry(T0 + 3_000)], released);
      expect(reconnectView(failedAgain, T0 + 3_000)).toMatchObject({ inMs: 8_000 });
    },
  );

  it.each(["not_mate_opener", "below_floor"] as const)(
    "%s ends the retries until the person asks again",
    (failure) => {
      const ended = run([...failedTry(T0, "network"), ...failedTry(T0 + 2_000, failure)]);
      expect(reconnectView(ended, T0 + 9_000_000)).toEqual({ kind: "ended", reason: failure });
      // Nothing but the person's Try again moves it: a wake or the network do not.
      const woken = reconnectStep(ended, { tag: "release", cause: "wake" }, T0 + 10_000);
      expect(reconnectView(woken, T0 + 10_000)).toEqual({ kind: "ended", reason: failure });
      const again = reconnectStep(ended, { tag: "try-again" }, T0 + 20_000);
      expect(reconnectView(again, T0 + 20_000)).toEqual({
        kind: "waiting",
        dueAtMs: T0 + 20_000,
        inMs: 0,
      });
      // The rungs start over.
      expect(reconnectView(run([...failedTry(T0 + 20_000)], again), T0 + 20_000)).toMatchObject({
        inMs: 2_000,
      });
    },
  );

  it("a connection that opened starts the rungs over, and a lost one waits the first rung", () => {
    const connected = run([...failedTry(T0), ...failedTry(T0), [T0, { tag: "connected" }]]);
    expect(reconnectView(connected, T0)).toEqual({ kind: "connected" });
    const lost = reconnectStep(connected, { tag: "lost" }, T0 + 50_000);
    expect(reconnectView(lost, T0 + 50_000)).toEqual({
      kind: "waiting",
      dueAtMs: T0 + 52_000,
      inMs: 2_000,
    });
  });
});
