import type {
  CrewClaimState,
  CrewRunState,
  CrewStintState,
  CrewTaskState,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  CLAIM_EVENTS,
  claimTransition,
  runTransition,
  stintTransition,
  TASK_START,
  initialTaskState,
  taskTransition,
  type ClaimEvent,
  type TaskCounters,
  type TaskEvent,
  type RunEvent,
  type StintEvent,
} from "./crewMachines.ts";

const CLAIM_STATES: ReadonlyArray<CrewClaimState> = [
  "none",
  "requested",
  "starting",
  "held",
  "releasing",
  "release-failed",
];

/** ARCHITECTURE §4 *Show-on-dev claim*, one vector per row cell. */
const CLAIM_ROWS: ReadonlyArray<readonly [CrewClaimState, ClaimEvent, CrewClaimState]> = [
  ["none", "request", "requested"],
  ["requested", "grant", "starting"],
  ["requested", "deny", "none"],
  ["requested", "timeout", "none"],
  ["starting", "serves-lane", "held"],
  ["starting", "turn-failed", "releasing"],
  ["starting", "serves-other", "releasing"],
  ["held", "report", "releasing"],
  ["held", "press", "releasing"],
  ["held", "timeout", "releasing"],
  ["held", "person-dev-server", "none"],
  ["held", "self-deploy", "none"],
  ["releasing", "serves-tree", "none"],
  ["releasing", "turn-failed", "release-failed"],
  ["release-failed", "serves-tree", "none"],
];

describe("claimTransition", () => {
  it.each(CLAIM_ROWS)("%s + %s → %s", (from, event, to) => {
    expect(claimTransition(from, event)).toEqual({ kind: "moved", to });
  });

  it("rejects every other state and event", () => {
    const legal = new Set(CLAIM_ROWS.map(([from, event]) => `${from}+${event}`));
    for (const from of CLAIM_STATES) {
      for (const event of CLAIM_EVENTS) {
        if (legal.has(`${from}+${event}`)) continue;
        expect(claimTransition(from, event), `${from}+${event}`).toEqual({
          kind: "illegal",
          from,
          event,
        });
      }
    }
  });
});

describe("runTransition", () => {
  const RUN_STATES: ReadonlyArray<CrewRunState | "none"> = [
    "none",
    "running",
    "paused",
    "finishing",
    "finished",
    "stopped",
  ];
  const start: RunEvent = { type: "start", admitted: true, lanesReady: true };
  const resume: RunEvent = { type: "resume", admitted: true };

  /** ARCHITECTURE §4 *Run*. */
  const RUN_ROWS: ReadonlyArray<readonly [CrewRunState | "none", RunEvent, unknown]> = [
    ["none", start, { kind: "moved", to: "running" }],
    ["none", { ...start, admitted: false }, { kind: "held", reason: "admission" }],
    ["none", { ...start, lanesReady: false }, { kind: "held", reason: "lanes" }],
    ...(["person", "admission", "budget", "usage", "time-limit"] as const).map(
      (reason) =>
        ["running", { type: "pause", reason }, { kind: "moved", to: "paused", reason }] as const,
    ),
    ["paused", resume, { kind: "moved", to: "running" }],
    ["paused", { type: "resume", admitted: false }, { kind: "held", reason: "admission" }],
    ["running", { type: "finish" }, { kind: "moved", to: "finishing" }],
    ["finishing", { type: "cleaned" }, { kind: "moved", to: "finished" }],
    ["running", { type: "stop" }, { kind: "moved", to: "stopped" }],
    ["paused", { type: "stop" }, { kind: "moved", to: "stopped" }],
  ];

  it.each(RUN_ROWS)("%s + %o", (from, event, result) => {
    expect(runTransition(from, event)).toEqual(result);
  });

  it("rejects every other state and event", () => {
    const events: ReadonlyArray<RunEvent> = [
      start,
      { type: "pause", reason: "person" },
      resume,
      { type: "finish" },
      { type: "cleaned" },
      { type: "stop" },
    ];
    const legal = new Set(RUN_ROWS.map(([from, event]) => `${from}+${event.type}`));
    for (const from of RUN_STATES) {
      for (const event of events) {
        if (legal.has(`${from}+${event.type}`)) continue;
        expect(runTransition(from, event), `${from}+${event.type}`).toEqual({
          kind: "illegal",
          from,
          event: event.type,
        });
      }
    }
  });
});

