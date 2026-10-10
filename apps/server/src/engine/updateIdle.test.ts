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

  // Sage, 2026-10-10 13:26Z: switched to the engine, it was restarted onto the next version 21 s
  // into its V1 history import, which the next boot had to requeue.
  it.each([
    { import: "importing", waits: true },
    { import: "complete", waits: false },
    { import: "failed", waits: false },
  ] as const)(
    "an update waits while a Mate's history import is running: $import",
    ({ import: state, waits }) => {
      const history = {
        state,
        source: { kind: "v1" as const, threadId: "thread" },
        runs: 12,
        cursor: 400,
      };
      expect(
        engineStateBlockers({ ...initialState(ConversationId.make("sage")), history }).includes(
          "history import",
        ),
      ).toBe(waits);
    },
  );

  // An ask lives in the engine's own record: an update keeps it, and the person answers it after.
  it("a value asked of the person does not postpone an update", () => {
    const requests = { ask: { kind: "vault" } };
    expect(engineStateBlockers({ ...initialState(ConversationId.make("idle")), requests })).toEqual(
      [],
    );
  });

  it("a conversation with no accepted work is idle", () => {
    expect(engineStateBlockers(initialState(ConversationId.make("idle")))).toEqual([]);
  });
});
