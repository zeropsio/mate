import { describe, expect, it } from "@effect/vitest";

import { rotationDecision, type RotationFacts } from "./rotationDecision.ts";

const steady: RotationFacts = {
  moment: "turn-start",
  transcriptMissing: false,
  resumeFailed: false,
  compactions: 0,
  rotateAfter: 3,
  stintPrincipal: "user-1",
  principal: "user-1",
  running: { brief: 4, job: 2 },
  current: { brief: 4, job: 2 },
  stintLogin: "claudeAgent",
  login: "claudeAgent",
  freshTask: false,
  startFresh: false,
  rotationsThisAttempt: 0,
};

describe("rotationDecision", () => {
  it.each<{ name: string; facts: Partial<RotationFacts>; rotation: unknown }>([
    { name: "nothing changed keeps the conversation", facts: {}, rotation: { kind: "keep" } },
    {
      name: "a model or effort change is not an input: the same facts keep it",
      facts: { moment: "idle" },
      rotation: { kind: "keep" },
    },
    // CONCEPT §3A.4 triggers
    {
      name: "a missing transcript before a resume rotates at once",
      facts: { transcriptMissing: true },
      rotation: { kind: "rotate", reason: "transcript-missing", counted: true },
    },
    {
      name: "a provider error on the first turn after a resume rotates at once",
      facts: { resumeFailed: true, moment: "idle" },
      rotation: { kind: "rotate", reason: "resume-failed", counted: true },
    },
    {
      name: "rapid_refill_breaker rotates at once",
      facts: { lastTerminalReason: "rapid_refill_breaker", moment: "idle" },
      rotation: { kind: "rotate", reason: "context-overflow", counted: true },
    },
    {
      name: "prompt_too_long rotates at once",
      facts: { lastTerminalReason: "prompt_too_long" },
      rotation: { kind: "rotate", reason: "context-overflow", counted: true },
    },
    {
      name: "another terminal reason keeps it",
      facts: { lastTerminalReason: "completed" },
      rotation: { kind: "keep" },
    },
    {
      name: "rotate_after compactions wait for the next task",
      facts: { compactions: 3 },
      rotation: { kind: "pending", reason: "compactions" },
    },
    {
      name: "rotate_after compactions rotate at the next task",
      facts: { compactions: 4, moment: "task-start" },
      rotation: { kind: "rotate", reason: "compactions", counted: true },
    },
    {
      name: "rotate_after 0 never rotates for compactions",
      facts: { compactions: 20, rotateAfter: 0, moment: "task-start" },
      rotation: { kind: "keep" },
    },
    {
      name: "the second rework rotates before it starts",
      facts: { reworkDispatch: 2 },
      rotation: { kind: "rotate", reason: "second-rework", counted: true },
    },
    { name: "the first rework keeps it", facts: { reworkDispatch: 1 }, rotation: { kind: "keep" } },
    {
      name: "a task marked unrelated rotates at its dispatch",
      facts: { freshTask: true, moment: "task-start" },
      rotation: { kind: "rotate", reason: "fresh-task", counted: true },
    },
    {
      name: "a different principal waits for the next task",
      facts: { principal: "user-2" },
      rotation: { kind: "pending", reason: "principal-changed" },
    },
    {
      name: "a different principal rotates at the next task",
      facts: { principal: "user-2", moment: "task-start" },
      rotation: { kind: "rotate", reason: "principal-changed", counted: true },
    },
    // PRD §5.6 on the probe-22 fallback
    {
      name: "Save — the next turn starts a fresh conversation: pending while idle",
      facts: { moment: "idle", current: { brief: 5, job: 2 }, apply: "nextTurn" },
      rotation: { kind: "pending", reason: "prompt-changed" },
    },
    {
      name: "Save — the next turn starts a fresh conversation: rotates at the next turn",
      facts: { current: { brief: 4, job: 3 }, apply: "nextTurn" },
      rotation: { kind: "rotate", reason: "prompt-changed", counted: false },
    },
    {
      name: "a pending version whose choice was lost applies at the next turn",
      facts: { moment: "idle", current: { brief: 5, job: 2 } },
      rotation: { kind: "pending", reason: "prompt-changed" },
    },
    {
      name: "Save and apply now rotates at once",
      facts: { moment: "idle", current: { brief: 4, job: 3 }, apply: "now" },
      rotation: { kind: "rotate", reason: "prompt-changed", counted: false },
    },
    {
      name: "Save and start fresh rotates at once",
      facts: { moment: "idle", current: { brief: 4, job: 3 }, apply: "fresh" },
      rotation: { kind: "rotate", reason: "prompt-changed", counted: false },
    },
    {
      name: "a new login always rotates at once",
      facts: { moment: "idle", login: "claudeAgent-work" },
      rotation: { kind: "rotate", reason: "login-changed", counted: false },
    },
    {
      name: "Start fresh rotates between turns",
      facts: { moment: "idle", startFresh: true },
      rotation: { kind: "rotate", reason: "start-fresh", counted: false },
    },
    // At most 2 rotations per attempt
    {
      name: "a third automatic rotation in one attempt parks the task",
      facts: { lastTerminalReason: "prompt_too_long", rotationsThisAttempt: 2 },
      rotation: { kind: "park", reason: "context-overflow" },
    },
    {
      name: "the second automatic rotation still happens",
      facts: { lastTerminalReason: "prompt_too_long", rotationsThisAttempt: 1 },
      rotation: { kind: "rotate", reason: "context-overflow", counted: true },
    },
    {
      name: "the person's rotations never park",
      facts: { moment: "idle", startFresh: true, rotationsThisAttempt: 2 },
      rotation: { kind: "rotate", reason: "start-fresh", counted: false },
    },
    {
      name: "the person's rotation wins over an automatic one due at the same time",
      facts: { startFresh: true, transcriptMissing: true, rotationsThisAttempt: 2 },
      rotation: { kind: "rotate", reason: "start-fresh", counted: false },
    },
    {
      name: "a due rotation wins over a pending one",
      facts: { compactions: 5, lastTerminalReason: "prompt_too_long" },
      rotation: { kind: "rotate", reason: "context-overflow", counted: true },
    },
  ])("$name", ({ facts, rotation }) => {
    expect(rotationDecision({ ...steady, ...facts })).toEqual(rotation);
  });
});