describe("stintTransition", () => {
  const STINT_STATES: ReadonlyArray<CrewStintState | "none"> = [
    "none",
    "open",
    "active",
    "rotate-pending",
    "retired",
  ];

  /**
   * ARCHITECTURE §4 *Stint*. `retire` carries every "retired now" and
   * "retired before the next turn" trigger, and `rotate-pending` every "at the
   * next boundary" one; which trigger is due when is `rotationDecision`'s.
   */
  const STINT_ROWS: ReadonlyArray<readonly [CrewStintState | "none", StintEvent, unknown]> = [
    ["none", { type: "open" }, { kind: "moved", to: "open" }],
    ["open", { type: "turn-start" }, { kind: "moved", to: "active" }],
    ["active", { type: "turn-start" }, { kind: "moved", to: "active" }],
    ["rotate-pending", { type: "turn-start" }, { kind: "moved", to: "rotate-pending" }],
    [
      "active",
      { type: "rotate-pending", reason: "compactions" },
      { kind: "moved", to: "rotate-pending", reason: "compactions" },
    ],
    [
      "rotate-pending",
      { type: "rotate-pending", reason: "principal-changed" },
      { kind: "moved", to: "rotate-pending", reason: "principal-changed" },
    ],
    [
      "active",
      { type: "retire", reason: "transcript-missing" },
      { kind: "moved", to: "retired", reason: "transcript-missing" },
    ],
    [
      "open",
      { type: "retire", reason: "start-fresh" },
      { kind: "moved", to: "retired", reason: "start-fresh" },
    ],
    [
      "rotate-pending",
      { type: "retire", reason: "compactions" },
      { kind: "moved", to: "retired", reason: "compactions" },
    ],
  ];

  it.each(STINT_ROWS)("%s + %o", (from, event, result) => {
    expect(stintTransition(from, event)).toEqual(result);
  });

  it("rejects every other state and event", () => {
    const events: ReadonlyArray<StintEvent> = [
      { type: "open" },
      { type: "turn-start" },
      { type: "rotate-pending", reason: "compactions" },
      { type: "retire", reason: "start-fresh" },
    ];
    const legal = new Set(STINT_ROWS.map(([from, event]) => `${from}+${event.type}`));
    for (const from of STINT_STATES) {
      for (const event of events) {
        if (legal.has(`${from}+${event.type}`)) continue;
        expect(stintTransition(from, event), `${from}+${event.type}`).toEqual({
          kind: "illegal",
          from,
          event: event.type,
        });
      }
    }
  });
});

describe("initialTaskState", () => {
  it.each([
    { source: "you", leadMayStart: false, state: "queued" },
    { source: "message", leadMayStart: false, state: "queued" },
    { source: "lead", leadMayStart: false, state: "proposed" },
    { source: "lead", leadMayStart: true, state: "queued" },
  ] as const)("a task from $source (lead may start: $leadMayStart) starts $state", (input) => {
    expect(initialTaskState(input)).toBe(input.state);
  });
});

