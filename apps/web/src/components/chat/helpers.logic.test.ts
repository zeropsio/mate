import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { describe, expect, it } from "vite-plus/test";

import {
  helperCallsLeftOut,
  helperMap,
  helperModelWords,
  helperNowWords,
  helperRecord,
  helperReportLine,
  helperSpan,
  helperStepActivities,
} from "./helpers.logic";

const at = (second: number) => `2026-10-04T07:00:${String(second).padStart(2, "0")}.000Z`;

function helper(overrides: Partial<RuntimeSubagent> = {}): RuntimeSubagent {
  return {
    id: "task-a",
    kind: "subagent",
    title: "Check the schema",
    role: "general-purpose",
    model: null,
    effort: null,
    status: "running",
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
    toolUseId: "toolu-a",
    spawnedBy: null,
    liveCall: null,
    firstSeenAt: at(0),
    startedAt: at(0),
    completedAt: null,
    updatedAt: at(0),
    ...overrides,
  };
}

function call(
  kind: "tool.started" | "tool.completed",
  id: string,
  second: number,
  tags: Record<string, unknown>,
  input: Record<string, unknown> = { command: "npm test", description: "Run the tests" },
): OrchestrationThreadActivity {
  return {
    id: `${id}:${kind}`,
    kind,
    tone: "tool",
    summary: "Ran command",
    createdAt: at(second),
    turnId: "turn-mate",
    payload: {
      itemType: "command_execution",
      toolCallId: id,
      status: kind === "tool.started" ? "inProgress" : "completed",
      detail: `Bash: ${String(input.command)}`,
      // As the server's projection sends it: the command beside its input.
      data: { toolName: "Bash", command: input.command, input },
      ...tags,
    },
  } as unknown as OrchestrationThreadActivity;
}

const mine = { agentId: "task-a", parentToolUseId: "toolu-a" };

describe("helperStepActivities", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly rows: ReadonlyArray<OrchestrationThreadActivity>;
    readonly ids: ReadonlyArray<string>;
  }> = [
    { name: "its own calls", rows: [call("tool.started", "c1", 1, mine)], ids: ["c1"] },
    {
      name: "a call tagged with its launch before its helper is known by its task",
      rows: [call("tool.started", "c1", 1, { agentId: "toolu-a", parentToolUseId: "toolu-a" })],
      ids: ["c1"],
    },
    {
      // An untagged row is drawn as the Mate's: never drawn twice.
      name: "never an untagged call, even under its launch",
      rows: [call("tool.started", "c1", 1, { parentToolUseId: "toolu-a" })],
      ids: [],
    },
    {
      name: "never another helper's or the Mate's",
      rows: [
        call("tool.started", "c1", 1, { agentId: "task-b", parentToolUseId: "toolu-b" }),
        call("tool.started", "c2", 2, {}),
      ],
      ids: [],
    },
  ];
  it.each(Array.from(cases, ({ name, rows, ids }) => ({ title: name, rows, ids })))(
    "$title",
    ({ rows, ids }) => {
      const steps = helperStepActivities(rows, helper());
      expect(steps.map((step) => (step.payload as { toolCallId: string }).toolCallId)).toEqual(ids);
      for (const step of steps) {
        expect(step.payload).not.toHaveProperty("agentId");
        expect(step.turnId).toBe("helper:task-a");
      }
    },
  );
});

describe("helperRecord", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly helper: RuntimeSubagent;
    readonly rows: ReadonlyArray<OrchestrationThreadActivity>;
    readonly expect: (record: ReturnType<typeof helperRecord>) => void;
  }> = [
    {
      name: "a working helper: its returned calls are steps, the one in flight its now",
      helper: helper(),
      rows: [
        call("tool.started", "c1", 1, mine),
        call("tool.completed", "c1", 3, mine),
        call("tool.started", "c2", 4, mine, { command: "npm run build", description: "Build it" }),
      ],
      expect: (record) => {
        expect(record?.live).toBe(true);
        expect(record?.items.map((item) => item.kind === "step" && item.step.words)).toEqual([
          "Run the tests",
        ]);
        expect(record?.now).toMatchObject({ kind: "step", step: { words: "Build it" } });
        expect(record?.status).toMatchObject({ live: true, startedAt: at(0), endedAt: null });
      },
    },
    {
      name: "a finished helper: every call a step, its clock stopped at its end",
      helper: helper({ status: "completed", completedAt: at(9), result: "All good." }),
      rows: [call("tool.started", "c1", 1, mine), call("tool.completed", "c1", 3, mine)],
      expect: (record) => {
        expect(record?.live).toBe(false);
        expect(record?.now).toBeNull();
        expect(record?.items).toHaveLength(1);
        expect(record?.status).toMatchObject({ live: false, startedAt: at(0), endedAt: at(9) });
        // Its report is its last word: it finished, never "stopped".
        expect(record?.status?.face).toBe("idle");
      },
    },
    {
      name: "a helper cut off on a step reads as stopped",
      helper: helper({ status: "interrupted", completedAt: at(9) }),
      rows: [call("tool.started", "c1", 1, mine)],
      expect: (record) => expect(record?.status?.face).toBe("stopped"),
    },
    {
      name: "a helper whose driver forwards no calls has no record",
      helper: helper({ progress: "Running the tests" }),
      rows: [call("tool.started", "c1", 1, {})],
      expect: (record) => expect(record).toBeNull(),
    },
  ];
  it.each(
    Array.from(cases, ({ name, helper: subject, rows, expect: check }) => ({
      title: name,
      subject,
      rows,
      check,
    })),
  )("$title", ({ subject, rows, check }) =>
    check(helperRecord({ helper: subject, activities: rows, nowMs: Date.parse(at(10)) })),
  );
});

