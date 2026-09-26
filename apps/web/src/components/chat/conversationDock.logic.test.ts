import type {
  AgentPanelModel,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { assistant, at, operation, tool, user } from "./conversationFixtures";
import { deriveDock, dockHelpers, latestUsagePause } from "./conversationDock.logic";

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
