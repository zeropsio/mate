import { expect, it } from "vite-plus/test";

import { CrewWorld, home, lead, reader, writer } from "./crewDecideFixture.ts";
import { crewSnapshotOf, nextCrewFrame, type CrewView } from "./project.ts";
import { landingsToRead } from "./shipReads.ts";
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
  nowMs: AT,
  epoch: 4,
  logins: {},
  devHosts: {},
  memory: {},
  context: {},
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

// witness: apps/server/src/zerops/crew/engine/project.ts | task.shipRead?.commit !== task.landedCommit → task.shipRead === undefined
it("CD90: A landed task counts as shipped, or as not shipped yet, only by what the Mate read of its own landing commit on the origin's branches; one never read, read for an earlier landing, or closed with nothing to land counts as neither; breaks: after a restart, or once the Mate moved the work onto a branch of its own, the Crew tab says it hasn't shipped work it shipped", () => {
  const landing = (n: number) => String(n).repeat(40);
  const landed = (id: string, n: number, fields: Partial<TaskRecord>) =>
    task(id, n, { state: "landed", landedCommit: landing(n), landedAt: AT, ...fields });
  const snapshot = crewSnapshotOf(
    withTasks(applied(), [
      landed("t-1", 1, { shipRead: { commit: landing(1), shipped: true } }),
      landed("t-2", 2, { shipRead: { commit: landing(2), shipped: false } }),
      landed("t-3", 3, {}),
      landed("t-4", 4, { shipRead: { commit: landing(9), shipped: false } }),
      task("t-5", 5, { state: "landed", landedCommit: null, landedAt: AT }),
    ]),
    view(),
  );
  expect([
    snapshot.board.tasks.map((entry) => [entry.id, entry.delivered]),
    snapshot.landedNotDelivered,
  ]).toEqual([
    [
      ["t-1", true],
      ["t-2", false],
      ["t-3", false],
      ["t-4", false],
      ["t-5", false],
    ],
    1,
  ]);
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

// witness: apps/server/src/zerops/crew/engine/project.ts | return reviewing || reviewUnderWay(state, task) || view.nowMs - task.updatedAt < UNATTENDED_MS → return reviewing || view.nowMs - task.updatedAt < UNATTENDED_MS
it("CD89: Work waiting for the lead's review raises no need of its own while a review the lead planned of it is under way, its question to the person included; once that review is over, an unattended wait shows again; breaks: one question to the person shows as two crewmates needing them", () => {
  const since = AT - UNATTENDED;
  const built = task("t-1", 1, { state: "review", started: true, updatedAt: since });
  const review = (state: TaskRecord["state"]) =>
    task("t-2", 2, {
      owner: "reviewer",
      state,
      started: true,
      reviews: "t-1",
      askedAt: since,
      report:
        state === "blocked"
          ? { status: "blocked", summary: "?", question: "May I open the live page?" }
          : null,
    });
  const waits = (reviewState: TaskRecord["state"]) =>
    crewSnapshotOf(
      withTasks(applied(), [built, review(reviewState)]),
      view({ nowMs: AT + 30 * 60_000 }),
    ).attention.map((row) => row.id);
  expect([waits("blocked"), waits("landed")]).toEqual([["question:t-2"], ["review-wait:t-1"]]);
});

// witness: apps/server/src/zerops/crew/engine/shipReads.ts | tasks.toSorted((a, b) => b.landedAt! - a.landedAt!).slice(0, SHIP_READS_PER_HOST), → tasks.toSorted((a, b) => b.landedAt! - a.landedAt!),
it("CD91: What shipped is read of at most a dev service's 20 newest landings not read as shipped, none landed more than 30 days ago, and the Crew tab counts those of them not read yet as unread, claiming nothing of them; breaks: every boot and every feed opened re-reads all of a long-lived crew's landings, until one slow read keeps every one unread", () => {
  const MINUTE = 60_000;
  const DAY = 24 * 60 * MINUTE;
  const landed = (n: number, landedAt: number, fields: Partial<TaskRecord> = {}) =>
    task(`t-${n}`, n, {
      state: "landed",
      landedCommit: String(n % 10).repeat(40) + String(n),
      landedAt,
      ...fields,
    });
  const tasks = [
    ...Array.from({ length: 22 }, (_, index) => landed(index + 1, AT - (22 - index) * MINUTE)),
    landed(23, AT - 31 * DAY),
  ];
  // The newest is read as shipped already: it is read no more.
  const newest = tasks[21]!;
  const state = withTasks(applied(), [
    ...tasks.slice(0, 21),
    { ...newest, shipRead: { commit: newest.landedCommit!, shipped: true } },
    tasks[22]!,
  ]);
  const toRead = landingsToRead(state, AT);
  expect([
    [...toRead.keys()],
    toRead.get("appdev")?.map((entry) => entry.number),
    crewSnapshotOf(state, view()).landedUnread,
  ]).toEqual([
    ["appdev"],
    [21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
    20,
  ]);
});
