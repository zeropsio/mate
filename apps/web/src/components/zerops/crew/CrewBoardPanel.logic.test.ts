import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import {
  deriveCrewView,
  type CrewShellInput,
  type CrewThreadRead,
} from "@t3tools/client-runtime/zerops/projections/crew";
import { ThreadId, type CrewSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  crewBoardModel,
  crewDependencyOptions,
  crewNewTaskCommand,
  crewPlanCard,
  crewPlanCommand,
  crewRunOn,
  crewTaskEditCommand,
  crewTaskOwners,
  crewTaskSheet,
} from "./CrewBoardPanel.logic";

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
      : [
          {
            id: crewmate.currentThreadId,
            archivedAt: null,
            crew: { crew: "game", crewmate: crewmate.handle, stint: crewmate.stints.length },
          },
        ],
  );
  return deriveCrewView(snapshot, shells, (shell) =>
    shell.id === ThreadId.make("thread-crew-backend-2") ? WORKING : IDLE,
  );
}

const boardOf = (snapshot: CrewSnapshot) => crewBoardModel(snapshot, viewOf(snapshot));

describe("crewBoardModel columns", () => {
  const fixture = crewSnapshotFixture();
  const writersOnly = crewSnapshotFixture({
    crewmates: fixture.crewmates.filter((crewmate) => crewmate.kind === "writer"),
    board: {
      tasks: fixture.board.tasks.filter((task) => task.state !== "proposed"),
    },
    run: null,
  });

  it.each([
    {
      name: "a crew with a lead: five columns, the plan counted as one item",
      snapshot: fixture,
      columns: [
        { id: "waiting-on-you", title: "Waiting on you", count: 4, cards: [13, 14, 17] },
        { id: "working", title: "Working", count: 1, cards: [12] },
        { id: "in-review", title: "In review", count: 0, cards: [] },
        { id: "queued", title: "Queued", count: 1, cards: [15] },
        { id: "landed", title: "Landed", count: 2, cards: [10, 11] },
      ],
    },
    {
      name: "writers only: no In review column, no plan",
      snapshot: writersOnly,
      columns: [
        { id: "waiting-on-you", title: "Waiting on you", count: 3, cards: [13, 14, 17] },
        { id: "working", title: "Working", count: 1, cards: [12] },
        { id: "queued", title: "Queued", count: 1, cards: [15] },
        { id: "landed", title: "Landed", count: 2, cards: [10, 11] },
      ],
    },
    {
      name: "a ready task that lands on its own keeps In review even without a reviewer",
      snapshot: crewSnapshotFixture({
        ...writersOnly,
        board: {
          tasks: writersOnly.board.tasks.map((task) =>
            task.id === "task-12" ? { ...task, state: "ready" } : task,
          ),
        },
        run: fixture.run && {
          ...fixture.run,
          options: { ...fixture.run.options, landing: "check" },
        },
      }),
      columns: [
        { id: "waiting-on-you", title: "Waiting on you", count: 3, cards: [13, 14, 17] },
        { id: "working", title: "Working", count: 0, cards: [] },
        { id: "in-review", title: "In review", count: 1, cards: [12] },
        { id: "queued", title: "Queued", count: 1, cards: [15] },
        { id: "landed", title: "Landed", count: 2, cards: [10, 11] },
      ],
    },
  ])("$name", ({ snapshot, columns }) => {
    expect(
      boardOf(snapshot).columns.map(({ id, title, count, cards }) => ({
        id,
        title,
        count,
        cards: cards.map((card) => card.number),
      })),
    ).toEqual(columns);
  });
});

describe("crewBoardModel header", () => {
  const fixture = crewSnapshotFixture();
  const run = fixture.run!;

  it.each([
    {
      name: "a run on",
      snapshot: fixture,
      state: { word: "Running · 1 h 12 m", tone: "busy", pulse: false },
    },
    {
      name: "a paused run waits on you",
      snapshot: crewSnapshotFixture({ run: { ...run, state: "paused", reason: "budget" } }),
      state: { word: "Paused · budget reached", tone: "attention", pulse: false },
    },
    {
      name: "no run, one crewmate working",
      snapshot: crewSnapshotFixture({ run: null }),
      state: { word: "1 working", tone: "busy", pulse: false },
    },
    {
      name: "no run, nobody working",
      snapshot: crewSnapshotFixture({
        run: { ...run, state: "finished" },
        crewmates: fixture.crewmates.map((crewmate) => ({ ...crewmate, currentThreadId: null })),
      }),
      state: { word: "Idle", tone: "off", pulse: false },
    },
  ] as const)("$name", ({ snapshot, state }) => {
    expect(boardOf(snapshot).header).toEqual({ briefTitle: "Camera and HUD rework", state });
  });
});

