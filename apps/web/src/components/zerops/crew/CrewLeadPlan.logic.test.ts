import { crewAccess, type CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewRun, type CrewSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  crewmateFace,
  crewPlanCard,
  crewPlanCommand,
  crewPlanLocks,
  crewPlanStart,
} from "./CrewLeadPlan.logic";

const IDLE: CrewThreadRead = {
  status: { kind: "idle", toneId: "neutral" },
  word: null,
  working: false,
};
const WORKING: CrewThreadRead = {
  status: { kind: "working", toneId: "active" },
  word: "Working",
  working: true,
};

/** Each crewmate's current stint as a shell; `backend` is mid-turn, the rest idle. */
function viewOf(snapshot: CrewSnapshot) {
  const shells: ReadonlyArray<CrewShellInput> = snapshot.crewmates.flatMap((crewmate) =>
    crewmate.currentThreadId === null
      ? []
      : [{ id: crewmate.currentThreadId, archivedAt: null, crew: null }],
  );
  return deriveCrewView(snapshot, shells, (shell) =>
    shell.id === ThreadId.make("thread-crew-backend-2") ? WORKING : IDLE,
  );
}

describe("crewPlanCard", () => {
  const fixture = crewSnapshotFixture();
  const secondRow = {
    ...fixture.board.tasks.find((task) => task.id === "task-16")!,
    id: "task-18",
    number: 18,
    title: "Document the rate limits",
    owner: "frontend",
    dependsOn: ["task-16"],
  };

  it.each([
    {
      name: "the lead's proposed tasks are one plan, a line per task",
      snapshot: fixture,
      rows: [{ taskId: "task-16", title: "Rate-limit the public API", after: null }],
    },
    {
      name: "a task that waits for another says so by the other's title",
      snapshot: crewSnapshotFixture({ board: { tasks: [...fixture.board.tasks, secondRow] } }),
      rows: [
        { taskId: "task-16", title: "Rate-limit the public API", after: null },
        {
          taskId: "task-18",
          title: "Document the rate limits",
          after: "after Rate-limit the public API",
        },
      ],
    },
    {
      name: "a dependency that went in is no reason to wait",
      snapshot: crewSnapshotFixture({
        board: {
          tasks: [...fixture.board.tasks, { ...secondRow, dependsOn: ["task-11"] }],
        },
      }),
      rows: [
        { taskId: "task-16", title: "Rate-limit the public API", after: null },
        { taskId: "task-18", title: "Document the rate limits", after: null },
      ],
    },
  ])("$name", ({ snapshot, rows }) => {
    const plan = crewPlanCard(snapshot, viewOf(snapshot));
    expect(plan?.rows.map(({ taskId, title, after }) => ({ taskId, title, after }))).toEqual(rows);
  });

  it("is nothing while the lead proposes nothing", () => {
    const snapshot = crewSnapshotFixture({
      board: { tasks: fixture.board.tasks.filter((task) => task.state !== "proposed") },
    });
    expect(crewPlanCard(snapshot, viewOf(snapshot))).toBeNull();
  });

  it("draws each line's crewmate by its face, never its handle", () => {
    expect(crewPlanCard(fixture, viewOf(fixture))?.rows[0]?.owner).toEqual({
      handle: "backend",
      name: "Backend",
      tint: "sky",
      face: "working",
    });
  });
});

describe("crewmateFace", () => {
  it("names someone no longer on the crew without a handle", () => {
    expect(crewmateFace("gone", null)).toEqual({
      handle: "gone",
      name: "Someone who left the crew",
      tint: null,
      face: "idle",
    });
  });
});

describe("crewPlanCommand", () => {
  it.each([
    {
      name: "Start accepts the rows",
      tag: "planAccept",
      taskIds: ["task-16", "task-18"],
      command: { _tag: "planAccept", taskIds: ["task-16", "task-18"] },
    },
    {
      name: "leaving one out drops only that one",
      tag: "planDiscard",
      taskIds: ["task-18"],
      command: { _tag: "planDiscard", taskIds: ["task-18"] },
    },
    { name: "no rows, no command", tag: "planAccept", taskIds: [], command: null },
  ] as const)("$name", ({ tag, taskIds, command }) => {
    expect(crewPlanCommand(tag, taskIds)).toEqual(command);
  });
});

