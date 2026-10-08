import { describe, expect, it } from "@effect/vitest";
import { ConversationId, EffectId, RunId, SessionId } from "@t3tools/contracts";

import { initialState } from "./domain/state.ts";
import { engineStateBlockers } from "./updateIdle.ts";

describe("auto-update idle proof", () => {
  it.each([
    { name: "active run", patch: { activeRunId: RunId.make("active") }, reason: "active run" },
    {
      name: "accepted queued run",
      patch: { queue: [RunId.make("queued")] },
      reason: "accepted run",
    },
    {
      name: "unended run even when its active pointer is missing",
      patch: { runs: { lost: { end: null } } },
      reason: "accepted run",
    },
    { name: "approval or question", patch: { requests: { question: {} } }, reason: "open request" },
    {
      name: "answer waiting for its receipt",
      patch: { answering: { answer: {} } },
      reason: "open request",
    },
    {
      name: "process-bound or replay-safe effect",
      patch: { effects: { write: {} } },
      reason: "unsettled effect",
    },
    {
      name: "closing native session",
      patch: {
        closing: {
          sessionId: SessionId.make("session"),
          reason: "idle" as const,
          effectId: EffectId.make("close"),
        },
      },
      reason: "session closing",
    },
  ])("$name postpones an update", ({ patch, reason }) => {
    expect(
      engineStateBlockers({ ...initialState(ConversationId.make("idle")), ...patch }),
    ).toContain(reason);
  });

  it("a conversation with no accepted work is idle", () => {
    expect(engineStateBlockers(initialState(ConversationId.make("idle")))).toEqual([]);
  });
});