describe("crewBoardModel runOn", () => {
  const run = crewSnapshotFixture().run!;

  it.each([
    { state: "running", on: true },
    { state: "paused", on: true },
    { state: "finishing", on: false },
    { state: "finished", on: false },
    { state: "stopped", on: false },
  ] as const)("a $state run is on: $on", ({ state, on }) => {
    expect(boardOf(crewSnapshotFixture({ run: { ...run, state } })).runOn).toBe(on);
    expect(crewRunOn({ ...run, state })).toBe(on);
  });

  it("no run is not on", () => {
    expect(boardOf(crewSnapshotFixture({ run: null })).runOn).toBe(false);
    expect(crewRunOn(null)).toBe(false);
  });
});

describe("crewBoardModel cards", () => {
  const fixture = crewSnapshotFixture();
  const withTask = (id: string, fields: Partial<CrewSnapshot["board"]["tasks"][number]>) =>
    crewSnapshotFixture({
      board: {
        tasks: fixture.board.tasks.map((task) => (task.id === id ? { ...task, ...fields } : task)),
      },
    });
  const cardOf = (snapshot: CrewSnapshot, number: number) =>
    boardOf(snapshot)
      .columns.flatMap((column) => column.cards)
      .find((card) => card.number === number);

  it.each([
    {
      name: "a working task wears its owner's thread: word, tone and the working face",
      snapshot: fixture,
      number: 12,
      card: {
        owner: { handle: "backend", name: "Backend", tint: "sky", face: "working" },
        status: { word: "Working", tone: "busy", pulse: true },
        detail: "+214 −12 · from a message",
      },
    },
    {
      name: "a fan-out task's card carries its note",
      snapshot: withTask("task-12", {
        note: "Also sent to @frontend. Your part is what is addressed to @backend.",
      }),
      number: 12,
      card: {
        owner: { handle: "backend", name: "Backend", tint: "sky", face: "working" },
        status: { word: "Working", tone: "busy", pulse: true },
        detail:
          "+214 \u221212 · from a message · Also sent to @frontend. Your part is what is addressed to @backend.",
      },
    },
    {
      name: "a working task whose owner's thread is idle has no status word to show",
      snapshot: withTask("task-13", { state: "working" }),
      number: 13,
      card: {
        owner: { handle: "frontend", name: "Frontend", tint: "coral", face: "idle" },
        status: null,
        detail: "+88 −30 · from you",
      },
    },
    {
      name: "a landing waiting on your tree",
      snapshot: fixture,
      number: 13,
      card: {
        owner: { handle: "frontend", name: "Frontend", tint: "coral", face: "idle" },
        status: { word: "Waits on your tree: src/ui/hud.ts", tone: "attention", pulse: false },
        detail: "+88 −30 · from you",
      },
    },
    {
      name: "a question replaces the change on the detail line",
      snapshot: fixture,
      number: 14,
      card: {
        owner: { handle: "erik", name: "Erik", tint: "amber", face: "idle" },
        status: { word: "Asks a question", tone: "attention", pulse: false },
        detail: "Pricing in CZK or EUR? · from lead",
      },
    },
    {
      name: "a queued task names the dependency it waits for",
      snapshot: fixture,
      number: 15,
      card: {
        owner: { handle: "frontend", name: "Frontend", tint: "coral", face: "idle" },
        status: { word: "Queued · after #12", tone: "off", pulse: false },
        detail: "from lead",
      },
    },
    {
      name: "a queued task with no dependency names the task its owner is on",
      snapshot: withTask("task-15", { dependsOn: [] }),
      number: 15,
      card: {
        owner: { handle: "frontend", name: "Frontend", tint: "coral", face: "idle" },
        status: { word: "Queued · waits for #13", tone: "off", pulse: false },
        detail: "from lead",
      },
    },
    {
      name: "a parked task says why it stopped",
      snapshot: fixture,
      number: 17,
      card: {
        owner: { handle: "erik", name: "Erik", tint: "amber", face: "idle" },
        status: { word: "Stopped: The check timed out twice", tone: "failed", pulse: false },
        detail: "from lead",
      },
    },
    {
      name: "a landed task shows its landing commit",
      snapshot: fixture,
      number: 11,
      card: {
        owner: { handle: "backend", name: "Backend", tint: "sky", face: "working" },
        status: { word: "Landed · not delivered", tone: "ok", pulse: false },
        detail: "a1b2c3d",
      },
    },
    {
      name: "a failed check leads the detail line",
      snapshot: withTask("task-13", {
        state: "rework",
        reason: "npm test fails",
        check: { state: "failed", output: "1 failed" },
      }),
      number: 13,
      card: {
        owner: { handle: "frontend", name: "Frontend", tint: "coral", face: "idle" },
        status: { word: "Rework: npm test fails", tone: "busy", pulse: true },
        detail: "Check failed · +88 −30 · from you",
      },
    },
    {
      name: "a ready task waiting for your Land",
      snapshot: withTask("task-13", { state: "ready", source: "lead" }),
      number: 13,
      card: {
        owner: { handle: "frontend", name: "Frontend", tint: "coral", face: "idle" },
        status: { word: "Ready to land", tone: "ok", pulse: false },
        detail: "+88 −30 · from lead",
      },
    },
    {
      name: "an owner no longer on the crew reads as its handle",
      snapshot: withTask("task-15", { owner: "gone" }),
      number: 15,
      card: {
        owner: { handle: "gone", name: "@gone", tint: null, face: "idle" },
        status: { word: "Queued · after #12", tone: "off", pulse: false },
        detail: "from lead",
      },
    },
  ])("$name", ({ snapshot, number, card }) => {
    const drawn = cardOf(snapshot, number);
    expect(drawn && { owner: drawn.owner, status: drawn.status, detail: drawn.detail }).toEqual(
      card,
    );
  });
});

