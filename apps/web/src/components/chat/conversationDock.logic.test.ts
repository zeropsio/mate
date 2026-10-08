import { projectLatestUsagePause } from "@t3tools/client-runtime/data";
import type {
  AgentPanelModel,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { assistant, at, operation, tool, user } from "./conversationFixtures";
import {
  bandKeys,
  bandSeenNext,
  type BandSeen,
  deriveDock,
  endedSince,
  withEndingsHeld,
  dockHelpers,
  foldBackgroundTasks,
  type DockModel,
} from "./conversationDock.logic";

function agent(id: string, status: RuntimeSubagent["status"], title: string): RuntimeSubagent {
  return {
    id,
    kind: "subagent",
    title,
    role: "general-purpose",
    model: "claude-opus-5-5",
    effort: "max",
    status,
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    prompt: null,
    toolUseId: null,
    spawnedBy: null,
    liveCall: null,
    firstSeenAt: at(1),
    startedAt: at(1),
    completedAt: status === "completed" ? at(9) : null,
    updatedAt: at(9),
  };
}

const panel = (agents: RuntimeSubagent[]): AgentPanelModel => ({
  ...emptyAgentPanelModel(),
  directAgents: agents,
  hasAgents: agents.length > 0,
});

/** A stand-up step as its report left it. */
const standupStep = (label: string, state: "done" | "running") => ({
  id: label,
  label,
  state,
  stateLabel: state === "done" ? "Done" : "Running",
});

/** A stand-up whose call returned while a service of its own still builds, as the builder settles it. */
const standupRunningOn = (id: string, minute: number) =>
  operation(id, "t1", minute, {
    kind: "standup",
    phase: "done",
    returnedAt: at(minute, 5),
    steps: [standupStep("appdev", "done"), standupStep("apidev", "running")],
  });

describe("dockHelpers", () => {
  it("names each helper by its task, never its model, with its state in words", () => {
    expect(
      dockHelpers(
        panel([
          agent("h1", "running", "titan models"),
          agent("h2", "completed", "Fire and destruction"),
        ]),
      ).map(({ id, title, tone, word }) => ({ id, title, tone, word })),
    ).toEqual([
      { id: "h1", title: "Titan models", tone: "busy", word: "Working" },
      { id: "h2", title: "Fire and destruction", tone: "ok", word: "Done" },
    ]);
  });

  it.each([
    {
      name: "a working helper says what it does now",
      helper: { ...agent("h1", "running", "tests"), progress: "Running the unit tests" },
      word: "Running the unit tests",
    },
    {
      name: "a working helper that says nothing yet is working",
      helper: agent("h1", "running", "tests"),
      word: "Working",
    },
    {
      name: "a helper waiting for the person says so, whatever it did last",
      helper: { ...agent("h1", "waiting", "tests"), progress: "Running the unit tests" },
      word: "Waiting for you",
    },
    {
      name: "a settled helper says how it ended",
      helper: { ...agent("h1", "completed", "tests"), progress: "Running the unit tests" },
      word: "Done",
    },
  ])("$name", ({ helper, word }) => {
    expect(dockHelpers(panel([helper])).map((row) => row.word)).toEqual([word]);
  });

  it.each([
    {
      name: "a helper an earlier turn finished is that turn's history",
      helper: { ...agent("h1", "completed", "old work"), startedAt: at(1), completedAt: at(2) },
      shown: false,
    },
    {
      name: "a helper from before that still works is shown",
      helper: { ...agent("h1", "running", "long work"), startedAt: at(1) },
      shown: true,
    },
    {
      name: "a helper the running turn started is shown, done or not",
      helper: { ...agent("h1", "completed", "new work"), startedAt: at(6), completedAt: at(7) },
      shown: true,
    },
  ])("$name", ({ helper, shown }) => {
    expect(dockHelpers(panel([helper]), at(5)).map(({ id }) => id)).toEqual(shown ? ["h1"] : []);
  });
});

function task(
  kind: "task.started" | "task.progress" | "task.completed",
  taskId: string,
  minute: number,
  payload: Record<string, unknown> = {},
  turnId: string | null = "t1",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`${kind}:${taskId}:${minute}`),
    tone: payload.status === "failed" ? "error" : "info",
    kind,
    summary: kind,
    payload: { taskId, agentKind: "background", taskType: "local_bash", ...payload },
    turnId: turnId === null ? null : TurnId.make(turnId),
    createdAt: at(minute),
  };
}

