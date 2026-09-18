import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";

import { formatDuration, formatElapsed, isLatestTurnSettled } from "./orchestrationTiming.ts";

describe("isLatestTurnSettled", () => {
  const latestTurn = {
    turnId: TurnId.make("turn-1"),
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("requires timestamps and a session that is no longer running", () => {
    expect(
      isLatestTurnSettled(latestTurn, {
        status: "running",
        activeTurnId: TurnId.make("turn-2"),
      }),
    ).toBe(false);
    expect(
      isLatestTurnSettled(latestTurn, {
        orchestrationStatus: "running",
        activeTurnId: TurnId.make("turn-2"),
      }),
    ).toBe(false);
    expect(isLatestTurnSettled(latestTurn, { status: "ready", activeTurnId: null })).toBe(true);
    expect(
      isLatestTurnSettled(latestTurn, { orchestrationStatus: "ready", activeTurnId: null }),
    ).toBe(true);
    expect(isLatestTurnSettled({ ...latestTurn, startedAt: null }, null)).toBe(false);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "1ms"],
    [250, "250ms"],
    [1_500, "1.5s"],
    [9_950, "10s"],
    [22_000, "22s"],
    [60_000, "1m"],
    [65_000, "1m 5s"],
    [119_500, "2m"],
    [3_599_499, "59m 59s"],
    [3_599_500, "1h"],
    [3_600_000, "1h"],
    [3_601_000, "1h 1s"],
    [3_660_000, "1h 1m"],
    [3_661_000, "1h 1m 1s"],
    [7_199_500, "2h"],
    [25_190_000, "6h 59m 50s"],
    [90_061_000, "25h 1m 1s"],
  ])("formats %d ms as %s", (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });

  it.each([-1, NaN, Infinity, -Infinity])("handles invalid durations: %s", (durationMs) => {
    expect(formatDuration(durationMs)).toBe("0ms");
  });
});

describe("formatElapsed", () => {
  it("formats a long run across midnight", () => {
    expect(formatElapsed("2026-09-03T22:00:00Z", "2026-09-04T04:59:50Z")).toBe("6h 59m 50s");
  });
});
