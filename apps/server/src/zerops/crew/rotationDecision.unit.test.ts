import { expect, it } from "vite-plus/test";

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

// witness: apps/server/src/zerops/crew/rotationDecision.ts | facts.rotateAfter > 0 && facts.compactions >= facts.rotateAfter → facts.compactions >= facts.rotateAfter
it("CM19: A crewmate's conversation that has compacted as often as its rotate-after setting rotates at its next task, never in the middle of one, and never when the setting is 0", () => {
  expect(rotationDecision({ ...steady, compactions: 3 })).toEqual({
    kind: "pending",
    reason: "compactions",
  });
  expect(rotationDecision({ ...steady, compactions: 4, moment: "task-start" })).toEqual({
    kind: "rotate",
    reason: "compactions",
    counted: true,
  });
  expect(
    rotationDecision({ ...steady, compactions: 20, rotateAfter: 0, moment: "task-start" }),
  ).toEqual({ kind: "keep" });
});

// witness: apps/server/src/zerops/crew/rotationDecision.ts | "login-changed", "now", false → "login-changed", "next-turn", false
it("CM20: A crewmate whose login changed gets a new conversation at once, not counted against the task", () => {
  expect(rotationDecision({ ...steady, moment: "idle", login: "claudeAgent-work" })).toEqual({
    kind: "rotate",
    reason: "login-changed",
    counted: false,
  });
});

// witness: apps/server/src/zerops/crew/rotationDecision.ts | add(facts.freshTask, → add(facts.freshTask && facts.startFresh,
it("CM21: A task marked unrelated starts in a new conversation", () => {
  expect(rotationDecision({ ...steady, freshTask: true, moment: "task-start" })).toEqual({
    kind: "rotate",
    reason: "fresh-task",
    counted: true,
  });
});

// witness: apps/server/src/zerops/crew/rotationDecision.ts | due.counted && facts.rotationsThisAttempt >= CREW_ROTATIONS_PER_ATTEMPT → due.counted && facts.rotationsThisAttempt > CREW_ROTATIONS_PER_ATTEMPT
it("CM22: A third counted rotation in one attempt parks the task instead of rotating; the second still rotates", () => {
  expect(
    rotationDecision({ ...steady, lastTerminalReason: "prompt_too_long", rotationsThisAttempt: 2 }),
  ).toEqual({ kind: "park", reason: "context-overflow" });
  expect(
    rotationDecision({ ...steady, lastTerminalReason: "prompt_too_long", rotationsThisAttempt: 1 }),
  ).toEqual({ kind: "rotate", reason: "context-overflow", counted: true });
});