/** A command's call: its start, or its end once it returned. */
function call(
  kind: "tool.started" | "tool.completed",
  toolCallId: string,
  minute: number,
  second = 0,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`${kind}:${toolCallId}:${minute}:${second}`),
    tone: "tool",
    kind,
    summary: "Command run",
    payload: {
      itemType: "command_execution",
      toolCallId,
      status: kind === "tool.completed" ? "completed" : "inProgress",
    },
    turnId: TurnId.make("t1"),
    createdAt: new Date(Date.parse(at(minute)) + second * 1000).toISOString(),
  };
}

describe("foldBackgroundTasks", () => {
  // Claude Code tracks any command that runs past a few seconds as a task
  // named by the command's description. The Mate waits on such a command:
  // it is a step of the run, never a background task (27 of 27 on one run).
  it.each([
    {
      name: "a command the Mate waits on, while it runs",
      activities: [
        call("tool.started", "toolu_1", 1),
        task("task.started", "b1", 1, { detail: "Screenshot the home page", toolUseId: "toolu_1" }),
      ],
    },
    {
      name: "a command the Mate waited on, once it returned with its task",
      activities: [
        call("tool.started", "toolu_1", 1),
        task("task.started", "b1", 1, { detail: "Screenshot the home page", toolUseId: "toolu_1" }),
        call("tool.completed", "toolu_1", 2),
        task("task.completed", "b1", 2, { status: "completed", toolUseId: "toolu_1" }),
      ],
    },
  ])("leaves out $name", ({ activities }) => {
    expect(foldBackgroundTasks(activities)).toEqual([]);
  });

  it.each([
    {
      name: "running on after its call returned",
      activities: [
        call("tool.started", "toolu_2", 1),
        task("task.started", "b2", 1, { detail: "Start the dev server", toolUseId: "toolu_2" }),
        call("tool.completed", "toolu_2", 1, 2),
      ],
      tasks: [{ id: "b2", title: "Start the dev server", state: "running", endedAt: null }],
    },
    {
      name: "done long after its call returned",
      activities: [
        call("tool.started", "toolu_2", 1),
        task("task.started", "b2", 1, { detail: "Run the suite", toolUseId: "toolu_2" }),
        call("tool.completed", "toolu_2", 1, 2),
        task("task.completed", "b2", 9, { status: "completed", toolUseId: "toolu_2" }),
      ],
      tasks: [{ id: "b2", title: "Run the suite", state: "done", endedAt: at(9) }],
    },
  ])("keeps a command sent to the background: $name", ({ activities, tasks }) => {
    expect(
      foldBackgroundTasks(activities).map(({ id, title, state, endedAt }) => ({
        id,
        title,
        state,
        endedAt,
      })),
    ).toEqual(tasks);
  });

  it.each([
    {
      name: "a shell running in the background, by what it was asked to do",
      activities: [task("task.started", "b1", 1, { detail: "Typecheck the server" })],
      tasks: [{ id: "b1", title: "Typecheck the server", state: "running", endedAt: null }],
    },
    {
      name: "one that finished, failed or was stopped says so, when it ended",
      activities: [
        task("task.started", "b1", 1, { detail: "Typecheck" }),
        task("task.started", "b2", 1, { detail: "Run the tests" }),
        task("task.started", "b3", 1, { detail: "Tail the log" }),
        task("task.completed", "b1", 2, { status: "completed", title: "Typecheck" }),
        task("task.completed", "b2", 3, { status: "failed", title: "Run the tests" }),
        task("task.completed", "b3", 4, { status: "stopped" }),
      ],
      tasks: [
        { id: "b1", title: "Typecheck", state: "done", endedAt: at(2) },
        { id: "b2", title: "Run the tests", state: "failed", endedAt: at(3) },
        { id: "b3", title: "Tail the log", state: "stopped", endedAt: at(4) },
      ],
    },
    {
      name: "helpers and a helper's own shells are the helpers panel's, plan bookkeeping no one's",
      activities: [
        task("task.started", "a1", 1, { agentKind: "agent", taskType: "subagent" }),
        task("task.started", "a2", 1, { agentId: "helper-1" }),
        task("task.started", "p1", 1, { taskType: "plan" }),
      ],
      tasks: [],
    },
    {
      name: "a watch loop watches; a shell runs once",
      activities: [
        task("task.started", "m1", 1, { detail: "Watch the PR", taskType: "monitor" }),
        task("task.started", "b1", 1, { detail: "Typecheck" }),
      ],
      tasks: [
        { id: "m1", title: "Watch the PR", state: "running", endedAt: null, watch: true },
        { id: "b1", title: "Typecheck", state: "running", endedAt: null, watch: false },
      ],
    },
    {
      name: "a task seen only at its end still counts, named by its title",
      activities: [task("task.completed", "b1", 2, { status: "completed", title: "Build" })],
      tasks: [{ id: "b1", title: "Build", state: "done", endedAt: at(2) }],
    },
  ])("$name", ({ activities, tasks }) => {
    expect(
      foldBackgroundTasks(activities).map(({ id, title, state, endedAt, watch }) => ({
        id,
        title,
        state,
        endedAt,
        ...(tasks.some((expected) => "watch" in expected) ? { watch } : {}),
      })),
    ).toEqual(tasks);
  });
});