describe("crewBoardModel plan", () => {
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
      name: "the lead's proposed tasks are one plan card, named by the plan's attention row",
      snapshot: fixture,
      plan: {
        title: "Plan · 1 task",
        sentence: "Lead proposes 1 task",
        rows: [{ taskId: "task-16", number: 16, title: "Rate-limit the public API", after: null }],
      },
    },
    {
      name: "a row that depends on another names it",
      snapshot: crewSnapshotFixture({
        board: { tasks: [...fixture.board.tasks, secondRow] },
      }),
      plan: {
        title: "Plan · 2 tasks",
        sentence: "Lead proposes 2 tasks",
        rows: [
          { taskId: "task-16", number: 16, title: "Rate-limit the public API", after: null },
          { taskId: "task-18", number: 18, title: "Document the rate limits", after: "after #16" },
        ],
      },
    },
    {
      name: "without the plan's attention row the card has no sentence",
      snapshot: crewSnapshotFixture({
        attention: fixture.attention.filter((row) => row.kind !== "plan"),
      }),
      plan: {
        title: "Plan · 1 task",
        sentence: null,
        rows: [{ taskId: "task-16", number: 16, title: "Rate-limit the public API", after: null }],
      },
    },
    {
      name: "nothing proposed: no plan card",
      snapshot: crewSnapshotFixture({
        board: { tasks: fixture.board.tasks.filter((task) => task.state !== "proposed") },
      }),
      plan: null,
    },
  ])("$name", ({ snapshot, plan }) => {
    const drawn = boardOf(snapshot).plan;
    expect(
      drawn && {
        title: drawn.title,
        sentence: drawn.sentence,
        rows: drawn.rows.map(({ taskId, number, title, after }) => ({
          taskId,
          number,
          title,
          after,
        })),
      },
    ).toEqual(plan);
  });

  it("is the plan the lead's chat draws too", () => {
    expect(crewPlanCard(fixture, viewOf(fixture))).toEqual(boardOf(fixture).plan);
  });

  it("draws each row's owner face", () => {
    expect(boardOf(fixture).plan?.rows[0]?.owner).toEqual({
      handle: "backend",
      name: "Backend",
      tint: "sky",
      face: "working",
    });
  });
});

