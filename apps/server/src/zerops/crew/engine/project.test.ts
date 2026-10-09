import { CrewSnapshot, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { TASK_START } from "../crewMachines.ts";
import { CrewWorld, home, lead, reader, writer } from "./crewDecideFixture.ts";
import { UNATTENDED_MS } from "./decide.ts";
import {
  CREW_OFF_SNAPSHOT,
  EMPTY_VIEW,
  crewSnapshotOf,
  nextCrewFrame,
  type CrewView,
} from "./project.ts";
import type { CrewState, LaneRecord, MemberRecord, RunRecord, TaskRecord } from "./state.ts";

const AT = Date.parse("2026-09-27T10:00:00.000Z");
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const definition = {
  ...home(writer("backend", { run: "npm run dev" }), reader("reviewer"), lead("lead")),
  brief: { title: "Space shooter", text: "First line.\nSecond line.\nThird.", doneWhen: [] },
};

/** The crew as Apply leaves it: every crewmate's agent assigned, the writer's copy ready. */
const applied = (): CrewState => new CrewWorld().apply(definition).state;

const withMember = (
  state: CrewState,
  handle: string,
  fields: Partial<MemberRecord>,
): CrewState => ({
  ...state,
  members: { ...state.members, [handle]: { ...state.members[handle]!, ...fields } },
});

const withLane = (state: CrewState, fields: Partial<LaneRecord>): CrewState =>
  withMember(state, "backend", { lane: { ...state.members.backend!.lane!, ...fields } });

const task = (id: string, number: number, fields: Partial<TaskRecord> = {}): TaskRecord => ({
  id,
  number,
  title: `Task ${number}`,
  owner: "backend",
  state: "queued",
  source: "you",
  createdBy: "user-1",
  createdAt: AT,
  updatedAt: AT,
  dependsOn: [],
  fresh: false,
  card: { brief: `Brief ${number}`, doneWhen: "", note: null },
  counters: TASK_START,
  started: false,
  wait: null,
  report: null,
  askedAt: null,
  review: null,
  check: null,
  landedCommit: null,
  landedAt: null,
  cantStart: null,
  midway: null,
  starting: null,
  landAs: null,
  nudgedAttempt: null,
  landRetriedAttempt: null,
  checkpointing: false,
  runId: null,
  ...fields,
});

const withTasks = (state: CrewState, tasks: ReadonlyArray<TaskRecord>): CrewState => ({
  ...state,
  tasks: Object.fromEntries(tasks.map((entry) => [entry.id, entry])),
  nextTaskNumber: tasks.length + 1,
});

const view = (fields: Partial<CrewView> = {}): CrewView => ({
  ...EMPTY_VIEW,
  nowMs: AT,
  epoch: 4,
  ...fields,
});

const run = (state: RunRecord["state"]): RunRecord => ({
  id: "run-1",
  state,
  reason: null,
  reasonDetail: null,
  startedBy: "user-1",
  startedAt: AT,
  options: {
    budgetUsd: "unlimited",
    timeLimitHours: "unlimited",
    stopAtUsagePercent: null,
    landing: "lead",
    devGrant: false,
    leadMayStart: false,
  },
  spentUsd: 0,
  keptMs: 0,
  since: null,
  leadWakes: 0,
});

const decode = Schema.decodeUnknownSync(CrewSnapshot);

describe("crew snapshot", () => {
  it("a dev service that came up after a step that showed nothing new moves past the frame a late client started from", () => {
    const none = new CrewWorld().state;
    const shown = crewSnapshotOf({ ...none, headSeq: 12 }, view({ devHosts: { appdev: null } }));
    // An observed batch moves the crew's step and nothing it shows: the latest frame, unpublished,
    // that a client subscribing now starts from.
    const latest = crewSnapshotOf({ ...none, headSeq: 13 }, view({ devHosts: { appdev: null } }));
    const up = crewSnapshotOf({ ...none, headSeq: 13 }, view({ devHosts: { appdev: true } }));
    expect([nextCrewFrame(shown, latest), nextCrewFrame(shown, up, latest)?.revision]).toEqual([
      null,
      { epoch: 4, seq: 13, view: 1 },
    ]);
  });

  it("a dev service that came up at the same step moves the frame's view, so a client takes it", () => {
    const none = { ...new CrewWorld().state, headSeq: 12 };
    const before = crewSnapshotOf(none, view({ devHosts: { appdev: null } }));
    const up = crewSnapshotOf(none, view({ devHosts: { appdev: true } }));
    const moved = nextCrewFrame(before, up);
    const next = crewSnapshotOf({ ...none, headSeq: 13 }, view({ devHosts: { appdev: false } }));
    expect([
      moved?.revision,
      nextCrewFrame(moved!, up),
      nextCrewFrame(moved!, next)?.revision,
    ]).toEqual([{ epoch: 4, seq: 12, view: 1 }, null, { epoch: 4, seq: 13 }]);
  });

  it("off and none carry no crew and empty lists; none offers the dev services by name", () => {
    expect(decode(CREW_OFF_SNAPSHOT)).toEqual(CREW_OFF_SNAPSHOT);
    const none = new CrewWorld().state;
    expect(
      crewSnapshotOf(
        { ...none, headSeq: 12, lastError: "boom" },
        view({ devHosts: { webdev: null, appdev: true } }),
      ),
    ).toEqual({
      ...CREW_OFF_SNAPSHOT,
      status: "none",
      seq: 12,
      revision: { epoch: 4, seq: 12 },
      devHosts: [
        { host: "appdev", database: true },
        { host: "webdev", database: null },
      ],
      lastError: "boom",
    });
  });

  it("an applied crew: the lead first, then the home's order; wire rules hold", () => {
    const state = withMember(applied(), "backend", {
      crewPort: 3001,
      session: {
        count: 2,
        lastReason: "cleared",
        running: { brief: 1, job: 1 },
        principal: "user-1",
        login: "claudeAgent",
        compactions: 1,
        startedAt: AT,
      },
    });
    const snapshot = crewSnapshotOf(state, view());
    expect(() => decode(snapshot)).not.toThrow();
    expect(snapshot.crew).toEqual({
      name: "Game team",
      briefTitle: "Space shooter",
      briefVersion: 1,
      briefExcerpt: "First line.\nSecond line.",
    });
    expect(snapshot.revision).toEqual({ epoch: 4, seq: state.headSeq });
    expect(snapshot.crewmates.map((mate) => mate.handle)).toEqual(["lead", "backend", "reviewer"]);
    const backend = snapshot.crewmates[1]!;
    const conversationId = state.members.backend!.conversationId;
    expect({
      jobFirstLine: backend.jobFirstLine,
      jobVersion: backend.jobVersion,
      promptVersions: backend.promptVersions,
      conversationId: backend.conversationId,
      currentThreadId: backend.currentThreadId,
      stints: backend.stints,
      sessions: backend.sessions,
      compactions: backend.compactions,
      lane: backend.lane,
      app: backend.app,
    }).toEqual({
      jobFirstLine: "backend owns its part.",
      jobVersion: 1,
      promptVersions: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 1 } },
      conversationId,
      currentThreadId: ThreadId.make(conversationId),
      stints: [],
      sessions: { count: 2, lastReason: "cleared" },
      compactions: 1,
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

  it.each<[string, (state: CrewState) => CrewState, string]>([
    ["Apply is making the copy", (state) => withLane(state, { state: "creating" }), "creating"],
    [
      "setup runs",
      (state) => withLane(state, { state: "setting-up", detail: "npm ci" }),
      "setting-up",
    ],
    [
      "the service is redeploying",
      (state) => ({
        ...state,
        hosts: { ...state.hosts, appdev: { ...state.hosts.appdev!, frozenSince: AT } },
      }),
      "frozen",
    ],
    ["the directory is gone", (state) => withLane(state, { state: "missing" }), "missing"],
    [
      "a recovery lost it",
      (state) => withLane(state, { state: "failed", detail: "lost" }),
      "failed",
    ],
  ])("a lane reads its state when %s", (_, arrange, state) => {
    const snapshot = crewSnapshotOf(arrange(applied()), view());
    expect(snapshot.crewmates.find((mate) => mate.handle === "backend")!.lane!.state).toBe(state);
  });

  it("the board, the open and queued tasks, and Waiting on you", () => {
    const state = withTasks(
      withLane(applied(), { stats: { ahead: 2, insertions: 10, deletions: 1, dirty: true } }),
      [
        task("t-1", 1, { state: "landed", landedCommit: "c".repeat(40), started: true }),
        task("t-2", 2, {
          state: "rework",
          started: true,
          wait: { on: "conflict", reason: "conflicts with what landed", paths: ["a.ts"] },
        }),
        task("t-3", 3, { state: "queued" }),
        task("t-4", 4, {
          owner: "reviewer",
          state: "blocked",
          started: true,
          askedAt: AT,
          report: { status: "blocked", summary: "?", question: "CZK or EUR?" },
        }),
        task("t-5", 5, {
          state: "queued",
          owner: "reviewer",
          cantStart: { text: "not the login's signer", at: AT },
        }),
      ],
    );
    const snapshot = crewSnapshotOf(state, view());
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
    const snapshot = crewSnapshotOf(
      withTasks(applied(), [
        task("t-1", 1, { source: "message", card: { brief: "Rework it", doneWhen: "", note } }),
        task("t-2", 2),
      ]),
      view(),
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
      [["stalled:t-1", "stalled", "when the $20 ran out", "2026-09-27T09:55:00.000Z"]],
    ],
  ] as const)(
    "a working task with no turn running, stopped %s, waits on you",
    (_, idleMs, rows) => {
      const since = Date.parse("2026-09-27T09:55:00.000Z");
      const snapshot = crewSnapshotOf(
        withTasks(applied(), [
          task("t-1", 1, {
            state: "working",
            started: true,
            midway: { since, why: "when the $20 ran out" },
          }),
          task("t-2", 2),
        ]),
        view({ nowMs: since + idleMs }),
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
    const since = Date.parse("2026-09-27T09:55:00.000Z");
    let state = withTasks(applied(), [
      task("t-1", 1, { state: "review", started: true, updatedAt: since }),
    ]);
    if (reviewing) {
      state = withMember(
        {
          ...state,
          lead: { ...state.lead, serving: { key: "review:t-1:1", kind: "review", taskId: "t-1" } },
        },
        "lead",
        {
          active: {
            runId: "lead-run" as never,
            principal: { kind: "crew", startedBy: "user-1" },
            delivery: null,
            taskId: "t-1",
            purpose: "lead-wake",
            admitted: true,
            reached: true,
            since,
          },
        },
      );
    }
    const snapshot = crewSnapshotOf(state, view({ nowMs: since + idleMs }));
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
    const snapshot = crewSnapshotOf(
      {
        ...withTasks(applied(), [
          task("t-1", 1, {
            state: "rework",
            started: true,
            review: { verdict: "reject", note: "Name the file hud.ts.", by: "lead" },
            wait: { on: "review", reason: "Name the file hud.ts.", paths: [] },
          }),
        ]),
        run: runState === null ? null : run(runState),
      },
      view(),
    );
    expect(snapshot.attention.map((row) => [row.id, row.kind, row.handle, row.text])).toEqual(rows);
  });

  it.each([
    ["was discarded", "discarded", [["dependency-gone:t-2", "dependency-gone", "backend"]]],
    ["stopped", "parked", [["dependency-gone:t-2", "dependency-gone", "backend"]]],
    ["is still being worked", "working", []],
    ["landed", "landed", []],
  ] as const)("a queued task whose dependency %s", (_, state, rows) => {
    const snapshot = crewSnapshotOf(
      withTasks(applied(), [
        task("t-1", 1, { state, started: true }),
        task("t-2", 2, { state: "queued", dependsOn: ["t-1"] }),
      ]),
      view(),
    );
    expect(
      snapshot.attention
        .filter((row) => row.taskId === "t-2")
        .map((row) => [row.id, row.kind, row.handle]),
    ).toEqual(rows);
  });

  it("counts a task closed with nothing to land as nothing to deliver", () => {
    const snapshot = crewSnapshotOf(
      withTasks(applied(), [
        task("t-1", 1, { state: "landed", landedCommit: "c".repeat(40), landedAt: AT }),
        task("t-2", 2, { state: "landed", landedCommit: null, landedAt: AT }),
      ]),
      view(),
    );
    expect(snapshot.landedNotDelivered).toBe(1);
  });

  it("dates a task that went in by its landing, and no other", () => {
    const landedAt = Date.parse("2026-09-27T09:30:00.000Z");
    const snapshot = crewSnapshotOf(
      withTasks(applied(), [
        task("t-1", 1, { state: "landed", landedCommit: "c".repeat(40), landedAt }),
        task("t-2", 2, { state: "working", updatedAt: Date.parse("2026-09-27T09:40:00.000Z") }),
      ]),
      view(),
    );
    expect(snapshot.board.tasks.map((row) => [row.id, row.landedAt])).toEqual([
      ["t-1", iso(landedAt)],
      ["t-2", null],
    ]);
  });
});
