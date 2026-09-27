import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  kindForAwarenessPhase,
  mateMarkStateForThread,
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusKind,
} from "./threadStatus.ts";
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

describe("mateMarkStateForThreadStatus", () => {
  // Exhaustive on purpose: a kind added to the resolver must choose a face here.
  it.each([
    ["approval", "needs"],
    ["input", "needs"],
    ["planReady", "needs"],
    ["woke", "needs"],
    ["failed", "needs"],
    ["connecting", "working"],
    ["working", "working"],
    ["monitoring", "working"],
    ["done", "done"],
    ["idle", "idle"],
  ] as const satisfies ReadonlyArray<readonly [ThreadStatusKind, string]>)(
    "%s wears the %s face",
    (kind, face) => {
      expect(mateMarkStateForThreadStatus(kind)).toBe(face);
    },
  );

  it("agrees with every resolver vector", () => {
    for (const vector of threadStatusVectors) {
      expect(mateMarkStateForThreadStatus(resolveThreadStatus(vector.input).kind)).toBeDefined();
    }
  });
});

describe("mateMarkStateForThread — a thread paused at a usage limit", () => {
  it.each([
    // Asleep until the limit resets: it will not do anything before then,
    // and the resume picks its work up without anybody.
    ["working", true, "sleep"],
    ["failed", true, "sleep"],
    ["done", true, "sleep"],
    ["idle", true, "sleep"],
    ["monitoring", true, "sleep"],
    // What waits on a person still does, paused or not.
    ["approval", true, "needs"],
    ["input", true, "needs"],
    // Not paused: the status's own face.
    ["working", false, "working"],
    ["failed", false, "needs"],
    ["done", false, "done"],
    ["idle", false, "idle"],
  ] as const satisfies ReadonlyArray<readonly [ThreadStatusKind, boolean, string]>)(
    "%s, paused %s, wears the %s face",
    (kind, paused, face) => {
      expect(mateMarkStateForThread(kind, paused)).toBe(face);
    },
  );
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