describe("deriveDock", () => {
  const base = {
    timelineEntries: [],
    isWorking: true,
    runningTurnId: "t1",
    agentPanelModel: emptyAgentPanelModel(),
    plan: null,
    pause: null,
  };

  // Run 9 and Bodhi: a bar of running tasks only read full beside "0/3", and
  // its count could fall. While one runs, the bar holds what this turn sent
  // to the background and what runs or ended during it — never an earlier
  // turn's finished task, whose count would fall when its sibling ended.
  it("holds, while one runs, this turn's background tasks and any from before still running", () => {
    const dock = deriveDock({
      ...base,
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "old-done", 0, { detail: "Old" }, "t0"),
        task("task.completed", "old-done", 1, { status: "completed" }, "t0"),
        task("task.started", "old-running", 0, { detail: "Watch" }, "t0"),
        task("task.started", "b1", 2, { detail: "Typecheck" }),
        task("task.completed", "b1", 3, { status: "failed" }),
        task("task.started", "b0", 2, { detail: "Lint" }),
        task("task.completed", "b0", 3, { status: "completed" }),
        task("task.started", "b2", 4, { detail: "Test" }),
      ]),
    });
    expect(dock?.background).toMatchObject({ running: 2, done: 1, failed: 1 });
    expect(dock?.background?.tasks.map((item) => item.id)).toEqual([
      "old-running",
      "b1",
      "b0",
      "b2",
    ]);
    expect(dock?.afterTurn).toBeNull();
  });

  // Review of pass 39: the band kept a job lost to a restart "running" while
  // its card said it didn't report back. One judgement (`jobLost`) for both.
  it.each([
    { name: "held live", held: ["b1"], running: 1 },
    { name: "held no longer: lost, not in the band", held: [] as string[], running: 0 },
    { name: "only a newer session's job held", held: ["b9"], running: 1 },
  ])("drops a job the server holds no longer: $name", ({ held, running }) => {
    const dock = deriveDock({
      ...base,
      isWorking: false,
      runningTurnId: null,
      backgroundLiveness: "monitoring",
      liveJobs: { ids: new Set(held) },
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "b1", 2, { detail: "Soak" }, "t0"),
        ...(held.includes("b9") ? [task("task.started", "b9", 3, { detail: "Newer" })] : []),
      ]),
    });
    expect(
      dock?.background?.tasks.filter((item) => item.id === "b1" && item.state === "running")
        .length ?? 0,
    ).toBe(held.includes("b1") ? 1 : 0);
    expect(dock?.background?.running ?? 0).toBe(running);
  });

  // Review of pass 39: "1/3" fell to "1/2" as an earlier turn's sibling ended,
  // and with no turn start known an earlier task that ended mid-turn left.
  it.each([
    { name: "the turn's start known", turnStartedAt: at(2) as string | null, entries: [] },
    {
      name: "the turn's start read off its first entry",
      turnStartedAt: null,
      entries: [operation("o1", "t1", 2, { kind: "deploy", phase: "done" })],
    },
  ])("never lets a count fall as earlier turns' tasks end: $name", ({ turnStartedAt, entries }) => {
    const steps = [
      task("task.started", "a1", 0, { detail: "Old one" }, "t0"),
      task("task.started", "a2", 0, { detail: "Old two" }, "t0"),
      task("task.completed", "a1", 1, { status: "completed" }, "t0"),
      task("task.started", "c1", 3, { detail: "New" }),
      task("task.completed", "a2", 4, { status: "completed" }, "t0"),
    ];
    const counts = steps.map((_, index) => {
      const background = deriveDock({
        ...base,
        turnStartedAt,
        timelineEntries: entries,
        backgroundTasks: foldBackgroundTasks(steps.slice(0, index + 1)),
      })?.background;
      return background == null
        ? null
        : [background.tasks.length - background.running, background.tasks.length];
    });
    expect(counts).toEqual([
      [0, 1],
      [0, 2],
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it("counts only up as a turn's background tasks finish", () => {
    const steps = [
      task("task.started", "b1", 2, { detail: "Soak" }),
      task("task.started", "b2", 2, { detail: "Outdated" }),
      task("task.started", "b3", 2, { detail: "Fails" }),
      task("task.completed", "b2", 3, { status: "completed" }),
      task("task.completed", "b3", 4, { status: "failed" }),
    ];
    const finished = steps.map((_, index) => {
      const background = deriveDock({
        ...base,
        backgroundTasks: foldBackgroundTasks(steps.slice(0, index + 1)),
      })?.background;
      return background === null || background === undefined
        ? null
        : [background.tasks.length, background.done + background.failed];
    });
    expect(finished).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 1],
      [3, 2],
    ]);
  });

  it("stays after the turn while work runs on in the background: what still runs, and nothing else", () => {
    const dock = deriveDock({
      ...base,
      isWorking: false,
      runningTurnId: null,
      backgroundLiveness: "working",
      agentPanelModel: panel([agent("h1", "running", "Long work"), agent("h2", "completed", "b")]),
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "b0", 1, { detail: "Build" }, "t0"),
        task("task.completed", "b0", 2, { status: "completed" }, "t0"),
        task("task.started", "b1", 2, { detail: "Typecheck" }),
        task("task.completed", "b1", 3, { status: "completed" }),
        task("task.started", "b2", 4, { detail: "Watch the PR", taskType: "monitor" }),
      ]),
    });
    expect(dock).toMatchObject({
      afterTurn: "working",
      operations: [],
      tasks: null,
      helpers: { working: 1, done: 0 },
      // After the turn its card's line is the record: the band holds only what runs.
      background: { running: 1, done: 0, failed: 0 },
    });
    expect(dock?.background?.tasks.map((item) => item.id)).toEqual(["b2"]);
  });

  // A bar stands for what runs without the Mate waiting on it (pass 35): a
  // pipeline whose call returned and runs on. One it still waits on is the
  // live slot's; a finished or failed one leaves — its line stays in the
  // record and what is still broken goes to the result.
  it("holds the running turn's pipelines whose call returned, not one it waits on, a finished or failed one, quick calls or older turns", () => {
    const dock = deriveDock({
      ...base,
      timelineEntries: [
        operation("d0", "t1", 0, { kind: "deploy", phase: "done" }),
        operation("d1", "t1", 1, { kind: "deploy", phase: "running" }),
        operation("d3", "t1", 1, { kind: "deploy", phase: "failed" }),
        standupRunningOn("s1", 1),
        operation("s2", "t1", 1, { kind: "standup", phase: "running" }),
        operation("s3", "t1", 1, {
          kind: "standup",
          phase: "done",
          returnedAt: at(1, 5),
          steps: [standupStep("appdev", "done")],
        }),
        operation("v1", "t1", 2, { kind: "verify", phase: "running", returnedAt: at(2, 5) }),
        operation("d2", "t0", 2, { kind: "deploy", phase: "running", returnedAt: at(2, 5) }),
        // A session whose follow-up call the Mate waits on is the slot's (D2).
        operation("bs1", "t1", 2, {
          kind: "bootstrap",
          phase: "running",
          returnedAt: at(2, 5),
          openedAt: at(3, 0),
        }),
        operation("bs2", "t1", 2, { kind: "bootstrap", phase: "running", returnedAt: at(2, 5) }),
      ],
    });
    expect(dock?.operations.map((op) => op.key)).toEqual(["op:s1", "op:bs2"]);
  });

  // The stand-up's report froze as its call returned; the store's reading of
  // its services says when its builds are done.
  it("lets a stand-up whose builds the store reads as done leave the band", () => {
    const entries = [standupRunningOn("s1", 1)];
    const reading = deriveDock({ ...base, timelineEntries: entries });
    expect(reading?.operations.map((op) => op.key)).toEqual(["op:s1"]);
    const done = deriveDock({
      ...base,
      timelineEntries: entries,
      standupsDone: new Set(["op:s1"]),
    });
    expect(done?.operations ?? []).toEqual([]);
    expect(endedSince(bandKeys(reading), done)).toEqual(["op:s1"]);
  });

  // A bar the person watched run shows how it ended a moment, then leaves
  // (pass 35): what ended is the band's to hold, never the dock's to keep.
  it("says what the band drew running that has ended since, and draws it as it ended while held", () => {
    const running = deriveDock({
      ...base,
      timelineEntries: [standupRunningOn("s1", 1)],
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "b1", 2, { detail: "Smoke tests" }),
      ]),
    });
    expect([...bandKeys(running)]).toEqual(["op:s1", "task:b1"]);
    const ended = deriveDock({
      ...base,
      timelineEntries: [
        operation("s1", "t1", 1, {
          kind: "standup",
          phase: "done",
          returnedAt: at(1, 5),
          steps: [standupStep("appdev", "done")],
        }),
      ],
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "b1", 2, { detail: "Smoke tests" }),
        task("task.completed", "b1", 3, { status: "failed" }),
      ]),
    });
    expect(ended?.operations).toEqual([]);
    expect(ended?.background).toBeNull();
    expect(endedSince(bandKeys(running), ended)).toEqual(["op:s1", "task:b1"]);
    const held = withEndingsHeld(ended, new Set(["op:s1", "task:b1"]));
    expect(held?.operations.map((op) => [op.key, op.phase])).toEqual([["op:s1", "done"]]);
    expect(held?.background).toMatchObject({ running: 0, failed: 1 });
    expect(withEndingsHeld(ended, new Set())).toBe(ended);
  });

  it("drops the helpers' bar once none works, and the task list's once all is done", () => {
    const dock = deriveDock({
      ...base,
      agentPanelModel: panel([agent("h1", "completed", "a"), agent("h2", "completed", "b")]),
      plan: {
        createdAt: at(0),
        turnId: TurnId.make("t1"),
        steps: [
          { step: "Wire the shields", status: "completed" },
          { step: "Scale the titans", status: "completed" },
        ],
      },
    });
    // Ended, they are the band's to hold a moment (`withEndingsHeld`), not its bars.
    expect(dock?.helpers ?? null).toBeNull();
    expect(dock?.tasks ?? null).toBeNull();
  });

  it("gives each service of a batch deploy its own status bar", () => {
    const dock = deriveDock({
      ...base,
      timelineEntries: [
        operation("d1", "t1", 1, {
          kind: "deploy",
          batch: true,
          phase: "running",
          returnedAt: at(1, 5),
          subject: "apistage, webstage",
          steps: [
            { id: "apistage", label: "apistage", state: "running", stateLabel: "Running" },
            {
              id: "webstage",
              label: "webstage",
              state: "queued",
              stateLabel: "Waiting",
            },
          ],
        }),
      ],
    });
    expect(dock?.operations.map((op) => [op.key, op.subject])).toEqual([
      ["op:d1:apistage", "apistage"],
      ["op:d1:webstage", "webstage"],
    ]);
  });

  it("counts helpers by state", () => {
    const dock = deriveDock({
      ...base,
      agentPanelModel: panel([
        agent("h1", "running", "a"),
        agent("h2", "completed", "b"),
        agent("h3", "failed", "c"),
        agent("h4", "waiting", "d"),
      ]),
    });
    expect(dock?.helpers).toMatchObject({ working: 2, done: 1, failed: 1 });
  });

  it("shows the running turn's task list with its current step", () => {
    const dock = deriveDock({
      ...base,
      plan: {
        createdAt: at(0),
        turnId: TurnId.make("t1"),
        steps: [
          { step: "Wire the shields", status: "completed" },
          { step: "Scale the titans", status: "inProgress" },
          { step: "Knight enemies", status: "pending" },
        ],
      },
    });
    expect(dock?.tasks).toMatchObject({ done: 1, current: "Scale the titans" });
  });

  it("is empty when nothing runs, and shows a pause only once the turn stopped", () => {
    expect(deriveDock(base)).toBeNull();
    expect(deriveDock({ ...base, pause: { resetsAt: at(20) } })).toBeNull();
    expect(deriveDock({ ...base, isWorking: false, pause: { resetsAt: at(20) } })).toEqual({
      operations: [],
      helpers: null,
      tasks: null,
      background: null,
      afterTurn: null,
      pause: { resetsAt: at(20) },
    });
  });
});