describe("crewTaskSheet", () => {
  const fixture = crewSnapshotFixture();
  const sheetOf = (snapshot: CrewSnapshot, taskId: string) =>
    crewTaskSheet(snapshot, viewOf(snapshot), taskId);

  it("reads a landed task in full", () => {
    const sheet = sheetOf(fixture, "task-11");
    expect(sheet && { ...sheet, actions: undefined }).toEqual({
      taskId: "task-11",
      heading: "#11 Health endpoint for the load balancer",
      title: "Health endpoint for the load balancer",
      owner: { handle: "backend", name: "Backend", tint: "sky", face: "working" },
      status: { word: "Landed · not delivered", tone: "ok", pulse: false },
      source: "from lead",
      brief: "Health endpoint for the load balancer",
      doneWhen: "GET /health answers 200",
      note: null,
      attempts: "Attempt 1",
      report: "Added GET /health with a database ping.",
      check: { word: "Check passed", tone: "ok", output: "Tests  46 passed (46)" },
      review: "Lead: Accepted",
      changes: "+35 \u22120",
      landedCommit: "a1b2c3d",
      ownerThreadId: "thread-crew-backend-2",
      editable: false,
      actions: undefined,
    });
  });

  it.each([
    {
      name: "a task not started yet, with nothing to report, after its dependency",
      taskId: "task-15",
      fields: {},
      read: {
        doneWhen: "The camera follows the player; npm test passes",
        attempts: "Not started · after #12",
        report: null,
        check: null,
        review: null,
        changes: null,
        landedCommit: null,
        editable: true,
      },
    },
    {
      name: "a task not started yet, behind the task its owner is on",
      taskId: "task-15",
      fields: { dependsOn: [] },
      read: {
        doneWhen: "The camera follows the player; npm test passes",
        attempts: "Not started · waits for #13",
        report: null,
        check: null,
        review: null,
        changes: null,
        landedCommit: null,
        editable: true,
      },
    },
    {
      name: "an empty done-when is left out",
      taskId: "task-12",
      fields: {},
      read: {
        doneWhen: null,
        attempts: "Attempt 1",
        report: null,
        check: null,
        review: null,
        changes: "+214 \u221212",
        landedCommit: null,
        editable: true,
      },
    },
    {
      name: "your own rejection with its note, and a failed check",
      taskId: "task-13",
      fields: {
        state: "rework",
        attempts: 2,
        check: { state: "failed", output: "FAIL hud.test.ts" },
        review: { verdict: "reject", note: "The counter flickers.", by: null },
      },
      read: {
        doneWhen: "The HUD shows ammo; npm test passes",
        attempts: "Attempt 2",
        report: "Ammo counter in the HUD, updated on fire and reload.",
        check: { word: "Check failed", tone: "failed", output: "FAIL hud.test.ts" },
        review: "You: Rejected — The counter flickers.",
        changes: "+88 \u221230",
        landedCommit: null,
        editable: true,
      },
    },
  ] as const)("$name", ({ taskId, fields, read }) => {
    const snapshot = crewSnapshotFixture({
      board: {
        tasks: fixture.board.tasks.map((task) =>
          task.id === taskId ? { ...task, ...fields } : task,
        ),
      },
    });
    const sheet = sheetOf(snapshot, taskId);
    expect(
      sheet && {
        doneWhen: sheet.doneWhen,
        attempts: sheet.attempts,
        report: sheet.report,
        check: sheet.check,
        review: sheet.review,
        changes: sheet.changes,
        landedCommit: sheet.landedCommit,
        editable: sheet.editable,
      },
    ).toEqual(read);
  });

  it("reads a fan-out task's note", () => {
    const note = "Also sent to @frontend. Your part is what is addressed to @backend.";
    const snapshot = crewSnapshotFixture({
      board: {
        tasks: fixture.board.tasks.map((task) =>
          task.id === "task-12" ? { ...task, note } : task,
        ),
      },
    });
    expect(sheetOf(snapshot, "task-12")?.note).toBe(note);
  });

  it("is null for a task the board does not show", () => {
    expect(sheetOf(fixture, "task-9")).toBeNull();
    expect(sheetOf(fixture, "task-404")).toBeNull();
  });
});

