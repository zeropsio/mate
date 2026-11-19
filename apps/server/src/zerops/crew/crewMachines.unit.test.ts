import type { CrewTaskState } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  attemptEndingOf,
  claimTransition,
  initialTaskState,
  runTransition,
  taskTransition,
  type TaskCounters,
} from "./crewMachines.ts";

const c = (overrides: Partial<TaskCounters> = {}): TaskCounters => ({
  attempt: 1,
  reworks: 0,
  remerges: 0,
  requeues: 0,
  rotations: 0,
  ...overrides,
});
const moved = (to: CrewTaskState, counters = c(), parked?: string) => ({
  kind: "moved",
  to,
  counters,
  ...(parked ? { parked } : {}),
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | input.source === "lead" && !input.leadMayStart → input.source === "lead" && input.leadMayStart
it("CM1: A task the lead plans waits as a proposal for the person's Start unless the run lets the lead start tasks; a task from the person or from a message is queued at once, and Start queues a proposal", () => {
  expect(initialTaskState({ source: "you", leadMayStart: false })).toBe("queued");
  expect(initialTaskState({ source: "message", leadMayStart: false })).toBe("queued");
  expect(initialTaskState({ source: "lead", leadMayStart: false })).toBe("proposed");
  expect(initialTaskState({ source: "lead", leadMayStart: true })).toBe("queued");
  expect(taskTransition({ state: "proposed", counters: c() }, { type: "accept" })).toEqual(
    moved("queued"),
  );
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | counters.requeues >= CREW_REQUEUES_MAX → counters.requeues > CREW_REQUEUES_MAX
it("CM2: A crewmate's turn that fails for infrastructure queues its task again once, as its next attempt; a second such ending parks the task", () => {
  expect(
    taskTransition(
      { state: "working", counters: c({ rotations: 1 }) },
      { type: "infrastructure-ending" },
    ),
  ).toEqual(moved("queued", c({ attempt: 2, requeues: 1 })));
  expect(
    taskTransition(
      { state: "working", counters: c({ requeues: 1 }) },
      { type: "infrastructure-ending" },
    ),
  ).toEqual(moved("parked", c({ requeues: 1 }), "infrastructure"));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | counters.rotations >= CREW_ROTATIONS_PER_ATTEMPT → counters.rotations > CREW_ROTATIONS_PER_ATTEMPT
it("CM3: A conversation that outgrows its context carries its task on twice in one attempt; a third time parks the task", () => {
  expect(
    taskTransition(
      { state: "working", counters: c({ rotations: 1 }) },
      { type: "rotation-ending" },
    ),
  ).toEqual(moved("working", c({ rotations: 2 })));
  expect(
    taskTransition(
      { state: "working", counters: c({ rotations: 2 }) },
      { type: "rotation-ending" },
    ),
  ).toEqual(moved("parked", c({ rotations: 2 }), "rotations"));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | from === "review" ? rework() : illegal → from === "review" ? to("rework") : illegal
it("CM4: A merge conflict, a failed check and a rejected review each send a task back as one counted rework", () => {
  expect(taskTransition({ state: "merging", counters: c() }, { type: "merge-conflict" })).toEqual(
    moved("rework", c({ reworks: 1 })),
  );
  expect(taskTransition({ state: "checking", counters: c() }, { type: "check-failed" })).toEqual(
    moved("rework", c({ reworks: 1 })),
  );
  expect(
    taskTransition({ state: "review", counters: c({ reworks: 1 }) }, { type: "review-rejected" }),
  ).toEqual(moved("rework", c({ reworks: 2 })));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | counters.reworks > CREW_REWORKS_MAX → counters.reworks >= CREW_REWORKS_MAX
it("CM5: A rework within the cap starts the task's next attempt, by its dispatch or by a person's message, with its re-merge and rotation counts cleared; a rework past the cap parks the task", () => {
  const go = { dependenciesLanded: true, laneIdle: true, hostFrozen: false, admitted: true };
  expect(
    taskTransition(
      { state: "rework", counters: c({ reworks: 2, remerges: 2, rotations: 1 }) },
      { type: "dispatch", facts: go },
    ),
  ).toEqual(moved("working", c({ attempt: 2, reworks: 2 })));
  expect(
    taskTransition(
      { state: "rework", counters: c({ reworks: 3 }) },
      { type: "dispatch", facts: go },
    ),
  ).toEqual(moved("parked", c({ reworks: 3 }), "reworks"));
  expect(
    taskTransition({ state: "rework", counters: c({ reworks: 1 }) }, { type: "message" }),
  ).toEqual(moved("working", c({ attempt: 2, reworks: 1 })));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | "blocked", → "queued",
it("CM6: A person's message returns a task that is blocked, checking, in review, ready or waiting on the person's tree to work", () => {
  expect(taskTransition({ state: "blocked", counters: c() }, { type: "message" })).toEqual(
    moved("working"),
  );
  expect(taskTransition({ state: "checking", counters: c() }, { type: "message" })).toEqual(
    moved("working"),
  );
  expect(taskTransition({ state: "review", counters: c() }, { type: "message" })).toEqual(
    moved("working"),
  );
  expect(taskTransition({ state: "ready", counters: c() }, { type: "message" })).toEqual(
    moved("working"),
  );
  expect(taskTransition({ state: "waiting-on-you", counters: c() }, { type: "message" })).toEqual(
    moved("working"),
  );
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | from === "working" || from === "rework" → from === "working"
it("CM7: Land pressed before the crewmate reported, or on a task back for rework, sends its copy to merge as it stands", () => {
  expect(taskTransition({ state: "working", counters: c() }, { type: "land-now" })).toEqual(
    moved("merging"),
  );
  expect(
    taskTransition({ state: "rework", counters: c({ reworks: 1 }) }, { type: "land-now" }),
  ).toEqual(moved("merging", c({ reworks: 1 })));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | event.reviewed ? "review" : "ready" → event.reviewed ? "ready" : "review"
it("CM8: A passed check waits for review where the crew has a reviewer and is ready to land where it has none", () => {
  expect(
    taskTransition({ state: "checking", counters: c() }, { type: "check-passed", reviewed: true }),
  ).toEqual(moved("review"));
  expect(
    taskTransition({ state: "checking", counters: c() }, { type: "check-passed", reviewed: false }),
  ).toEqual(moved("ready"));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | counters.remerges >= CREW_REMERGES_MAX → counters.remerges > CREW_REMERGES_MAX
it("CM9: A landing that finds the person's tree moved merges again, three times at most; after the third it is a counted rework", () => {
  expect(
    taskTransition({ state: "landing", counters: c({ remerges: 2 }) }, { type: "head-moved" }),
  ).toEqual(moved("merging", c({ remerges: 3 })));
  expect(
    taskTransition({ state: "landing", counters: c({ remerges: 3 }) }, { type: "head-moved" }),
  ).toEqual(moved("rework", c({ remerges: 3, reworks: 1 })));
  expect(
    taskTransition(
      { state: "landing", counters: c({ remerges: 1 }) },
      { type: "not-fast-forward" },
    ),
  ).toEqual(moved("merging", c({ remerges: 2 })));
  expect(
    taskTransition(
      { state: "landing", counters: c({ remerges: 3 }) },
      { type: "not-fast-forward" },
    ),
  ).toEqual(moved("rework", c({ remerges: 3, reworks: 1 })));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | from === "waiting-on-you" ? to("merging") → from === "waiting-on-you" ? to("ready")
it("CM10: A landing stopped by the person's uncommitted or untracked files waits on the person, and a clean tree merges it again without counting a re-merge", () => {
  expect(taskTransition({ state: "landing", counters: c() }, { type: "dirty-tree" })).toEqual(
    moved("waiting-on-you"),
  );
  expect(taskTransition({ state: "landing", counters: c() }, { type: "untracked-in-way" })).toEqual(
    moved("waiting-on-you"),
  );
  expect(
    taskTransition(
      { state: "waiting-on-you", counters: c({ remerges: 1 }) },
      { type: "tree-clean" },
    ),
  ).toEqual(moved("merging", c({ remerges: 1 })));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | event.retried ? park("missing-object") : to("ready") → event.retried ? to("ready") : park("missing-object")
it("CM11: A landing stopped by Git's index lock goes back to ready; one that misses an object lands again once and parks the second time; a full disk parks it", () => {
  expect(taskTransition({ state: "landing", counters: c() }, { type: "index-lock" })).toEqual(
    moved("ready"),
  );
  expect(
    taskTransition({ state: "landing", counters: c() }, { type: "missing-object", retried: false }),
  ).toEqual(moved("ready"));
  expect(
    taskTransition({ state: "landing", counters: c() }, { type: "missing-object", retried: true }),
  ).toEqual(moved("parked", c(), "missing-object"));
  expect(taskTransition({ state: "landing", counters: c() }, { type: "disk-full" })).toEqual(
    moved("parked", c(), "disk-full"),
  );
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | return from === "parked" → return from === "blocked"
it("CM12: Try again queues a stopped task as its next attempt with its rework, re-merge, re-queue and rotation counts cleared", () => {
  expect(
    taskTransition(
      {
        state: "parked",
        counters: c({ attempt: 2, reworks: 3, remerges: 2, requeues: 1, rotations: 2 }),
      },
      { type: "retry" },
    ),
  ).toEqual(moved("queued", c({ attempt: 3, reworks: 0, remerges: 0, requeues: 0, rotations: 0 })));
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | new Set(["landed", "discarded"]) → new Set(["landed"])
it("CM13: A landed or a discarded task is never sent back to work, parked or discarded", () => {
  expect(taskTransition({ state: "landed", counters: c() }, { type: "message" })).toEqual({
    kind: "illegal",
    from: "landed",
    event: "message",
  });
  expect(
    taskTransition({ state: "landed", counters: c() }, { type: "park", reason: "needs-triage" }),
  ).toEqual({ kind: "illegal", from: "landed", event: "park" });
  expect(taskTransition({ state: "landed", counters: c() }, { type: "discard" })).toEqual({
    kind: "illegal",
    from: "landed",
    event: "discard",
  });
  expect(taskTransition({ state: "discarded", counters: c() }, { type: "message" })).toEqual({
    kind: "illegal",
    from: "discarded",
    event: "message",
  });
  expect(
    taskTransition({ state: "discarded", counters: c() }, { type: "park", reason: "needs-triage" }),
  ).toEqual({ kind: "illegal", from: "discarded", event: "park" });
  expect(taskTransition({ state: "discarded", counters: c() }, { type: "discard" })).toEqual({
    kind: "illegal",
    from: "discarded",
    event: "discard",
  });
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | !event.lanesReady → event.lanesReady
it("CM14: A crew has one run at a time: a start is refused while a run is running or paused, and waits while the crewmates' copies are still being made", () => {
  const start = { type: "start", admitted: true, lanesReady: true } as const;
  expect(runTransition("none", { ...start, lanesReady: false })).toEqual({
    kind: "held",
    reason: "lanes",
  });
  expect(runTransition("running", start)).toEqual({
    kind: "illegal",
    from: "running",
    event: "start",
  });
  expect(runTransition("paused", start)).toEqual({
    kind: "illegal",
    from: "paused",
    event: "start",
  });
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | from === "running" || from === "paused" ? { kind: "moved", to: "stopped" } → from === "running" ? { kind: "moved", to: "stopped" }
it("CM15: Stop ends a run that is running or paused; a run pauses only while running and keeps the pause's reason, and resumes only from a pause", () => {
  expect(runTransition("running", { type: "pause", reason: "person" })).toEqual({
    kind: "moved",
    to: "paused",
    reason: "person",
  });
  expect(runTransition("running", { type: "pause", reason: "admission" })).toEqual({
    kind: "moved",
    to: "paused",
    reason: "admission",
  });
  expect(runTransition("running", { type: "pause", reason: "budget" })).toEqual({
    kind: "moved",
    to: "paused",
    reason: "budget",
  });
  expect(runTransition("running", { type: "pause", reason: "usage" })).toEqual({
    kind: "moved",
    to: "paused",
    reason: "usage",
  });
  expect(runTransition("running", { type: "pause", reason: "time-limit" })).toEqual({
    kind: "moved",
    to: "paused",
    reason: "time-limit",
  });
  expect(runTransition("paused", { type: "resume", admitted: true })).toEqual({
    kind: "moved",
    to: "running",
  });
  expect(runTransition("running", { type: "stop" })).toEqual({ kind: "moved", to: "stopped" });
  expect(runTransition("paused", { type: "stop" })).toEqual({ kind: "moved", to: "stopped" });
  expect(runTransition("paused", { type: "pause", reason: "person" })).toEqual({
    kind: "illegal",
    from: "paused",
    event: "pause",
  });
  expect(runTransition("running", { type: "resume", admitted: true })).toEqual({
    kind: "illegal",
    from: "running",
    event: "resume",
  });
  expect(runTransition("none", { type: "stop" })).toEqual({
    kind: "illegal",
    from: "none",
    event: "stop",
  });
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | "serves-other": "releasing" → "serves-other": "held"
it("CM16: A Show-on-dev claim is held only once the dev server is read serving the crewmate's copy; a failed turn or another tree served releases it instead", () => {
  expect(claimTransition("starting", "serves-lane")).toEqual({ kind: "moved", to: "held" });
  expect(claimTransition("starting", "turn-failed")).toEqual({ kind: "moved", to: "releasing" });
  expect(claimTransition("starting", "serves-other")).toEqual({ kind: "moved", to: "releasing" });
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | "turn-failed": "release-failed" → "turn-failed": "none"
it("CM17: A held claim is released by the crewmate's report, the person's press or its timeout, and ends only when the dev server is read serving the person's tree again; a release whose turn failed stays failed until then", () => {
  expect(claimTransition("held", "report")).toEqual({ kind: "moved", to: "releasing" });
  expect(claimTransition("held", "press")).toEqual({ kind: "moved", to: "releasing" });
  expect(claimTransition("held", "timeout")).toEqual({ kind: "moved", to: "releasing" });
  expect(claimTransition("releasing", "serves-tree")).toEqual({ kind: "moved", to: "none" });
  expect(claimTransition("releasing", "turn-failed")).toEqual({
    kind: "moved",
    to: "release-failed",
  });
  expect(claimTransition("release-failed", "serves-tree")).toEqual({ kind: "moved", to: "none" });
  expect(claimTransition("release-failed", "turn-failed")).toEqual({
    kind: "illegal",
    from: "release-failed",
    event: "turn-failed",
  });
  expect(claimTransition("releasing", "report")).toEqual({
    kind: "illegal",
    from: "releasing",
    event: "report",
  });
});

// witness: apps/server/src/zerops/crew/crewMachines.ts | input.run?.state === "paused" → input.run?.state === "running"
it("CM18: A turn the run's spending limit ended ends its task's attempt as out of budget; a turn interrupted under a paused run as paused with the run, under a stopped run as stopped with it, otherwise as interrupted; a failed turn as failed, and a completed one as ended without a report", () => {
  const limits = { budgetUsd: 20, timeLimitHours: 8, stopAtUsagePercent: 80 };
  expect(
    attemptEndingOf({
      state: "completed",
      terminalReason: undefined,
      errorMessage: undefined,
      run: undefined,
    }).ending,
  ).toBe("no-report");
  expect(
    attemptEndingOf({
      state: "completed",
      terminalReason: "budget_exhausted",
      errorMessage: undefined,
      run: { state: "paused", reason: "budget", limits },
    }).ending,
  ).toBe("budget");
  expect(
    attemptEndingOf({
      state: "interrupted",
      terminalReason: undefined,
      errorMessage: undefined,
      run: { state: "paused", reason: "person", limits },
    }).ending,
  ).toBe("run-paused");
  expect(
    attemptEndingOf({
      state: "cancelled",
      terminalReason: undefined,
      errorMessage: undefined,
      run: { state: "stopped", reason: null, limits },
    }).ending,
  ).toBe("run-stopped");
  expect(
    attemptEndingOf({
      state: "interrupted",
      terminalReason: undefined,
      errorMessage: undefined,
      run: { state: "running", reason: null, limits },
    }).ending,
  ).toBe("interrupted");
  expect(
    attemptEndingOf({
      state: "interrupted",
      terminalReason: undefined,
      errorMessage: undefined,
      run: undefined,
    }).ending,
  ).toBe("interrupted");
  expect(
    attemptEndingOf({
      state: "failed",
      terminalReason: undefined,
      errorMessage: "Overloaded",
      run: undefined,
    }).ending,
  ).toBe("failed");
});