describe("latestUsagePause", () => {
  const limit = "You've hit your session limit · resets 9:20pm (UTC)";
  it.each([
    ["the limit is the latest word", [user("m0", 0), assistant("a1", "t1", 48, limit)], true],
    ["the person asked again since", [assistant("a1", "t1", 48, limit), user("m1", 50)], true],
    ["the Mate worked since", [assistant("a1", "t1", 48, limit), tool("w1", "t2", 55)], false],
    ["an ordinary answer", [assistant("a1", "t1", 48, "Deployed.")], false],
    ["nothing yet", [], false],
  ])("%s", (_label, entries, paused) => {
    expect(projectLatestUsagePause(entries) !== null).toBe(paused);
  });
});

// A resync brings what ended while nobody watched: the band lets it go
// without holding its ending (pass 35).
describe("bandSeenNext", () => {
  const base = {
    timelineEntries: [],
    isWorking: true,
    runningTurnId: "t1",
    agentPanelModel: emptyAgentPanelModel(),
    plan: null,
    pause: null,
  };
  const runningDock = () =>
    deriveDock({
      ...base,
      timelineEntries: [],
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "b1", 2, { detail: "Smoke tests" }),
      ]),
    });
  const endedDock = () =>
    deriveDock({
      ...base,
      timelineEntries: [],
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "b1", 2, { detail: "Smoke tests" }),
        task("task.completed", "b1", 3, { status: "failed" }),
      ]),
    });
  it.each([
    { name: "watched: the ending is held", syncing: false, held: ["task:b1"] },
    { name: "a resync: nothing is held", syncing: true, held: [] },
  ])("$name", ({ syncing, held }) => {
    const before: BandSeen = {
      running: bandKeys(runningDock()),
      held: new Set<string>(),
      ends: new Map<string, number>(),
    };
    const next = bandSeenNext(before, endedDock(), syncing);
    expect([...next.held]).toEqual(held);
    expect([...next.running]).toEqual([]);
  });

  // A bar that runs again and ends again while its first ending is still
  // held shows its second ending its whole time (E15): each ending counts.
  it("counts each ending of a bar, so a second one restarts its hold", () => {
    let seen: BandSeen = {
      running: bandKeys(runningDock()),
      held: new Set<string>(),
      ends: new Map<string, number>(),
    };
    seen = bandSeenNext(seen, endedDock(), false);
    expect(seen.ends.get("task:b1")).toBe(1);
    seen = bandSeenNext(seen, runningDock(), false);
    seen = bandSeenNext(seen, endedDock(), false);
    expect([...seen.held]).toEqual(["task:b1"]);
    expect(seen.ends.get("task:b1")).toBe(2);
  });
});

