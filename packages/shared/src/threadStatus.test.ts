import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";

import { hasUnseenCompletion, kindForAwarenessPhase, resolveThreadStatus } from "./threadStatus.ts";
import { threadStatusVectors } from "./threadStatus.vectors.ts";

describe("resolveThreadStatus", () => {
  it.each(threadStatusVectors)("resolves $name", (vector) => {
    expect(resolveThreadStatus(vector.input)).toEqual(vector.expected);
    if (vector.expectedAwarenessPhase === null) return;

    expect(kindForAwarenessPhase(vector.expectedAwarenessPhase)).toBe(
      vector.expectedAwarenessPhase === "completed" ? "done" : vector.expected.kind,
    );
  });
});

describe("thread status facts", () => {
  it("requires a client visit marker before a completion can be unseen", () => {
    const turn = {
      turnId: TurnId.make("turn-1"),
      state: "completed" as const,
      requestedAt: "2026-03-09T10:00:00.000Z",
      startedAt: "2026-03-09T10:00:00.000Z",
      completedAt: "2026-03-09T10:05:00.000Z",
      assistantMessageId: null,
    };
    expect(
      hasUnseenCompletion({ latestTurn: turn, lastVisitedAt: "2026-03-09T10:04:00.000Z" }),
    ).toBe(true);
    expect(hasUnseenCompletion({ latestTurn: turn })).toBe(false);
  });
});
