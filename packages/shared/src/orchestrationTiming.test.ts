import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";

import { isLatestTurnSettled } from "./orchestrationTiming.ts";

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
