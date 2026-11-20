import { expect, it } from "vite-plus/test";

import { CrewWorld, home, lead, reader, writer } from "./crewDecideFixture.ts";
import { EMPTY_VIEW, crewSnapshotOf, nextCrewFrame, type CrewView } from "./project.ts";
import type { CrewState, LaneRecord, MemberRecord, RunRecord, TaskRecord } from "./state.ts";

const AT = Date.parse("2026-09-27T10:00:00.000Z");
/** How long a task stands unattended before it waits on you (`UNATTENDED_MS`). */
const UNATTENDED = 5 * 60_000;

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
  counters: { attempt: 1, reworks: 0, remerges: 0, requeues: 0, rotations: 0 },
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

// witness: apps/server/src/zerops/crew/engine/project.ts | view: Math.max(...seen) + 1 → view: Math.max(...seen)
it("CD28: A change the crew shows reaches a client that subscribed late: a frame whose view moved at a step a frame already stands at gets a newer view, and a step that shows nothing new publishes no frame", () => {
  const none = new CrewWorld().state;
  // A dev service that came up after a step that showed nothing new.
  const shown = crewSnapshotOf({ ...none, headSeq: 12 }, view({ devHosts: { appdev: null } }));
  // An observed batch moves the crew's step and nothing it shows: the latest frame, unpublished,
  // that a client subscribing now starts from.
  const latest = crewSnapshotOf({ ...none, headSeq: 13 }, view({ devHosts: { appdev: null } }));
  const up = crewSnapshotOf({ ...none, headSeq: 13 }, view({ devHosts: { appdev: true } }));
  expect(nextCrewFrame(shown, latest)).toBeNull();
  expect(nextCrewFrame(shown, up, latest)?.revision).toEqual({ epoch: 4, seq: 13, view: 1 });

  // A dev service that came up at the same step.
  const at12 = { ...none, headSeq: 12 };
  const before = crewSnapshotOf(at12, view({ devHosts: { appdev: null } }));
  const sameStep = crewSnapshotOf(at12, view({ devHosts: { appdev: true } }));
  const moved = nextCrewFrame(before, sameStep);
  const next = crewSnapshotOf({ ...none, headSeq: 13 }, view({ devHosts: { appdev: false } }));
  expect(moved?.revision).toEqual({ epoch: 4, seq: 12, view: 1 });
  expect(nextCrewFrame(moved!, sameStep)).toBeNull();
  expect(nextCrewFrame(moved!, next)?.revision).toEqual({ epoch: 4, seq: 13 });
});

