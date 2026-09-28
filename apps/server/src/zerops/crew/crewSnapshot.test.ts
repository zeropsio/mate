import { CrewSnapshot, ThreadId } from "@t3tools/contracts";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import type { CrewAssignmentRow, CrewLaneRow, CrewMemberRow } from "./CrewStore.ts";
import {
  appliedSnapshot,
  CREW_OFF_SNAPSHOT,
  UNATTENDED_MS,
  crewNoneSnapshot,
  EMPTY_RUNTIME,
  type AppliedSnapshotInput,
  type LaneProgress,
  type SnapshotRuntime,
  type SnapshotStint,
} from "./crewSnapshot.ts";

const AT = "2026-09-27T10:00:00.000Z";

const common = (handle: string) => ({
  handle,
  displayName: handle[0]!.toUpperCase() + handle.slice(1),
  restartAfterMerge: false,
  afterLandRestart: false,
  env: {},
  migrations: [],
  job: `\n${handle} owns its part.\nMore detail.`,
});

const writer = (handle: string): CrewMemberSpec => ({
  ...common(handle),
  kind: "writer",
  readOnly: false,
  host: "appdev",
});

const readOnly = (handle: string, kind: "reader" | "lead"): CrewMemberSpec => ({
  ...common(handle),
  kind,
  readOnly: true,
});

const definition: CrewDefinition = {
  crew: "main",
  name: "Game team",
  brief: { title: "Space shooter", text: "First line.\nSecond line.\nThird.", doneWhen: [] },
  members: [writer("backend"), readOnly("reviewer", "reader"), readOnly("lead", "lead")],
};

const memberRow = (member: CrewMemberSpec, fields: Partial<CrewMemberRow> = {}): CrewMemberRow => ({
  crew: "main",
  handle: member.handle,
  displayName: member.displayName,
  kind: member.kind,
  tint: "sky",
  host: member.host ?? null,
  lane: member.kind === "writer" ? member.handle : null,
  readOnly: member.kind !== "writer",
  login: "claudeAgent",
  model: null,
  effort: null,
  jobVersion: 2,
  runCommand: null,
  restartAfterMerge: false,
  crewPort: null,
  config: {},
  ...fields,
});

const lane: CrewLaneRow = {
  crew: "main",
  lane: "backend",
  host: "appdev",
  branch: "crew/backend",
  dispatchCommit: "a".repeat(40),
  recordedTip: "a".repeat(40),
  lastLanding: null,
  refSnapshot: null,
  lockfileHash: null,
  frozenSince: null,
  state: "ready",
};

const task = (
  assignment: string,
  number: number,
  fields: Partial<CrewAssignmentRow> = {},
): CrewAssignmentRow => ({
  assignment,
  run: null,
  crew: "main",
  member: "backend",
  number,
  title: `Task ${number}`,
  source: "you",
  createdBy: "user-1",
  card: { brief: `Brief ${number}`, doneWhen: "", note: null },
  pending: null,
  dependsOn: [],
  fresh: false,
  state: "queued",
  attempt: 0,
  reworks: 0,
  remerges: 0,
  mergedHead: null,
  check: null,
  review: null,
  report: null,
  waiting: null,
  landedCommit: null,
  createdAt: AT,
  updatedAt: AT,
  ...fields,
});

const stint = (
  member: string,
  number: number,
  fields: Partial<SnapshotStint> = {},
): SnapshotStint => ({
  member,
  stint: number,
  threadId: `thread-${member}-${number}`,
  sessionId: "session",
  compactions: 0,
  lastCompactSummary: null,
  rotatePending: false,
  reason: null,
  briefVersion: 3,
  jobVersion: 2,
  startedAt: AT,
  retiredAt: null,
  ...fields,
});

const base = (fields: Partial<AppliedSnapshotInput> = {}): AppliedSnapshotInput => ({
  seq: 7,
  run: null,
  leadAnswers: false,
  nowMs: Date.parse("2026-09-27T10:00:00.000Z"),
  definition,
  briefVersion: 3,
  members: definition.members.map((member) => memberRow(member)),
  lanes: [lane],
  stints: [],
  tasks: [],
  hosts: [{ host: "appdev", crewPorts: [{ port: 3001, routed: false }] }],
  claims: [],
  memory: new Map(),
  midway: new Map(),
  reviewing: new Set(),
  runtime: EMPTY_RUNTIME,
  ...fields,
});

const decode = Schema.decodeUnknownSync(CrewSnapshot);

