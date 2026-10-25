import { describe, expect, it } from "@effect/vitest";

import { reconnectWaitMs } from "./reconnectSchedule.logic.ts";

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
      expect(reconnectWaitMs(failures, onScreen)).toBe(waitMs);
    },
  );
});