describe("taskTransition", () => {
  const TASK_STATES: ReadonlyArray<CrewTaskState> = [
    "proposed",
    "queued",
    "working",
    "rework",
    "blocked",
    "merging",
    "checking",
    "review",
    "ready",
    "landing",
    "waiting-on-you",
    "landed",
    "parked",
    "discarded",
  ];
  const go = { dependenciesLanded: true, laneIdle: true, hostFrozen: false, admitted: true };
  const clear = { personTurnRunning: false, hostFrozen: false, laneShown: false, lockTaken: true };
  const c = (overrides: Partial<TaskCounters> = {}): TaskCounters => ({
    ...TASK_START,
    ...overrides,
  });
  const moved = (to: CrewTaskState, counters: TaskCounters = c(), parked?: string) => ({
    kind: "moved",
    to,
    counters,
    ...(parked ? { parked } : {}),
  });

  /** ARCHITECTURE §4 *Assignment, including landing*, plus the PRD's rows. */
  const TASK_ROWS: ReadonlyArray<
    readonly [string, CrewTaskState, TaskCounters, TaskEvent, unknown]
  > = [
    ["Start accepts a proposed task", "proposed", c(), { type: "accept" }, moved("queued")],
    ["dispatch sends the card", "queued", c(), { type: "dispatch", facts: go }, moved("working")],
    [
      "dispatch waits on dependencies",
      "queued",
      c(),
      { type: "dispatch", facts: { ...go, dependenciesLanded: false } },
      { kind: "held", reason: "dependencies" },
    ],
    [
      "dispatch waits on a busy crewmate",
      "queued",
      c(),
      { type: "dispatch", facts: { ...go, laneIdle: false } },
      { kind: "held", reason: "lane-busy" },
    ],
    [
      "dispatch waits on a frozen host",
      "queued",
      c(),
      { type: "dispatch", facts: { ...go, hostFrozen: true } },
      { kind: "held", reason: "host-frozen" },
    ],
    [
      "dispatch waits on admission",
      "queued",
      c(),
      { type: "dispatch", facts: { ...go, admitted: false } },
      { kind: "held", reason: "admission" },
    ],
    [
      "a turn without a report keeps working",
      "working",
      c(),
      { type: "turn-ended" },
      moved("working"),
    ],
    ["a person's message steers", "working", c(), { type: "message" }, moved("working")],
    ["a question blocks", "working", c(), { type: "report-blocked" }, moved("blocked")],
    ["an answer resumes", "blocked", c(), { type: "message" }, moved("working")],
    ["done merges", "working", c(), { type: "report-done" }, moved("merging")],
    ["Land now merges without a report", "working", c(), { type: "land-now" }, moved("merging")],
    [
      "an infrastructure ending re-queues once",
      "working",
      c({ rotations: 1 }),
      { type: "infrastructure-ending" },
      moved("queued", c({ attempt: 2, requeues: 1 })),
    ],
    [
      "a second infrastructure ending parks",
      "working",
      c({ requeues: 1 }),
      { type: "infrastructure-ending" },
      moved("parked", c({ requeues: 1 }), "infrastructure"),
    ],
    [
      "a rotation ending continues in a new stint",
      "working",
      c({ rotations: 1 }),
      { type: "rotation-ending" },
      moved("working", c({ rotations: 2 })),
    ],
    [
      "a third rotation in an attempt parks",
      "working",
      c({ rotations: 2 }),
      { type: "rotation-ending" },
      moved("parked", c({ rotations: 2 }), "rotations"),
    ],
    ["a clean merge checks", "merging", c(), { type: "merge-clean" }, moved("checking")],
    [
      "a conflict is a counted rework",
      "merging",
      c(),
      { type: "merge-conflict" },
      moved("rework", c({ reworks: 1 })),
    ],
    [
      "an empty merge-base parks for triage",
      "merging",
      c(),
      { type: "merge-empty-base" },
      moved("parked", c(), "empty-merge-base"),
    ],
    [
      "a passed check goes to review",
      "checking",
      c(),
      { type: "check-passed", reviewed: true },
      moved("review"),
    ],
    [
      "without a reviewer a passed check is ready",
      "checking",
      c(),
      { type: "check-passed", reviewed: false },
      moved("ready"),
    ],
    [
      "a failed check is a rework",
      "checking",
      c(),
      { type: "check-failed" },
      moved("rework", c({ reworks: 1 })),
    ],
    [
      "a check killed by a signal runs again, not counted",
      "checking",
      c(),
      { type: "check-killed" },
      moved("checking"),
    ],
    [
      "a message while checking returns to work",
      "checking",
      c(),
      { type: "message" },
      moved("working"),
    ],
    ["an accepted review is ready", "review", c(), { type: "review-accepted" }, moved("ready")],
    [
      "a rejected review is a rework",
      "review",
      c({ reworks: 1 }),
      { type: "review-rejected" },
      moved("rework", c({ reworks: 2 })),
    ],
    ["a message in review returns to work", "review", c(), { type: "message" }, moved("working")],
    [
      "a rework within the cap starts the next attempt",
      "rework",
      c({ reworks: 2, remerges: 2, rotations: 1 }),
      { type: "dispatch", facts: go },
      moved("working", c({ attempt: 2, reworks: 2 })),
    ],
    [
      "a rework past the cap parks",
      "rework",
      c({ reworks: 3 }),
      { type: "dispatch", facts: go },
      moved("parked", c({ reworks: 3 }), "reworks"),
    ],
    [
      "a rework waits on a frozen host",
      "rework",
      c({ reworks: 1 }),
      { type: "dispatch", facts: { ...go, hostFrozen: true } },
      { kind: "held", reason: "host-frozen" },
    ],
    [
      "a message in rework is the rework's dispatch",
      "rework",
      c({ reworks: 1 }),
      { type: "message" },
      moved("working", c({ attempt: 2, reworks: 1 })),
    ],
    ["a clear landing gate lands", "ready", c(), { type: "land", facts: clear }, moved("landing")],
    [
      "landing waits on a person's turn",
      "ready",
      c(),
      { type: "land", facts: { ...clear, personTurnRunning: true } },
      { kind: "held", reason: "person-turn" },
    ],
    [
      "landing waits on a frozen host",
      "ready",
      c(),
      { type: "land", facts: { ...clear, hostFrozen: true } },
      { kind: "held", reason: "host-frozen" },
    ],
    [
      "landing waits while the lane is shown on dev",
      "ready",
      c(),
      { type: "land", facts: { ...clear, laneShown: true } },
      { kind: "held", reason: "lane-shown" },
    ],
    [
      "landing waits on the host's landing lock",
      "ready",
      c(),
      { type: "land", facts: { ...clear, lockTaken: false } },
      { kind: "held", reason: "lock" },
    ],
    ["a message while ready returns to work", "ready", c(), { type: "message" }, moved("working")],
    [
      "a trailer already in H is landed",
      "landing",
      c(),
      { type: "trailer-found" },
      moved("landed"),
    ],
    ["a fast-forward lands", "landing", c(), { type: "fast-forward" }, moved("landed")],
    [
      "H moved re-merges",
      "landing",
      c({ remerges: 2 }),
      { type: "head-moved" },
      moved("merging", c({ remerges: 3 })),
    ],
    [
      "H moved past three re-merges is a rework",
      "landing",
      c({ remerges: 3 }),
      { type: "head-moved" },
      moved("rework", c({ remerges: 3, reworks: 1 })),
    ],
    [
      "not a fast-forward redoes at once, not counted",
      "landing",
      c(),
      { type: "not-fast-forward" },
      moved("merging"),
    ],
    [
      "a dirty tracked path waits on you",
      "landing",
      c(),
      { type: "dirty-tree" },
      moved("waiting-on-you"),
    ],
    [
      "an untracked file in the way waits on you",
      "landing",
      c(),
      { type: "untracked-in-way" },
      moved("waiting-on-you"),
    ],
    ["index.lock backs off to ready", "landing", c(), { type: "index-lock" }, moved("ready")],
    [
      "a missing object retries from ready",
      "landing",
      c(),
      { type: "missing-object" },
      moved("ready"),
    ],
    ["ENOSPC parks", "landing", c(), { type: "disk-full" }, moved("parked", c(), "disk-full")],
    [
      "a clean tree re-merges, not counted",
      "waiting-on-you",
      c({ remerges: 1 }),
      { type: "tree-clean" },
      moved("merging", c({ remerges: 1 })),
    ],
    [
      "a standing run's 30-minute wait is ready for the person",
      "waiting-on-you",
      c(),
      { type: "wait-expired" },
      moved("ready"),
    ],
    [
      "a message while waiting on you returns to work",
      "waiting-on-you",
      c(),
      { type: "message" },
      moved("working"),
    ],
    ["the after-land turn keeps it landed", "landed", c(), { type: "after-land" }, moved("landed")],
    ...(
      [
        "proposed",
        "queued",
        "working",
        "rework",
        "blocked",
        "merging",
        "checking",
        "review",
        "ready",
        "landing",
        "waiting-on-you",
        "parked",
      ] as const
    ).map(
      (from) => [`${from} discards`, from, c(), { type: "discard" }, moved("discarded")] as const,
    ),
    ...(
      [
        "queued",
        "working",
        "rework",
        "blocked",
        "merging",
        "checking",
        "review",
        "ready",
        "landing",
        "waiting-on-you",
      ] as const
    ).map(
      (from) =>
        [
          `${from} parks for triage`,
          from,
          c(),
          { type: "park", reason: "needs-triage" },
          moved("parked", c(), "needs-triage"),
        ] as const,
    ),
  ];

  it.each(TASK_ROWS)("%s", (_name, from, counters, event, result) => {
    expect(taskTransition({ state: from, counters }, event)).toEqual(result);
  });

  it("rejects every other state and event", () => {
    const events: ReadonlyArray<TaskEvent> = [
      { type: "accept" },
      { type: "dispatch", facts: go },
      { type: "message" },
      { type: "turn-ended" },
      { type: "report-blocked" },
      { type: "report-done" },
      { type: "land-now" },
      { type: "infrastructure-ending" },
      { type: "rotation-ending" },
      { type: "merge-clean" },
      { type: "merge-conflict" },
      { type: "merge-empty-base" },
      { type: "check-passed", reviewed: true },
      { type: "check-failed" },
      { type: "check-killed" },
      { type: "review-accepted" },
      { type: "review-rejected" },
      { type: "land", facts: clear },
      { type: "trailer-found" },
      { type: "fast-forward" },
      { type: "head-moved" },
      { type: "not-fast-forward" },
      { type: "dirty-tree" },
      { type: "untracked-in-way" },
      { type: "index-lock" },
      { type: "missing-object" },
      { type: "disk-full" },
      { type: "tree-clean" },
      { type: "wait-expired" },
      { type: "after-land" },
      { type: "park", reason: "needs-triage" },
      { type: "discard" },
    ];
    const legal = new Set(TASK_ROWS.map(([, from, , event]) => `${from}+${event.type}`));
    for (const from of TASK_STATES) {
      for (const event of events) {
        if (legal.has(`${from}+${event.type}`)) continue;
        expect(
          taskTransition({ state: from, counters: c() }, event),
          `${from}+${event.type}`,
        ).toEqual({
          kind: "illegal",
          from,
          event: event.type,
        });
      }
    }
  });
});