describe("crewPlanStart: what Start sends, for each run", () => {
  const run = crewSnapshotFixture().run!;
  const accept = { _tag: "planAccept", taskIds: ["task-16"] } as const;
  const at = (fields: Partial<CrewRun>): CrewRun => ({ ...run, ...fields });

  it.each<[string, CrewRun | null, unknown]>([
    [
      "a run running: the plan joins its work",
      at({ state: "running" }),
      { kind: "send", commands: [accept] },
    ],
    [
      "a run wrapping up: the plan waits in its queue",
      at({ state: "finishing" }),
      { kind: "send", commands: [accept] },
    ],
    [
      "no run yet: the dialog asks how much and how long first",
      null,
      { kind: "dialog", dialog: "start", after: accept },
    ],
    [
      "a run over: a new one on the last one's limits, then the plan",
      at({ state: "finished" }),
      { kind: "send", commands: [{ _tag: "start", ...run.options }, accept] },
    ],
    [
      "a run stopped: the same",
      at({ state: "stopped" }),
      { kind: "send", commands: [{ _tag: "start", ...run.options }, accept] },
    ],
    [
      "paused by the person: it goes on, then the plan",
      at({ state: "paused", reason: "person" }),
      { kind: "send", commands: [{ _tag: "resume", runId: run.id }, accept] },
    ],
    [
      "paused by a refusal: the same",
      at({ state: "paused", reason: "refused", reasonDetail: "signed out" }),
      { kind: "send", commands: [{ _tag: "resume", runId: run.id }, accept] },
    ],
    [
      "stopped by its budget: the dialog first, for more money",
      at({ state: "paused", reason: "budget" }),
      { kind: "dialog", dialog: "resume", after: accept },
    ],
    [
      "stopped by its time: the dialog first, for more time",
      at({ state: "paused", reason: "time" }),
      { kind: "dialog", dialog: "resume", after: accept },
    ],
    [
      "stopped by the usage stop: the dialog first",
      at({ state: "paused", reason: "usage" }),
      { kind: "dialog", dialog: "resume", after: accept },
    ],
  ])("%s", (_, latest, start) => {
    expect(crewPlanStart(latest, ["task-16"])).toEqual(start);
  });

  it("starts nothing without a task to start", () => {
    expect(crewPlanStart(run, [])).toBeNull();
  });
});

describe("crewPlanLocks — the plan's presses for a viewer who may not run all it reaches (D6)", () => {
  const fixture = crewSnapshotFixture();
  const plan = fixture.board.tasks.filter((task) => task.state === "proposed");
  const planIds = plan.map((task) => task.id);
  const lock = (login: string): CrewLock => ({
    login,
    agentId: "claude-code",
    ownership: "someone-else",
  });
  /** The viewer may not run `closed`; `defaultLogin` for a crew with no run. */
  const accessOf = (closed: ReadonlyArray<string>) =>
    crewAccess({
      snapshot: fixture,
      lockOf: (login) => (closed.includes(login) ? lock(login) : null),
      defaultLogin: "claudeAgent",
      reading: false,
    });
  const owners = new Set(
    plan.map((task) => fixture.crewmates.find((mate) => mate.handle === task.owner)!.login.id),
  );

  it("offers every press to the person who runs every login", () => {
    const locks = crewPlanLocks(fixture.run, planIds, accessOf([]));
    expect([locks.start, locks.change, locks.drop, locks.leaveOut(planIds[0]!)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("closes Start, Change, Drop the plan and ×, each on what it reaches, for a login of the plan's", () => {
    const [owner] = [...owners];
    const locks = crewPlanLocks(fixture.run, planIds, accessOf([owner!]));
    expect([locks.start, locks.drop, locks.leaveOut(planIds[0]!)]).toEqual([
      lock(owner!),
      lock(owner!),
      lock(owner!),
    ]);
  });

  it("closes Start and Change through the run dialog on the crew's logins", () => {
    const closedElsewhere = fixture.crewmates
      .map((mate) => mate.login.id)
      .find((login) => !owners.has(login))!;
    const locks = crewPlanLocks(null, planIds, accessOf([closedElsewhere]));
    expect([locks.start, locks.change, locks.drop]).toEqual([
      lock(closedElsewhere),
      lock(closedElsewhere),
      null,
    ]);
  });
});