// witness: apps/server/src/zerops/crew/engine/project.ts | view.nowMs - stopped.since < UNATTENDED_MS → view.nowMs - stopped.since <= UNATTENDED_MS
it("CD29: A working task whose turn stopped waits on you once it has stood unattended for the set time, and a task in review that nobody reviews after the same time; not before, and not while the lead's turn reviews it", () => {
  const since = Date.parse("2026-09-27T09:55:00.000Z");
  const working = withTasks(applied(), [
    task("t-1", 1, {
      state: "working",
      started: true,
      midway: { since, why: "when the $20 ran out" },
    }),
    task("t-2", 2),
  ]);
  const stalled = (idleMs: number) =>
    crewSnapshotOf(working, view({ nowMs: since + idleMs })).attention.map((row) => [
      row.id,
      row.kind,
    ]);
  expect(stalled(UNATTENDED - 1)).toEqual([]);
  expect(stalled(UNATTENDED)).toEqual([["stalled:t-1", "stalled"]]);

  const inReview = withTasks(applied(), [
    task("t-1", 1, { state: "review", started: true, updatedAt: since }),
  ]);
  const reviewedByLead = withMember(
    {
      ...inReview,
      lead: { ...inReview.lead, serving: { key: "review:t-1:1", kind: "review", taskId: "t-1" } },
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
  const waits = (state: CrewState, idleMs: number) =>
    crewSnapshotOf(state, view({ nowMs: since + idleMs })).attention.map((row) => [
      row.id,
      row.kind,
    ]);
  expect(waits(inReview, UNATTENDED - 1)).toEqual([]);
  expect(waits(inReview, UNATTENDED)).toEqual([["review-wait:t-1", "review-wait"]]);
  expect(waits(reviewedByLead, UNATTENDED * 3)).toEqual([]);
});

// witness: apps/server/src/zerops/crew/engine/project.ts | return state.run?.state === "running" ? undefined : row("sent-back", { text: wait.reason }); → return state.run !== null ? undefined : row("sent-back", { text: wait.reason });
it("CD30: A task the review sent back waits on you unless a running run sends it back itself", () => {
  const sentBack = withTasks(applied(), [
    task("t-1", 1, {
      state: "rework",
      started: true,
      review: { verdict: "reject", note: "Name the file hud.ts.", by: "lead" },
      wait: { on: "review", reason: "Name the file hud.ts.", paths: [] },
    }),
  ]);
  const waits = (runState: RunRecord["state"] | null) =>
    crewSnapshotOf(
      { ...sentBack, run: runState === null ? null : run(runState) },
      view(),
    ).attention.map((row) => [row.id, row.kind, row.handle]);
  expect(waits(null)).toEqual([["sent-back:t-1", "sent-back", "backend"]]);
  expect(waits("paused")).toEqual([["sent-back:t-1", "sent-back", "backend"]]);
  expect(waits("running")).toEqual([]);
});

// witness: apps/server/src/zerops/crew/engine/project.ts | return dependency === "discarded" || dependency === "parked"; → return dependency === "discarded";
it("CD31: A queued task whose dependency was discarded or stopped waits on you; one whose dependency is still worked or landed does not", () => {
  const waits = (dependency: TaskRecord["state"]) =>
    crewSnapshotOf(
      withTasks(applied(), [
        task("t-1", 1, { state: dependency, started: true }),
        task("t-2", 2, { state: "queued", dependsOn: ["t-1"] }),
      ]),
      view(),
    )
      .attention.filter((row) => row.taskId === "t-2")
      .map((row) => [row.id, row.kind, row.handle]);
  expect(waits("discarded")).toEqual([["dependency-gone:t-2", "dependency-gone", "backend"]]);
  expect(waits("parked")).toEqual([["dependency-gone:t-2", "dependency-gone", "backend"]]);
  expect(waits("working")).toEqual([]);
  expect(waits("landed")).toEqual([]);
});

// witness: apps/server/src/zerops/crew/engine/project.ts | row("conflict", { paths: wait.paths }) → row("conflict")
it("CD32: A merge conflict, a crewmate's question and a task admission refused each wait on you, a conflict naming its paths", () => {
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
  expect([backend.openTaskId, backend.queuedTaskIds]).toEqual(["t-2", ["t-3"]]);
  expect(snapshot.attention.map((row) => [row.id, row.kind, row.paths])).toEqual([
    ["conflict:t-2", "conflict", ["a.ts"]],
    ["question:t-4", "question", []],
    ["cant-start:t-5", "cant-start", []],
  ]);
});

// witness: apps/server/src/zerops/crew/engine/project.ts | task.state === "landed" && task.landedCommit !== null → task.state === "landed"
it("CD33: A task closed with nothing to land is not counted as landed work waiting to be delivered", () => {
  const snapshot = crewSnapshotOf(
    withTasks(applied(), [
      task("t-1", 1, { state: "landed", landedCommit: "c".repeat(40), landedAt: AT }),
      task("t-2", 2, { state: "landed", landedCommit: null, landedAt: AT }),
    ]),
    view(),
  );
  expect(snapshot.landedNotDelivered).toBe(1);
});

// witness: apps/server/src/zerops/crew/engine/project.ts | if (hostFrozen(state, member.host)) return { state: "frozen", detail: null }; → if (hostFrozen(state, member.handle)) return { state: "frozen", detail: null };
it("CD34: A crewmate's copy reads as being made, set up, frozen by a redeploy, gone or lost as its lane and its host stand", () => {
  const laneOf = (state: CrewState) =>
    crewSnapshotOf(state, view()).crewmates.find((mate) => mate.handle === "backend")!.lane!.state;
  expect(laneOf(withLane(applied(), { state: "creating" }))).toBe("creating");
  expect(laneOf(withLane(applied(), { state: "setting-up", detail: "npm ci" }))).toBe("setting-up");
  const redeploying = applied();
  expect(
    laneOf({
      ...redeploying,
      hosts: {
        ...redeploying.hosts,
        appdev: { ...redeploying.hosts.appdev!, frozenSince: AT },
      },
    }),
  ).toBe("frozen");
  expect(laneOf(withLane(applied(), { state: "missing" }))).toBe("missing");
  expect(laneOf(withLane(applied(), { state: "failed", detail: "lost" }))).toBe("failed");
});