// Each bar the band drew running shows how it ended a moment (pass 35): a
// batch deploy's row per service, the helpers, the to-do list, and a
// background task started before this turn.
describe("the band's endings", () => {
  const base = {
    timelineEntries: [],
    isWorking: true,
    runningTurnId: "t1",
    turnStartedAt: at(0),
    agentPanelModel: emptyAgentPanelModel(),
    plan: null,
    pause: null,
  };
  const batch = (phase: "running" | "done", apistage: "running" | "done") =>
    operation("b1", "t1", 1, {
      kind: "deploy",
      batch: true,
      phase,
      returnedAt: at(1, 5),
      steps: [
        { id: "apidev", label: "apidev", state: "done", stateLabel: "Done" },
        { id: "apistage", label: "apistage", state: apistage, stateLabel: apistage },
      ],
    });
  const plan = (last: "inProgress" | "completed") => ({
    createdAt: at(0),
    turnId: TurnId.make("t1"),
    steps: [
      { step: "Wire the shields", status: "completed" as const },
      { step: "Scale the titans", status: last },
    ],
  });
  it.each([
    {
      name: "a batch deploy's service whose own step ended while the batch runs on",
      before: { ...base, timelineEntries: [batch("running", "running")] },
      after: { ...base, timelineEntries: [batch("running", "done")] },
      ended: ["op:b1:apistage"],
      shows: (dock: DockModel | null) => dock?.operations.map((op) => `${op.key} ${op.phase}`),
      shown: ["op:b1:apistage done"],
    },
    {
      name: "a whole batch deploy that ended: a row per service",
      before: { ...base, timelineEntries: [batch("running", "running")] },
      after: { ...base, timelineEntries: [batch("done", "done")] },
      ended: ["op:b1:apistage"],
      shows: (dock: DockModel | null) => dock?.operations.map((op) => `${op.key} ${op.phase}`),
      shown: ["op:b1:apistage done"],
    },
    {
      name: "the helpers, the last one done",
      before: { ...base, agentPanelModel: panel([agent("h1", "running", "Audit")]) },
      after: { ...base, agentPanelModel: panel([agent("h1", "completed", "Audit")]) },
      ended: ["helpers"],
      shows: (dock: DockModel | null) => dock?.helpers?.rows.map((row) => row.word),
      shown: ["Done"],
    },
    {
      name: "the to-do list, its last step done",
      before: { ...base, plan: plan("inProgress") },
      after: { ...base, plan: plan("completed") },
      ended: ["tasks"],
      shows: (dock: DockModel | null) => [dock?.tasks?.done ?? null],
      shown: [2],
    },
    {
      name: "a background task started before this turn",
      before: {
        ...base,
        backgroundTasks: foldBackgroundTasks([
          task("task.started", "b0", 0, { detail: "Watch the logs" }, "t0"),
        ]),
      },
      after: {
        ...base,
        backgroundTasks: foldBackgroundTasks([
          task("task.started", "b0", 0, { detail: "Watch the logs" }, "t0"),
          task("task.completed", "b0", 3, { status: "failed" }, "t0"),
        ]),
      },
      ended: ["task:b0"],
      shows: (dock: DockModel | null) => dock?.background?.tasks.map((item) => item.state),
      shown: ["failed"],
    },
  ])("holds $name", ({ before, after, ended, shows, shown }) => {
    const running = deriveDock(before);
    const now = deriveDock(after);
    expect(endedSince(bandKeys(running), now)).toEqual(ended);
    expect(shows(withEndingsHeld(now, new Set(ended)))).toEqual(shown);
  });
});