describe("crewTaskSheet actions", () => {
  const fixture = crewSnapshotFixture();
  const conflicted = crewSnapshotFixture({
    crewmates: fixture.crewmates.map((crewmate) =>
      crewmate.handle === "backend" && crewmate.lane !== null
        ? { ...crewmate, lane: { ...crewmate.lane, state: "conflicts" } }
        : crewmate,
    ),
  });
  const withTask = (id: string, fields: Partial<CrewSnapshot["board"]["tasks"][number]>) =>
    crewSnapshotFixture({
      board: {
        tasks: fixture.board.tasks.map((task) => (task.id === id ? { ...task, ...fields } : task)),
      },
    });
  const actionsOf = (snapshot: CrewSnapshot, taskId: string) =>
    crewTaskSheet(snapshot, viewOf(snapshot), taskId)?.actions.map(({ label, tone, command }) => ({
      label,
      tone,
      command,
    }));
  const discard = (taskId: string) => ({
    label: "Discard",
    tone: "outline",
    command: { _tag: "discard", taskId },
  });

  it.each([
    {
      name: "a ready task lands",
      snapshot: withTask("task-13", { state: "ready" }),
      taskId: "task-13",
      actions: [
        { label: "Land", tone: "primary", command: { _tag: "land", taskId: "task-13" } },
        discard("task-13"),
      ],
    },
    {
      name: "a working task with a change lands now, before its crewmate reports",
      snapshot: fixture,
      taskId: "task-12",
      actions: [
        { label: "Land now", tone: "secondary", command: { _tag: "landNow", taskId: "task-12" } },
        discard("task-12"),
      ],
    },
    {
      name: "a working task with no change yet has nothing to land",
      snapshot: withTask("task-12", { diffStat: null }),
      taskId: "task-12",
      actions: [discard("task-12")],
    },
    {
      name: "a copy in conflict asks its crewmate to resolve instead of landing",
      snapshot: conflicted,
      taskId: "task-12",
      actions: [
        {
          label: "Ask Backend to resolve",
          tone: "secondary",
          command: { _tag: "askResolve", taskId: "task-12" },
        },
        discard("task-12"),
      ],
    },
    {
      name: "a failed check asks its crewmate to fix",
      snapshot: withTask("task-13", {
        state: "rework",
        check: { state: "failed", output: "FAIL hud.test.ts" },
      }),
      taskId: "task-13",
      actions: [
        {
          label: "Ask Frontend to fix",
          tone: "secondary",
          command: { _tag: "askFix", taskId: "task-13" },
        },
        discard("task-13"),
      ],
    },
    {
      name: "a queued task can only be discarded",
      snapshot: fixture,
      taskId: "task-15",
      actions: [discard("task-15")],
    },
    {
      name: "a landed task has no presses",
      snapshot: fixture,
      taskId: "task-11",
      actions: [],
    },
  ] as const)("$name", ({ snapshot, taskId, actions }) => {
    expect(actionsOf(snapshot, taskId)).toEqual(actions);
  });
});

describe("New task", () => {
  const fixture = crewSnapshotFixture();
  const view = viewOf(fixture);
  const draft = {
    owner: "backend",
    title: "  Sort items by price ",
    brief: " Sort /api/items by price, cheapest first. ",
    doneWhen: "",
    dependsOn: ["task-12"],
  };

  it("offers every crewmate but the lead as an owner", () => {
    expect(crewTaskOwners(view).map((owner) => owner.handle)).toEqual([
      "backend",
      "frontend",
      "erik",
    ]);
  });

  it("offers every task on the board that has not landed as a dependency", () => {
    expect(crewDependencyOptions(view)).toEqual([
      { taskId: "task-12", label: "#12 Add pagination to /api/items" },
      { taskId: "task-13", label: "#13 HUD shows the ammo count" },
      { taskId: "task-14", label: "#14 Write the business plan" },
      { taskId: "task-15", label: "#15 Camera rig follows the player" },
      { taskId: "task-16", label: "#16 Rate-limit the public API" },
      { taskId: "task-17", label: "#17 Cost table for the plan" },
    ]);
  });

  it.each([
    {
      name: "a complete draft creates the task, trimmed",
      draft,
      command: {
        _tag: "taskCreate",
        owner: "backend",
        title: "Sort items by price",
        brief: "Sort /api/items by price, cheapest first.",
        doneWhen: "",
        dependsOn: ["task-12"],
      },
    },
    { name: "no owner yet", draft: { ...draft, owner: null }, command: null },
    { name: "a blank title", draft: { ...draft, title: "   " }, command: null },
  ] as const)("$name", ({ draft, command }) => {
    expect(crewNewTaskCommand(draft)).toEqual(command);
  });
});

describe("crewTaskEditCommand", () => {
  const task = crewSnapshotFixture().board.tasks.find((candidate) => candidate.id === "task-13")!;
  const unchanged = { title: task.title, brief: task.brief, doneWhen: task.doneWhen };

  it.each([
    { name: "nothing changed", draft: unchanged, command: null },
    {
      name: "only the fields that changed travel",
      draft: { ...unchanged, title: " HUD shows ammo and health ", doneWhen: "npm test passes" },
      command: {
        _tag: "taskEdit",
        taskId: "task-13",
        title: "HUD shows ammo and health",
        doneWhen: "npm test passes",
      },
    },
    { name: "a blank title is no edit", draft: { ...unchanged, title: " " }, command: null },
  ] as const)("$name", ({ draft, command }) => {
    expect(crewTaskEditCommand(task, draft)).toEqual(command);
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
      name: "a row's removal discards only that row",
      tag: "planDiscard",
      taskIds: ["task-18"],
      command: { _tag: "planDiscard", taskIds: ["task-18"] },
    },
    { name: "no rows, no command", tag: "planAccept", taskIds: [], command: null },
  ] as const)("$name", ({ tag, taskIds, command }) => {
    expect(crewPlanCommand(tag, taskIds)).toEqual(command);
  });
});