describe("crew snapshot", () => {
  it("off and none carry no crew and empty lists; none offers the dev services by name", () => {
    expect(decode(CREW_OFF_SNAPSHOT)).toEqual(CREW_OFF_SNAPSHOT);
    expect(
      crewNoneSnapshot(12, {
        devHosts: new Map([
          ["webdev", null],
          ["appdev", true],
        ]),
        lastError: "boom",
      }),
    ).toEqual({
      ...CREW_OFF_SNAPSHOT,
      status: "none",
      seq: 12,
      devHosts: [
        { host: "appdev", database: true },
        { host: "webdev", database: null },
      ],
      lastError: "boom",
    });
  });

  it("an applied crew: the lead first, then the home's order; wire rules hold", () => {
    const snapshot = appliedSnapshot(
      base({
        members: definition.members.map((member) =>
          memberRow(
            member,
            member.handle === "backend" ? { crewPort: 3001, runCommand: "npm run dev" } : {},
          ),
        ),
        stints: [
          stint("backend", 1, { retiredAt: AT, reason: "start-fresh" }),
          stint("backend", 2, { jobVersion: 1, sessionId: null }),
        ],
      }),
    );
    expect(() => decode(snapshot)).not.toThrow();
    expect(snapshot.crew).toEqual({
      name: "Game team",
      briefTitle: "Space shooter",
      briefVersion: 3,
      briefExcerpt: "First line.\nSecond line.",
    });
    expect(snapshot.crewmates.map((mate) => mate.handle)).toEqual(["lead", "backend", "reviewer"]);
    const backend = snapshot.crewmates[1]!;
    expect({
      jobFirstLine: backend.jobFirstLine,
      jobVersion: backend.jobVersion,
      promptVersions: backend.promptVersions,
      currentThreadId: backend.currentThreadId,
      stints: backend.stints.map((entry) => [entry.stint, entry.state]),
      lane: backend.lane,
      app: backend.app,
    }).toEqual({
      jobFirstLine: "backend owns its part.",
      jobVersion: 2,
      promptVersions: { running: { brief: 3, job: 1 }, current: { brief: 3, job: 2 } },
      currentThreadId: ThreadId.make("thread-backend-2"),
      stints: [
        [1, "retired"],
        [2, "open"],
      ],
      lane: {
        branch: "crew/backend",
        ahead: 0,
        insertions: 0,
        deletions: 0,
        dirty: false,
        check: null,
        state: "ready",
        detail: null,
      },
      app: { state: "stopped", port: 3001, url: null },
    });
    const reviewer = snapshot.crewmates[2]!;
    expect([reviewer.readOnly, reviewer.lane, reviewer.app, reviewer.host]).toEqual([
      true,
      null,
      null,
      null,
    ]);
  });

  const progress = (state: LaneProgress["state"], detail: string | null) =>
    new Map<string, LaneProgress>([["backend", { state, detail }]]);

  it.each<[string, Partial<SnapshotRuntime>, Partial<CrewLaneRow>, string]>([
    ["Apply is making the copy", { progress: progress("creating", null) }, {}, "creating"],
    ["setup runs", { progress: progress("setting-up", "npm ci") }, {}, "setting-up"],
    ["the service is redeploying", {}, { frozenSince: AT }, "frozen"],
    ["the directory is gone", { missingLanes: new Set(["backend"]) }, {}, "missing"],
    ["a recovery lost it", {}, { state: "lost" }, "failed"],
  ])("a lane reads its state when %s", (_, runtime, laneFields, state) => {
    const snapshot = appliedSnapshot(
      base({ runtime: { ...EMPTY_RUNTIME, ...runtime }, lanes: [{ ...lane, ...laneFields }] }),
    );
    expect(snapshot.crewmates.find((mate) => mate.handle === "backend")!.lane!.state).toBe(state);
  });

  it("the board, the open and queued tasks, and Waiting on you", () => {
    const snapshot = appliedSnapshot(
      base({
        tasks: [
          task("t-1", 1, { state: "landed", landedCommit: "c".repeat(40) }),
          task("t-2", 2, {
            state: "rework",
            attempt: 1,
            waiting: { on: "conflict", reason: "conflicts with what landed", paths: ["a.ts"] },
          }),
          task("t-3", 3, { state: "queued" }),
          task("t-4", 4, {
            member: "reviewer",
            state: "blocked",
            report: { status: "blocked", summary: "?", question: "CZK or EUR?" },
          }),
          task("t-5", 5, { state: "queued", member: "reviewer" }),
        ],
        runtime: {
          ...EMPTY_RUNTIME,
          delivered: new Set<string>(),
          cantStart: new Map([["t-5", { text: "not the login's signer", at: AT }]]),
          laneStats: new Map([
            ["backend", { ahead: 2, insertions: 10, deletions: 1, dirty: true }],
          ]),
        },
      }),
    );
    const backend = snapshot.crewmates.find((mate) => mate.handle === "backend")!;
    expect([
      backend.openTaskId,
      backend.queuedTaskIds,
      backend.lane?.state,
      backend.lane?.dirty,
    ]).toEqual(["t-2", ["t-3"], "conflicts", true]);
    expect(snapshot.board.tasks.find((entry) => entry.id === "t-2")).toMatchObject({
      reason: "conflicts with what landed",
      attempts: 1,
      diffStat: { insertions: 10, deletions: 1 },
    });
    expect(snapshot.landedNotDelivered).toBe(1);
    expect(snapshot.attention.map((row) => [row.id, row.kind, row.text, row.paths])).toEqual([
      ["conflict:t-2", "conflict", null, ["a.ts"]],
      ["question:t-4", "question", "CZK or EUR?", []],
      ["cant-start:t-5", "cant-start", "not the login's signer", []],
    ]);
  });

  it("a task carries its card's note: a fan-out task's word on the rest of the message", () => {
    const note = "Also sent to @frontend. Your part is what is addressed to @backend.";
    const snapshot = appliedSnapshot(
      base({
        tasks: [
          task("t-1", 1, { source: "message", card: { brief: "Rework it", doneWhen: "", note } }),
          task("t-2", 2),
        ],
      }),
    );
    expect(snapshot.board.tasks.map((entry) => [entry.id, entry.note])).toEqual([
      ["t-1", note],
      ["t-2", null],
    ]);
  });

  it.each([
    ["a moment ago", UNATTENDED_MS - 1, []],
    [
      "long enough ago",
      UNATTENDED_MS,
      [["stalled:t-1", "stalled", "the run reached its budget", "2026-09-27T09:55:00.000Z"]],
    ],
  ] as const)(
    "a working task with no turn running, stopped %s, waits on you",
    (_, idleMs, rows) => {
      const since = "2026-09-27T09:55:00.000Z";
      const snapshot = appliedSnapshot(
        base({
          nowMs: Date.parse(since) + idleMs,
          tasks: [task("t-1", 1, { state: "working", attempt: 1 }), task("t-2", 2)],
          midway: new Map([["t-1", { since, why: "the run reached its budget" }]]),
        }),
      );
      expect(snapshot.attention.map((row) => [row.id, row.kind, row.text, row.at])).toEqual(rows);
    },
  );

  it.each([
    ["a moment ago, nobody reviewing", UNATTENDED_MS - 1, false, []],
    [
      "long enough ago, nobody reviewing",
      UNATTENDED_MS,
      false,
      [["review-wait:t-1", "review-wait", "backend", "2026-09-27T09:55:00.000Z"]],
    ],
    ["long ago, the lead's turn reviewing it", UNATTENDED_MS * 3, true, []],
  ] as const)("a task in review since %s", (_, idleMs, reviewing, rows) => {
    const since = "2026-09-27T09:55:00.000Z";
    const snapshot = appliedSnapshot(
      base({
        nowMs: Date.parse(since) + idleMs,
        tasks: [task("t-1", 1, { state: "review", attempt: 1, updatedAt: since })],
        reviewing: new Set(reviewing ? ["t-1"] : []),
      }),
    );
    expect(snapshot.attention.map((row) => [row.id, row.kind, row.handle, row.at])).toEqual(rows);
  });

  it.each([
    ["no run", null, [["sent-back:t-1", "sent-back", "backend", "Name the file hud.ts."]]],
    [
      "a paused run",
      "paused",
      [["sent-back:t-1", "sent-back", "backend", "Name the file hud.ts."]],
    ],
    ["a running run, which sends it back itself", "running", []],
  ] as const)("a task the review sent back, with %s", (_, runState, rows) => {
    const snapshot = appliedSnapshot(
      base({
        run:
          runState === null
            ? null
            : {
                id: "run-1",
                state: runState,
                reason: null,
                reasonDetail: null,
                startedBy: "user-1",
                startedAt: AT,
                elapsedMs: 0,
                spentUsd: 0,
                usagePercent: null,
                options: {
                  budgetUsd: "unlimited",
                  timeLimitHours: "unlimited",
                  stopAtUsagePercent: null,
                  landing: "lead",
                  devGrant: false,
                  leadMayStart: false,
                },
              },
        tasks: [
          task("t-1", 1, {
            state: "rework",
            attempt: 1,
            review: { verdict: "reject", note: "Name the file hud.ts.", by: "lead" },
            waiting: { on: "review", reason: "Name the file hud.ts.", paths: [] },
          }),
        ],
      }),
    );
    expect(snapshot.attention.map((row) => [row.id, row.kind, row.handle, row.text])).toEqual(rows);
  });

  it.each([
    ["was discarded", "discarded", [["dependency-gone:t-2", "dependency-gone", "backend"]]],
    ["stopped", "parked", [["dependency-gone:t-2", "dependency-gone", "backend"]]],
    ["is still being worked", "working", []],
    ["landed", "landed", []],
  ] as const)("a queued task whose dependency %s", (_, state, rows) => {
    const snapshot = appliedSnapshot(
      base({
        tasks: [
          task("t-1", 1, { state, attempt: 1 }),
          task("t-2", 2, { state: "queued", dependsOn: ["t-1"] }),
        ],
      }),
    );
    expect(
      snapshot.attention
        .filter((row) => row.taskId === "t-2")
        .map((row) => [row.id, row.kind, row.handle]),
    ).toEqual(rows);
  });
});
