import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";

import {
  agentStoppedUnexpectedly,
  brokeOffReason,
  hasUnseenCompletion,
  kindForAwarenessPhase,
  mateMarkStateForThread,
  mateMarkStateForThreadStatus,
  resolveThreadStatus,
  type ThreadStatusKind,
  viewerThreadKind,
} from "./threadStatus.ts";
import { threadStatusVectors } from "./threadStatus.vectors.ts";

describe("resolveThreadStatus", () => {
  it.each([null, "You've hit your weekly limit"])(
    "a refused SDK turn is not admitted work, even while its session stays running (%s)",
    (lastError) => {
      const thread = {
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
        interactionMode: "default" as const,
        backgroundLiveness: null,
        latestTurn: {
          turnId: TurnId.make("refused"),
          state: "running" as const,
          startedAt: "2026-10-08T10:00:00Z",
          completedAt: null,
        },
        session: { status: "running" as const, providerName: "claudeAgent", lastError },
        usagePause: lastError === null ? { resetsAt: "2026-10-10T00:00:00Z" } : null,
      };
      expect(resolveThreadStatus(thread, "limited")).toEqual({ kind: "failed", toneId: "danger" });
      expect(resolveThreadStatus({ ...thread, hasPendingUserInput: true }, "limited").kind).toBe(
        "input",
      );
      expect(
        resolveThreadStatus({
          ...thread,
          usagePause: null,
          session: { status: "running", lastError: null },
        }).kind,
      ).toBe("working");
    },
  );
  it.each(threadStatusVectors)("resolves $name", (vector) => {
    expect(resolveThreadStatus(vector.input)).toEqual(vector.expected);
    if (vector.expectedAwarenessPhase === null) return;

    expect(kindForAwarenessPhase(vector.expectedAwarenessPhase)).toBe(
      vector.expectedAwarenessPhase === "completed" ? "done" : vector.expected.kind,
    );
  });
});

describe("viewerThreadKind", () => {
  // A digest (`mateLink`) carries no wake: the vectors that woke are the chat's own, never a row's.
  const unwoken = threadStatusVectors.filter((vector) => !vector.input.wokeAt);
  const visits = [undefined, null, "2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z"];

  it.each(unwoken)("finishes a digest's kind to the resolver's own answer for $name", (vector) => {
    const { lastVisitedAt: _visit, ...unvisited } = vector.input;
    const digest = {
      kind: resolveThreadStatus(unvisited).kind,
      completedAt: vector.input.latestTurn?.completedAt ?? null,
    };
    for (const lastVisitedAt of [vector.input.lastVisitedAt, ...visits]) {
      expect(viewerThreadKind(digest, lastVisitedAt)).toBe(
        resolveThreadStatus(
          lastVisitedAt === undefined ? unvisited : { ...unvisited, lastVisitedAt },
        ).kind,
      );
    }
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

describe("a run that broke off", () => {
  it.each([
    [
      "claudeAgent",
      "Claude Code stopped unexpectedly. Send a message to pick up where it left off.",
    ],
    ["codex", "Codex stopped unexpectedly. Send a message to pick up where it left off."],
    ["cursor", "Cursor stopped unexpectedly. Send a message to pick up where it left off."],
    ["opencode", "OpenCode stopped unexpectedly. Send a message to pick up where it left off."],
    ["grok", "Grok stopped unexpectedly. Send a message to pick up where it left off."],
    [
      "antigravity",
      "Antigravity stopped unexpectedly. Send a message to pick up where it left off.",
    ],
    ["someday", "The agent stopped unexpectedly. Send a message to pick up where it left off."],
  ])("says %s stopped in plain words", (driver, words) => {
    expect(agentStoppedUnexpectedly(driver)).toBe(words);
  });

  it.each([
    [
      "Codex stopped unexpectedly. Send a message to pick up where it left off.",
      "Codex stopped unexpectedly.",
    ],
    [
      "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
      "Claude's sign-in has expired.",
    ],
    ["API Error: 500 Internal server error", "API Error: 500 Internal server error"],
    [
      "Send a message to pick up where it left off.",
      "Send a message to pick up where it left off.",
    ],
  ])("keeps only why on an earlier run: %s", (words, reason) => {
    expect(brokeOffReason(words)).toBe(reason);
  });
});

it("pending restart work stays actionable through a provider rebind and yields to an answerable question", () => {
  const input = {
    ...threadStatusVectors[0]!.input,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestTurn: null,
    session: {
      status: "ready" as const,
      interruption: {
        turnId: TurnId.make("cut"),
        restart: { cause: "restarted" as const, at: "2026-10-08T08:24:39.700Z" },
        continuation: "manual" as const,
      },
    },
  };
  expect(resolveThreadStatus(input)).toEqual({ kind: "failed", toneId: "attention" });
  expect(resolveThreadStatus({ ...input, hasPendingUserInput: true })).toEqual({
    kind: "input",
    toneId: "input",
  });
});
