import type {
  AgentPanelModel,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { assistant, at, operation, tool, user } from "./conversationFixtures";
import {
  deriveDock,
  dockHelpers,
  foldBackgroundTasks,
  latestUsagePause,
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

describe("foldBackgroundTasks", () => {
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

  it("holds the running turn's background tasks, and any still running from before", () => {
    const dock = deriveDock({
      ...base,
      backgroundTasks: foldBackgroundTasks([
        task("task.started", "old-done", 0, { detail: "Old" }, "t0"),
        task("task.completed", "old-done", 1, { status: "completed" }, "t0"),
        task("task.started", "old-running", 0, { detail: "Watch" }, "t0"),
        task("task.started", "b1", 2, { detail: "Typecheck" }),
        task("task.completed", "b1", 3, { status: "failed" }),
        task("task.started", "b2", 4, { detail: "Test" }),
      ]),
    });
    expect(dock?.background).toMatchObject({ running: 2, done: 0, failed: 1 });
    expect(dock?.background?.tasks.map((item) => item.id)).toEqual(["old-running", "b1", "b2"]);
    expect(dock?.afterTurn).toBeNull();
  });

  it("stays after the turn while work runs on in the background: what still runs, and nothing else", () => {
    const dock = deriveDock({
      ...base,
      isWorking: false,
      runningTurnId: null,
      backgroundLiveness: "working",
      agentPanelModel: panel([agent("h1", "running", "Long work"), agent("h2", "completed", "b")]),
      backgroundTasks: foldBackgroundTasks([
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
      background: { running: 1, done: 0, failed: 0 },
    });
    expect(dock?.background?.tasks.map((item) => item.id)).toEqual(["b2"]);
  });

  it("holds the running turn's pipelines, finished ones too, not quick calls or older turns", () => {
    const dock = deriveDock({
      ...base,
      timelineEntries: [
        operation("d0", "t1", 0, { kind: "deploy", phase: "done" }),
        operation("d1", "t1", 1, { kind: "deploy", phase: "running" }),
        operation("v1", "t1", 2, { kind: "verify", phase: "running" }),
        operation("d2", "t0", 2, { kind: "deploy", phase: "running" }),
      ],
    });
    expect(dock?.operations.map((op) => op.key)).toEqual(["op:d0", "op:d1"]);
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
    expect(latestUsagePause(entries) !== null).toBe(paused);
  });
});