describe("helperNowWords", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly helper: RuntimeSubagent;
    readonly words: string | null;
  }> = [
    {
      name: "its call in flight, in the words a step says",
      helper: helper({ liveCall: call("tool.started", "c1", 1, mine), progress: "Running x" }),
      words: "Run the tests",
    },
    {
      name: "a call that describes nothing, said plainly",
      helper: helper({
        liveCall: call("tool.started", "c1", 1, mine, { command: "ls -la /srv" }),
      }),
      words: "ls -la /srv",
    },
    {
      name: "else what its driver says it does",
      helper: helper({ progress: "Running List the open ports", lastToolName: "Bash" }),
      words: "Running List the open ports",
    },
    { name: "else the tool in its hands", helper: helper({ lastToolName: "Bash" }), words: "Bash" },
    {
      name: "nothing once it settled",
      helper: helper({ status: "completed", progress: "Running x" }),
      words: null,
    },
  ];
  it.each(
    Array.from(cases, ({ name, helper: subject, words }) => ({ title: name, subject, words })),
  )("$title", ({ subject, words }) => expect(helperNowWords(subject)).toBe(words));
});

describe("helperReportLine", () => {
  it.each([
    [
      helper({ status: "completed", result: "\n## Found three tables\nMore here." }),
      "Found three tables",
    ],
    [helper({ status: "failed", error: "Permission denied", result: null }), "Permission denied"],
    [helper({ status: "completed", result: null }), null],
  ])("%#", (subject, line) => expect(helperReportLine(subject)).toBe(line));
});

describe("helperMap", () => {
  it("nests each helper under the one that started it, in the order they came", () => {
    const rows = helperMap([
      helper({ id: "a" }),
      helper({ id: "b" }),
      helper({ id: "a1", spawnedBy: "a" }),
      helper({ id: "a1x", spawnedBy: "a1" }),
      helper({ id: "orphan", spawnedBy: "gone" }),
      helper({ id: "a2", spawnedBy: "a" }),
    ]);
    expect(rows.map((row) => [row.helper.id, row.depth, row.descendants])).toEqual([
      ["a", 0, 3],
      ["a1", 1, 1],
      ["a1x", 2, 0],
      ["a2", 1, 0],
      ["b", 0, 0],
      ["orphan", 0, 0],
    ]);
  });

  it("cuts a loop where it closes, every helper in it still shown", () => {
    const rows = helperMap([
      helper({ id: "x", spawnedBy: "y" }),
      helper({ id: "y", spawnedBy: "x" }),
      helper({ id: "z", spawnedBy: "y" }),
    ]);
    expect(rows.map((row) => [row.helper.id, row.depth])).toEqual([
      ["x", 0],
      ["y", 1],
      ["z", 2],
    ]);
  });

  it("finds a parent named by its launch, before the server knew its task", () => {
    const rows = helperMap([
      helper({ id: "a", toolUseId: "toolu-a" }),
      helper({ id: "a1", toolUseId: "toolu-a1", spawnedBy: "toolu-a" }),
    ]);
    expect(rows.map((row) => [row.helper.id, row.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
    ]);
  });
});

describe("helperCallsLeftOut", () => {
  const usage = (toolUses: number) => ({ totalTokens: 1000, toolUses });
  it.each([
    { name: "all of its calls are there", made: 2, left: 0 },
    { name: "a snapshot kept its latest calls only", made: 30, left: 28 },
  ])("$name", ({ made, left }) => {
    const rows = [
      call("tool.started", "c1", 1, mine),
      call("tool.completed", "c1", 2, mine),
      call("tool.started", "c2", 3, mine),
    ];
    expect(helperCallsLeftOut(helper({ usage: usage(made) }), rows)).toBe(left);
  });
  it("a driver that forwards no calls leaves none out", () => {
    expect(helperCallsLeftOut(helper({ usage: usage(30) }), [])).toBe(0);
  });
});

describe("helperSpan", () => {
  const usage = (durationMs: number) => ({ totalTokens: 1, durationMs });
  it.each([
    {
      name: "settled: by its driver's count when its rows say less",
      subject: helper({
        status: "completed",
        startedAt: at(30),
        completedAt: at(54),
        usage: usage(3_499_000),
      }),
      span: { since: null, ranMs: 3_499_000 },
    },
    {
      name: "settled: by its rows when no count is kept",
      subject: helper({ status: "completed", startedAt: at(0), completedAt: at(9) }),
      span: { since: null, ranMs: 9000 },
    },
    {
      name: "live: from the earlier of its start and its count",
      subject: helper({ startedAt: at(50), updatedAt: at(59), usage: usage(40_000) }),
      span: { since: at(19), ranMs: null },
    },
    {
      name: "live: from its start when its count says less",
      subject: helper({ startedAt: at(10), updatedAt: at(59), usage: usage(1_000) }),
      span: { since: at(10), ranMs: null },
    },
  ])("$name", ({ subject, span }) => expect(helperSpan(subject)).toEqual(span));
});

describe("helperModelWords", () => {
  it.each([
    ["claude-opus-5-5", "max", "Opus 5.5 · Max"],
    ["claude-sonnet-5[1m]", "high", "Sonnet 5 · High"],
    ["claude-haiku-4-5-20251001", null, "Haiku 4.5"],
    ["opus-4", "xhigh", "Opus 4 · Extra high"],
    ["gpt-5.6", "medium", "GPT-5.6 · Medium"],
    ["gpt-5.6-codex", null, "GPT-5.6 Codex"],
    ["grok-code-fast", "7", "grok-code-fast · 7"],
    [null, "max", null],
  ] as const)("%s · %s → %s", (model, effort, words) =>
    expect(helperModelWords(model, effort)).toBe(words),
  );
});
