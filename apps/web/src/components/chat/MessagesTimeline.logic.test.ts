import { describe, expect, it } from "vite-plus/test";
import {
  LIVE_DEPLOY_ERROR_RESULT,
  LIVE_VERIFY_RESULT,
} from "@t3tools/client-runtime/zerops/cards/liveFixtures";
import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
} from "./MessagesTimeline.logic";

const makeWorkTimelineEntry = (
  id: string,
  entry: Partial<WorkLogEntry> = {},
): Extract<TimelineEntry, { kind: "work" }> => ({
  id: `${id}-entry`,
  kind: "work",
  createdAt: `2026-01-01T00:00:${id.length.toString().padStart(2, "0")}Z`,
  entry: {
    id: `${id}-work`,
    createdAt: `2026-01-01T00:00:${id.length.toString().padStart(2, "0")}Z`,
    label: id,
    tone: "tool",
    itemType: "mcp_tool_call",
    toolLifecycleStatus: "completed",
    ...entry,
  },
});

const makeAssistantTimelineEntry = (
  id: string,
  createdAt: string,
): Extract<TimelineEntry, { kind: "message" }> => ({
  id: `${id}-entry`,
  kind: "message",
  createdAt,
  message: {
    id: id as never,
    role: "assistant",
    text: id,
    turnId: "turn-milestone" as never,
    createdAt,
    updatedAt: createdAt,
    streaming: false,
  },
});

const deriveSettledRows = (
  timelineEntries: TimelineEntry[],
  expandedWorkGroupIds?: ReadonlySet<string>,
) =>
  deriveMessagesTimelineRows({
    timelineEntries,
    ...(expandedWorkGroupIds === undefined ? {} : { expandedWorkGroupIds }),
    isWorking: false,
    activeTurnStartedAt: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    revertTurnCountByUserMessageId: new Map(),
  });

const deriveActiveRows = (
  timelineEntries: TimelineEntry[],
  expandedWorkGroupIds?: ReadonlySet<string>,
) =>
  deriveMessagesTimelineRows({
    timelineEntries,
    latestTurn: {
      turnId: "turn-active" as never,
      state: "running",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: null,
    },
    runningTurnId: "turn-active" as never,
    ...(expandedWorkGroupIds === undefined ? {} : { expandedWorkGroupIds }),
    isWorking: true,
    activeTurnStartedAt: "2026-01-01T00:00:00Z",
    turnDiffSummaryByAssistantMessageId: new Map(),
    revertTurnCountByUserMessageId: new Map(),
  });

const makeDeployMilestone = (id: string, entry: Partial<WorkLogEntry> = {}) =>
  makeWorkTimelineEntry(id, {
    turnId: "turn-active" as never,
    zeropsResult: {
      toolName: "zerops_deploy",
      resultText: JSON.stringify({ status: "DEPLOYED", targetService: "api" }),
    },
    ...entry,
  });

const makeRunningTool = (id: string) =>
  makeWorkTimelineEntry(id, {
    turnId: "turn-active" as never,
    itemType: "command_execution",
    toolLifecycleStatus: "inProgress",
  });

const rowIdentities = (rows: ReturnType<typeof deriveMessagesTimelineRows>) =>
  rows.map(({ id, kind }) => ({ id, kind }));

describe("shouldPreserveAssistantLineBreaks", () => {
  it("preserves Claude insight formatting without changing regular markdown", () => {
    expect(
      shouldPreserveAssistantLineBreaks(
        "★ Insight ─────────────────\\nFirst observation\\nSecond observation\\n─────────────────",
      ),
    ).toBe(true);
    expect(shouldPreserveAssistantLineBreaks("A normal\\nmarkdown paragraph")).toBe(false);
  });
});

describe("computeMessageDurationStart", () => {
  it("returns message createdAt when there is no preceding user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:05Z",
        updatedAt: "2026-01-01T00:00:10Z",
        streaming: false,
      },
    ]);
    expect(result).toEqual(new Map([["a1", "2026-01-01T00:00:05Z"]]));
  });

  it("uses the user message createdAt for the first assistant response", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("uses the previous completed assistant updatedAt for subsequent assistant responses", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        updatedAt: "2026-01-01T00:00:55Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:30Z"],
      ]),
    );
  });

  it("does not advance the boundary for a streaming message", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:40Z",
        streaming: true,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:00:55Z",
        updatedAt: "2026-01-01T00:00:55Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["a2", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("resets the boundary on a new user message", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
      {
        id: "u2",
        role: "user",
        createdAt: "2026-01-01T00:01:00Z",
        updatedAt: "2026-01-01T00:01:00Z",
        streaming: false,
      },
      {
        id: "a2",
        role: "assistant",
        createdAt: "2026-01-01T00:01:20Z",
        updatedAt: "2026-01-01T00:01:20Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
        ["u2", "2026-01-01T00:01:00Z"],
        ["a2", "2026-01-01T00:01:00Z"],
      ]),
    );
  });

  it("handles system messages without affecting the boundary", () => {
    const result = computeMessageDurationStart([
      {
        id: "u1",
        role: "user",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        streaming: false,
      },
      {
        id: "s1",
        role: "system",
        createdAt: "2026-01-01T00:00:01Z",
        updatedAt: "2026-01-01T00:00:01Z",
        streaming: false,
      },
      {
        id: "a1",
        role: "assistant",
        createdAt: "2026-01-01T00:00:30Z",
        updatedAt: "2026-01-01T00:00:30Z",
        streaming: false,
      },
    ]);

    expect(result).toEqual(
      new Map([
        ["u1", "2026-01-01T00:00:00Z"],
        ["s1", "2026-01-01T00:00:00Z"],
        ["a1", "2026-01-01T00:00:00Z"],
      ]),
    );
  });

  it("returns empty map for empty input", () => {
    expect(computeMessageDurationStart([])).toEqual(new Map());
  });
});

describe("normalizeCompactToolLabel", () => {
  it("removes trailing completion wording from command labels", () => {
    expect(normalizeCompactToolLabel("Ran command complete")).toBe("Ran command");
  });

  it("removes trailing completion wording from other labels", () => {
    expect(normalizeCompactToolLabel("Read file completed")).toBe("Read file");
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it("returns enabled copy state for completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Ship it",
        streaming: false,
      }),
    ).toEqual({
      text: "Ship it",
      visible: true,
    });
  });

  it("hides copy while an assistant message is still streaming", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "Still streaming",
        streaming: true,
      }),
    ).toEqual({
      text: "Still streaming",
      visible: false,
    });
  });

  it("hides copy for empty completed assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: true,
        text: "   ",
        streaming: false,
      }),
    ).toEqual({
      text: null,
      visible: false,
    });
  });

  it("hides copy for non-terminal assistant messages", () => {
    expect(
      resolveAssistantMessageCopyState({
        showCopyButton: false,
        text: "Interim thought",
        streaming: false,
      }),
    ).toEqual({
      text: "Interim thought",
      visible: false,
    });
  });
});

describe("deriveMessagesTimelineRows", () => {
  it.each([
    {
      mechanism: "turn fold",
      timelineEntries: [
        {
          id: "assistant-first-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:01Z",
          message: {
            id: "assistant-first" as never,
            role: "assistant",
            text: "Starting the fleet.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:01Z",
            updatedAt: "2026-01-01T00:00:01Z",
            streaming: false,
          },
        },
        {
          id: "spawn-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:02Z",
          entry: {
            id: "spawn-work",
            createdAt: "2026-01-01T00:00:02Z",
            turnId: "turn-1" as never,
            label: "Kicked off 1 subagent",
            tone: "info",
            agentSpawn: { workflowId: null, agentTaskIds: ["t1"] },
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:03Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "The fleet is running.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:03Z",
            updatedAt: "2026-01-01T00:00:03Z",
            streaming: false,
          },
        },
      ] satisfies TimelineEntry[],
      expectedIds: ["assistant-first-entry", "spawn-entry", "assistant-final-entry"],
      expectedToggle: undefined,
    },
    {
      mechanism: "tool-group summary",
      timelineEntries: [
        {
          id: "ordinary-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "ordinary-work",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Ran command",
            tone: "tool",
            itemType: "command_execution",
            toolLifecycleStatus: "completed",
          },
        },
        {
          id: "spawn-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:01Z",
          entry: {
            id: "spawn-work",
            createdAt: "2026-01-01T00:00:01Z",
            label: "Kicked off 1 subagent",
            tone: "tool",
            itemType: "collab_agent_tool_call",
            toolLifecycleStatus: "completed",
            agentSpawn: { workflowId: null, agentTaskIds: ["t1"] },
          },
        },
      ] satisfies TimelineEntry[],
      expectedIds: ["ordinary-work", "spawn-work"],
      expectedToggle: undefined,
    },
    {
      mechanism: "overflow",
      timelineEntries: [
        {
          id: "ordinary-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:01Z",
          entry: {
            id: "ordinary-work-1",
            createdAt: "2026-01-01T00:00:01Z",
            label: "Ran command",
            tone: "tool",
            itemType: "command_execution",
            toolLifecycleStatus: "completed",
          },
        },
        {
          id: "spawn-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:02Z",
          entry: {
            id: "spawn-work",
            createdAt: "2026-01-01T00:00:02Z",
            label: "Kicked off 1 subagent",
            tone: "info",
            agentSpawn: { workflowId: null, agentTaskIds: ["t1"] },
          },
        },
        {
          id: "ordinary-entry-2",
          kind: "work",
          createdAt: "2026-01-01T00:00:03Z",
          entry: {
            id: "ordinary-work-2",
            createdAt: "2026-01-01T00:00:03Z",
            label: "Ran command",
            tone: "tool",
            itemType: "command_execution",
            toolLifecycleStatus: "completed",
          },
        },
      ] satisfies TimelineEntry[],
      expectedIds: ["spawn-work", "ordinary-work-2", "work-toggle:ordinary-entry-1"],
      expectedToggle: { hiddenCount: 1, summary: null, hasFailure: false },
    },
  ])(
    "keeps agent-spawn rows visible through the $mechanism",
    ({ timelineEntries, expectedIds, expectedToggle }) => {
      const rows = deriveMessagesTimelineRows({
        timelineEntries,
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

      expect(rows.map((row) => row.id)).toEqual(expectedIds);
      expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject(expectedToggle ?? {});
      if (expectedToggle === undefined) {
        expect(rows.some((row) => row.kind === "work-toggle")).toBe(false);
      }
      expect(rows.some((row) => row.id === "spawn-entry" || row.id === "spawn-work")).toBe(true);
    },
  );

  it.each([
    {
      name: "ordinary tool",
      entry: { itemType: "command_execution" },
      escapes: false,
      summary: "Ran 1 command",
    },
    {
      name: "deploy",
      entry: {
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "kanbandev" }),
        },
      },
      escapes: true,
      summary: "Used 1 tool",
    },
    {
      name: "verify",
      entry: {
        zeropsResult: { toolName: "zerops_verify", resultText: LIVE_VERIFY_RESULT },
      },
      escapes: true,
      summary: "Used 1 tool",
    },
    {
      name: "import",
      entry: {
        zeropsResult: {
          toolName: "zerops_import",
          resultText: JSON.stringify({
            projectName: "z3-eval",
            processes: [{ service: "api", status: "FINISHED" }],
          }),
        },
      },
      escapes: true,
      summary: "Used 1 tool",
    },
    {
      name: "plan",
      entry: {
        zeropsResult: {
          toolName: "zerops_workflow",
          resultText: JSON.stringify({
            intent: "Bootstrap the project",
            progress: { completed: 1, total: 2, steps: [] },
          }),
        },
      },
      escapes: true,
      summary: "Used 1 tool",
    },
    {
      name: "error",
      entry: {
        toolLifecycleStatus: "failed",
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: LIVE_DEPLOY_ERROR_RESULT,
        },
      },
      escapes: true,
      summary: "Used 1 tool",
    },
    {
      name: "mount",
      entry: {
        zeropsResult: {
          toolName: "zerops_mount",
          resultText: JSON.stringify({ hostname: "api", status: "MOUNTED" }),
        },
      },
      escapes: false,
      summary: "Used 1 tool",
    },
    {
      name: "subdomain",
      entry: {
        zeropsResult: {
          toolName: "zerops_subdomain",
          resultText: JSON.stringify({ serviceHostname: "api", action: "enable" }),
        },
      },
      escapes: false,
      summary: "Used 1 tool",
    },
    {
      name: "non-JSON result",
      entry: {
        zeropsResult: { toolName: "zerops_workflow", resultText: "workflow is still running" },
      },
      escapes: false,
      summary: "Used 1 tool",
    },
    {
      name: "truncated result",
      entry: {
        zeropsResult: { toolName: "zerops_deploy", truncated: true },
      },
      escapes: false,
      summary: "Used 1 tool",
    },
    {
      name: "JSON array",
      entry: {
        zeropsResult: { toolName: "zerops_deploy", resultText: "[]" },
      },
      escapes: false,
      summary: "Used 1 tool",
    },
    {
      name: "unknown tool",
      entry: {
        zeropsResult: { toolName: "zerops_future", resultText: "{}" },
      },
      escapes: false,
      summary: "Used 1 tool",
    },
  ] satisfies ReadonlyArray<{
    name: string;
    entry: Partial<WorkLogEntry>;
    escapes: boolean;
    summary: string;
  }>)("applies the milestone row vector to $name", ({ name, entry, escapes, summary }) => {
    const id = `vector-${name.replaceAll(" ", "-")}`;
    const subject = makeWorkTimelineEntry(id, {
      turnId: "turn-milestone" as never,
      ...entry,
    });
    const firstAssistant = makeAssistantTimelineEntry("assistant-first", "2026-01-01T00:00:01Z");
    const finalAssistant = makeAssistantTimelineEntry("assistant-final", "2026-01-01T00:00:59Z");
    const foldRows = deriveSettledRows([firstAssistant, subject, finalAssistant]);
    const groupRows = deriveSettledRows([makeWorkTimelineEntry(id, entry)]);
    const overflowTail: Extract<TimelineEntry, { kind: "work" }> = {
      id: "overflow-tail-entry",
      kind: "work",
      createdAt: "2026-01-01T00:00:58Z",
      entry: {
        id: "overflow-tail-work",
        createdAt: "2026-01-01T00:00:58Z",
        label: "Status updated",
        tone: "info",
      },
    };
    const overflowRows = deriveSettledRows([makeWorkTimelineEntry(id, entry), overflowTail]);
    const subjectWorkId = subject.entry.id;
    const subjectEntryId = subject.id;

    expect(rowIdentities(foldRows)).toEqual(
      escapes
        ? [
            { id: "assistant-first-entry", kind: "message" },
            { id: subjectWorkId, kind: "work" },
            { id: "assistant-final-entry", kind: "message" },
          ]
        : [
            { id: "assistant-first-entry", kind: "message" },
            { id: "turn-fold:turn-milestone", kind: "turn-fold" },
            { id: "assistant-final-entry", kind: "message" },
          ],
    );

    expect(rowIdentities(groupRows)).toEqual(
      escapes
        ? [{ id: subjectWorkId, kind: "work" }]
        : [{ id: `work-toggle:${subjectEntryId}`, kind: "work-toggle" }],
    );
    const groupToggle = groupRows.find((row) => row.kind === "work-toggle");
    expect(groupToggle).toEqual(
      escapes ? undefined : expect.objectContaining({ summary, hiddenCount: 1, hasFailure: false }),
    );

    expect(rowIdentities(overflowRows)).toEqual(
      escapes
        ? [
            { id: subjectWorkId, kind: "work" },
            { id: "overflow-tail-work", kind: "work" },
          ]
        : [
            { id: "overflow-tail-work", kind: "work" },
            { id: `work-toggle:${subjectEntryId}`, kind: "work-toggle" },
          ],
    );
    const overflowToggle = overflowRows.find((row) => row.kind === "work-toggle");
    expect(overflowToggle).toEqual(
      escapes
        ? undefined
        : expect.objectContaining({ summary: null, hiddenCount: 1, hasFailure: false }),
    );
  });

  it("moves a settled-turn fold anchor past a leading milestone", () => {
    const milestone = makeWorkTimelineEntry("anchor-milestone", {
      turnId: "turn-milestone" as never,
      zeropsResult: {
        toolName: "zerops_deploy",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "api" }),
      },
    });
    const ordinary = makeWorkTimelineEntry("anchor-ordinary", {
      turnId: "turn-milestone" as never,
      itemType: "command_execution",
    });

    const rows = deriveSettledRows([
      makeAssistantTimelineEntry("assistant-first", "2026-01-01T00:00:01Z"),
      milestone,
      ordinary,
      makeAssistantTimelineEntry("assistant-final", "2026-01-01T00:00:59Z"),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "assistant-first-entry", kind: "message" },
      { id: "anchor-milestone-work", kind: "work" },
      { id: "turn-fold:turn-milestone", kind: "turn-fold" },
      { id: "assistant-final-entry", kind: "message" },
    ]);
    expect(rows.find((row) => row.kind === "turn-fold")?.createdAt).toBe(ordinary.createdAt);
  });

  it("drops the fold row when a milestone was its only hidden entry", () => {
    const rows = deriveSettledRows([
      makeAssistantTimelineEntry("assistant-first", "2026-01-01T00:00:01Z"),
      makeWorkTimelineEntry("only-hidden-milestone", {
        turnId: "turn-milestone" as never,
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "api" }),
        },
      }),
      makeAssistantTimelineEntry("assistant-final", "2026-01-01T00:00:59Z"),
    ]);

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.map((row) => row.id)).toContain("only-hidden-milestone-work");
  });

  it("emits a group containing only milestones without a toggle", () => {
    const rows = deriveSettledRows([
      makeWorkTimelineEntry("deploy-milestone", {
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "api" }),
        },
      }),
      makeWorkTimelineEntry("verify-milestone", {
        zeropsResult: { toolName: "zerops_verify", resultText: LIVE_VERIFY_RESULT },
      }),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "deploy-milestone-work", kind: "work" },
      { id: "verify-milestone-work", kind: "work" },
    ]);
  });

  it("partitions a tool summary and expands every entry exactly once", () => {
    const entries = [
      makeWorkTimelineEntry("partition-deploy", {
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "api" }),
        },
      }),
      makeWorkTimelineEntry("partition-mount", {
        zeropsResult: {
          toolName: "zerops_mount",
          resultText: JSON.stringify({ hostname: "api", status: "MOUNTED" }),
        },
      }),
      makeWorkTimelineEntry("partition-verify", {
        zeropsResult: { toolName: "zerops_verify", resultText: LIVE_VERIFY_RESULT },
      }),
    ];
    const groupId = "work-group:partition-deploy-entry";
    const collapsedRows = deriveSettledRows(entries);
    const expandedRows = deriveSettledRows(entries, new Set([groupId]));

    expect(rowIdentities(collapsedRows)).toEqual([
      { id: "work-toggle:partition-deploy-entry", kind: "work-toggle" },
      { id: "partition-deploy-work", kind: "work" },
      { id: "partition-verify-work", kind: "work" },
    ]);
    expect(collapsedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      groupId,
      summary: "Used 1 tool",
      hiddenCount: 1,
      hasFailure: false,
    });
    expect(rowIdentities(expandedRows)).toEqual([
      { id: "work-toggle:partition-deploy-entry", kind: "work-toggle" },
      { id: "partition-deploy-work", kind: "work" },
      { id: "partition-mount-work", kind: "work" },
      { id: "partition-verify-work", kind: "work" },
    ]);
    const expandedIds = expandedRows.map((row) => row.id);
    expect(new Set(expandedIds).size).toBe(expandedIds.length);
  });

  it("keeps a settled milestone before a running tool visible in both active states", () => {
    const milestone = makeDeployMilestone("active-leading-milestone");
    const running = makeRunningTool("active-running");
    const groupId = "work-group:active-running-entry";
    const collapsedRows = deriveActiveRows([milestone, running]);
    const expandedRows = deriveActiveRows([milestone, running], new Set([groupId]));

    expect(rowIdentities(collapsedRows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "active-leading-milestone-work", kind: "work" },
      { id: "work-live:active-running-entry", kind: "work-live" },
    ]);
    expect(rowIdentities(expandedRows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "active-leading-milestone-work", kind: "work" },
      { id: "work-live:active-running-entry", kind: "work-live" },
      { id: "active-running-work", kind: "work" },
    ]);
    expect(new Set(expandedRows.map((row) => row.id)).size).toBe(expandedRows.length);
  });

  it("splits an active work group around a middle milestone", () => {
    const rows = deriveActiveRows([
      makeRunningTool("active-running-before"),
      makeDeployMilestone("active-middle-milestone"),
      makeRunningTool("active-running-after"),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "work-live:active-running-before-entry", kind: "work-live" },
      { id: "active-middle-milestone-work", kind: "work" },
      { id: "work-live:active-running-after-entry", kind: "work-live" },
    ]);
  });

  it("keeps a trailing milestone out of an active work group", () => {
    const rows = deriveActiveRows([
      makeRunningTool("active-running-before"),
      makeDeployMilestone("active-trailing-milestone"),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "work-live:active-running-before-entry", kind: "work-live" },
      { id: "active-trailing-milestone-work", kind: "work" },
    ]);
  });

  it("renders an active turn whose only settled tool is a milestone", () => {
    const rows = deriveActiveRows([makeDeployMilestone("active-only-milestone")]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "active-only-milestone-work", kind: "work" },
    ]);
  });

  it("partitions duplicate work entry ids without dropping or duplicating rows", () => {
    const milestone = makeDeployMilestone("duplicate-deploy", {
      turnId: null,
      id: "duplicate-work-id",
    });
    const ordinary = makeWorkTimelineEntry("duplicate-mount", {
      id: "duplicate-work-id",
      zeropsResult: {
        toolName: "zerops_mount",
        resultText: JSON.stringify({ hostname: "api", status: "MOUNTED" }),
      },
    });
    const groupId = "work-group:duplicate-deploy-entry";
    const collapsedRows = deriveSettledRows([milestone, ordinary]);
    const expandedRows = deriveSettledRows([milestone, ordinary], new Set([groupId]));

    expect(rowIdentities(collapsedRows)).toEqual([
      { id: "work-toggle:duplicate-deploy-entry", kind: "work-toggle" },
      { id: "duplicate-work-id", kind: "work" },
    ]);
    expect(rowIdentities(expandedRows)).toEqual([
      { id: "work-toggle:duplicate-deploy-entry", kind: "work-toggle" },
      { id: "duplicate-work-id", kind: "work" },
      { id: "duplicate-mount-entry", kind: "work" },
    ]);
    expect(collapsedRows.filter((row) => row.kind === "work")).toHaveLength(1);
    expect(collapsedRows.find((row) => row.kind === "work")?.groupedEntries).toEqual([
      milestone.entry,
    ]);
    expect(collapsedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      hiddenCount: 1,
      summary: "Used 1 tool",
    });
    expect(
      expandedRows.filter((row) => row.kind === "work").map((row) => row.groupedEntries[0]),
    ).toEqual([milestone.entry, ordinary.entry]);
    expect(new Set(expandedRows.map((row) => row.id)).size).toBe(expandedRows.length);
  });

  it("keys settled turn fold membership by timeline entry identity", () => {
    const milestone = makeDeployMilestone("duplicate-fold-deploy", {
      turnId: "turn-milestone" as never,
    });
    const ordinary = makeWorkTimelineEntry("duplicate-fold-ordinary", {
      turnId: "turn-milestone" as never,
      itemType: "command_execution",
    });
    milestone.id = "duplicate-timeline-id";
    ordinary.id = "duplicate-timeline-id";

    const rows = deriveSettledRows([
      makeAssistantTimelineEntry("assistant-first", "2026-01-01T00:00:01Z"),
      milestone,
      ordinary,
      makeAssistantTimelineEntry("assistant-final", "2026-01-01T00:00:59Z"),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "assistant-first-entry", kind: "message" },
      { id: "duplicate-fold-deploy-work", kind: "work" },
      { id: "turn-fold:turn-milestone", kind: "turn-fold" },
      { id: "assistant-final-entry", kind: "message" },
    ]);
    expect(rows.filter((row) => row.kind === "turn-fold")).toHaveLength(1);
  });

  it("only enables assistant copy for the terminal assistant message in a turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-1-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Write a poem",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "I should ground this first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Here is the poem.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows).toHaveLength(2);
    expect(assistantRows[0]?.showAssistantCopyButton).toBe(false);
    expect(assistantRows[1]?.showAssistantCopyButton).toBe(true);
  });

  it("marks only the active assistant turn as streaming for copy controls", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-one-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-one" as never,
            role: "assistant",
            text: "Earlier response.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-two-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-two" as never,
            role: "assistant",
            text: "Active response.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-2" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:19Z",
        completedAt: null,
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows[0]?.assistantCopyStreaming).toBe(false);
    expect(assistantRows[1]?.assistantCopyStreaming).toBe(true);
  });

  it("projects assistant diff summaries and user revert counts onto the affected rows", () => {
    const assistantTurnDiffSummary = {
      turnId: "turn-1" as never,
      completedAt: "2026-01-01T00:00:30Z",
      assistantMessageId: "assistant-1" as never,
      checkpointTurnCount: 2,
      checkpointRef: "checkpoint-1" as never,
      status: "ready" as const,
      files: [{ path: "src/index.ts", kind: "modified", additions: 3, deletions: 1 }],
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user",
            text: "Do the thing",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-1" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map([
        ["assistant-1" as never, assistantTurnDiffSummary],
      ]),
      revertTurnCountByUserMessageId: new Map([["user-1" as never, 1]]),
    });

    const userRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "user",
    );
    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(userRow?.revertTurnCount).toBe(1);
    expect(assistantRow?.assistantTurnDiffSummary).toBe(assistantTurnDiffSummary);
  });

  it("keeps the first and terminal assistant messages visible around settled work", () => {
    const timelineEntries = [
      {
        id: "user-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:00Z",
        message: {
          id: "user-1" as never,
          role: "user" as const,
          text: "Build it",
          turnId: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          streaming: false,
        },
      },
      {
        id: "assistant-first-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:05Z",
        message: {
          id: "assistant-first" as never,
          role: "assistant" as const,
          text: "Synthetic deployment checklist\n1. Confirm the deployment is ready.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:05Z",
          updatedAt: "2026-01-01T00:00:06Z",
          streaming: false,
        },
      },
      {
        id: "work-entry-1",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:08Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:08Z",
          turnId: "turn-1" as never,
          label: "Ran command",
          tone: "tool" as const,
        },
      },
      {
        id: "assistant-final-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:20Z",
        message: {
          id: "assistant-final" as never,
          role: "assistant" as const,
          text: "Done",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:20Z",
          updatedAt: "2026-01-01T00:00:22Z",
          streaming: false,
        },
      },
    ];

    const collapsedRows = deriveMessagesTimelineRows({
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const foldRow = collapsedRows.find(
      (row): row is Extract<(typeof collapsedRows)[number], { kind: "turn-fold" }> =>
        row.kind === "turn-fold",
    );
    expect(foldRow?.turnId).toBe("turn-1");
    expect(foldRow?.expanded).toBe(false);
    // User message boundary (00:00:00) → terminal message updatedAt (00:00:22).
    expect(foldRow?.label).toBe("Worked for 22s");
    expect(collapsedRows.map((row) => row.id)).toEqual([
      "user-entry",
      "assistant-first-entry",
      "turn-fold:turn-1",
      "assistant-final-entry",
    ]);

    const expandedRows = deriveMessagesTimelineRows({
      timelineEntries,
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(expandedRows.map((row) => row.id)).toEqual([
      "user-entry",
      "assistant-first-entry",
      "turn-fold:turn-1",
      "work-toggle:work-entry-1",
      "assistant-final-entry",
    ]);
    expect(
      expandedRows.find((row) => row.kind === "turn-fold" && row.expanded === true),
    ).toBeDefined();
  });

  it("folds assistant messages between the first and terminal messages", () => {
    const timelineEntries = [
      {
        id: "assistant-first-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:01Z",
        message: {
          id: "assistant-first" as never,
          role: "assistant" as const,
          text: "The main result is ready.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:01Z",
          updatedAt: "2026-01-01T00:00:02Z",
          streaming: false,
        },
      },
      {
        id: "assistant-middle-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:03Z",
        message: {
          id: "assistant-middle" as never,
          role: "assistant" as const,
          text: "I am checking one more detail.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:03Z",
          updatedAt: "2026-01-01T00:00:04Z",
          streaming: false,
        },
      },
      {
        id: "assistant-final-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:05Z",
        message: {
          id: "assistant-final" as never,
          role: "assistant" as const,
          text: "Verification finished.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:05Z",
          updatedAt: "2026-01-01T00:00:06Z",
          streaming: false,
        },
      },
    ];

    const rows = deriveMessagesTimelineRows({
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "assistant-first-entry",
      "turn-fold:turn-1",
      "assistant-final-entry",
    ]);
  });

  it("derives a sane duration for a steer-superseded turn with one instant commentary message", () => {
    // A steer ends the previous turn early: its only message completes the
    // instant it is created, and trailing work entries land after it. The
    // fold duration must span from the user message that started the turn to
    // the last entry, not message createdAt → message updatedAt (~0ms).
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:00Z",
          message: {
            id: "user-1" as never,
            role: "user" as const,
            text: "do it once more",
            turnId: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            streaming: false,
          },
        },
        {
          id: "assistant-commentary-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:09Z",
          message: {
            id: "assistant-commentary" as never,
            role: "assistant" as const,
            text: "Kicking off call 1.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:09Z",
            updatedAt: "2026-01-01T00:00:09Z",
            streaming: false,
          },
        },
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:12Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:12Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "steer-user-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:14Z",
          message: {
            id: "user-2" as never,
            role: "user" as const,
            text: "actually do 15",
            turnId: null,
            createdAt: "2026-01-01T00:00:14Z",
            updatedAt: "2026-01-01T00:00:14Z",
            streaming: false,
          },
        },
        {
          id: "assistant-next-turn-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:17Z",
          message: {
            id: "assistant-next" as never,
            role: "assistant" as const,
            text: "One down — adjusting.",
            turnId: "turn-2" as never,
            createdAt: "2026-01-01T00:00:17Z",
            updatedAt: "2026-01-01T00:00:17Z",
            streaming: true,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-2" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:14Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:14Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const foldRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "turn-fold" }> =>
        row.kind === "turn-fold",
    );
    // User message (00:00:00) → trailing work entry (00:00:12).
    expect(foldRow?.turnId).toBe("turn-1");
    expect(foldRow?.label).toBe("Worked for 12s");
  });

  it("uses latest-turn timings and the stopped label for an interrupted latest turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "interrupted",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:47Z",
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        kind: "turn-fold",
        turnId: "turn-1",
        label: "You stopped after 47s",
        expanded: false,
      }),
    ]);
  });

  it("keeps the previous turn folded while a newly sent message awaits its turn", () => {
    // Right after send, isWorking is true but latestTurn still points at the
    // previous, settled turn — it must stay folded through that window.
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:22Z",
            streaming: false,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "yooo",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:22Z",
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "turn-fold:turn-1",
      "assistant-final-entry",
      "user-followup-entry",
      "working-indicator-row",
    ]);
    const finalRow = rows.find((row) => row.id === "assistant-final-entry");
    expect(finalRow?.kind === "message" && finalRow.showAssistantMeta).toBe(true);
  });

  it("does not fold the active in-progress turn", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:05Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:05Z",
            updatedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "work-entry-1",
          kind: "work",
          createdAt: "2026-01-01T00:00:08Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:08Z",
            turnId: "turn-1" as never,
            label: "Ran command",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.map((row) => row.id)).toEqual([
      "working-indicator-row",
      "assistant-thought-entry",
      "work-live:work-entry-1",
    ]);
  });

  it("keeps adjacent active tool calls in one replacing row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "completed-command-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "completed-command",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran rg",
            command: "rg toolCall",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "completed" as const,
          },
        },
        {
          id: "completed-edit-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:06Z",
          entry: {
            id: "completed-edit",
            createdAt: "2026-01-01T00:00:06Z",
            turnId: "turn-1" as never,
            label: "Edited files",
            requestKind: "file-change",
            changedFiles: ["src/one.ts", "src/two.ts"],
            tone: "tool" as const,
            toolLifecycleStatus: "completed" as const,
          },
        },
        {
          id: "running-command-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:07Z",
          entry: {
            id: "running-command",
            createdAt: "2026-01-01T00:00:07Z",
            turnId: "turn-1" as never,
            label: "Running tests",
            command: "vp test run",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "inProgress" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["working", "work-live"]);
    expect(rows.find((row) => row.kind === "work-live")).toMatchObject({
      entry: { id: "running-command" },
      groupedEntries: [
        { id: "completed-command" },
        { id: "completed-edit" },
        { id: "running-command" },
      ],
    });
  });

  it("summarizes a tool run after commentary starts a new run", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "completed-command-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "completed-command",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran rg",
            command: "rg toolCall",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "completed" as const,
          },
        },
        {
          id: "assistant-commentary-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:06Z",
          message: {
            id: "assistant-commentary" as never,
            role: "assistant",
            text: "Checking another thing.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:06Z",
            updatedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "running-command-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:07Z",
          entry: {
            id: "running-command",
            createdAt: "2026-01-01T00:00:07Z",
            turnId: "turn-1" as never,
            label: "Running tests",
            command: "vp test run",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "inProgress" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["working", "work-toggle", "message", "work-live"]);
    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({
      hiddenCount: 1,
      summary: "Ran 1 command",
    });
  });

  it("keeps separated in-progress tool runs visible", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "first-running-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "first-running",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Running first command",
            command: "rg first",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "inProgress" as const,
          },
        },
        {
          id: "assistant-commentary-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:06Z",
          message: {
            id: "assistant-commentary" as never,
            role: "assistant",
            text: "Starting another command.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:06Z",
            updatedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "second-running-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:07Z",
          entry: {
            id: "second-running",
            createdAt: "2026-01-01T00:00:07Z",
            turnId: "turn-1" as never,
            label: "Running second command",
            command: "rg second",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "inProgress" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["working", "work-live", "message", "work-live"]);
    expect(rows.filter((row) => row.kind === "work-live").map((row) => row.entry.id)).toEqual([
      "first-running",
      "second-running",
    ]);
  });

  it("does not revive stale in-progress tools before a fresh send has a turn id", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "stale-running-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "stale-running",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Running stale command",
            command: "rg stale",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "inProgress" as const,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "continue",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
      ],
      latestTurn: null,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "work-live")).toBe(false);
  });

  it("does not revive separated historical task progress", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "stale-progress-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "stale-progress",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Old progress",
            tone: "thinking" as const,
            sourceActivityKind: "task.progress" as const,
          },
        },
        {
          id: "assistant-commentary-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:06Z",
          message: {
            id: "assistant-commentary" as never,
            role: "assistant",
            text: "Starting another command.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:06Z",
            updatedAt: "2026-01-01T00:00:06Z",
            streaming: false,
          },
        },
        {
          id: "running-command-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:07Z",
          entry: {
            id: "running-command",
            createdAt: "2026-01-01T00:00:07Z",
            turnId: "turn-1" as never,
            label: "Running command",
            command: "rg current",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "inProgress" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.filter((row) => row.kind === "work-live").map((row) => row.entry.id)).toEqual([
      "running-command",
    ]);
  });

  it("keeps the latest completed tool call live while the turn is running", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "latest-command-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "latest-command",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Ran rg",
            command: "rg toolCall",
            requestKind: "command",
            tone: "tool" as const,
            toolLifecycleStatus: "completed" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.map((row) => row.kind)).toEqual(["working", "work-live"]);
    expect(rows.find((row) => row.kind === "work-live")).toMatchObject({
      entry: { id: "latest-command" },
      groupedEntries: [{ id: "latest-command" }],
    });
  });

  it("does not fold the session's running turn when latestTurn regresses", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "previous-work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:05Z",
          entry: {
            id: "previous-work",
            createdAt: "2026-01-01T00:00:05Z",
            turnId: "turn-1" as never,
            label: "Read files",
            tone: "tool" as const,
          },
        },
        {
          id: "user-followup-entry",
          kind: "message",
          createdAt: "2026-01-01T00:01:00Z",
          message: {
            id: "user-followup" as never,
            role: "user",
            text: "continue",
            turnId: null,
            createdAt: "2026-01-01T00:01:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
            streaming: false,
          },
        },
        {
          id: "running-work-entry",
          kind: "work",
          createdAt: "2026-01-01T00:01:05Z",
          entry: {
            id: "running-work",
            createdAt: "2026-01-01T00:01:05Z",
            turnId: "turn-2" as never,
            label: "Searched files",
            tone: "tool" as const,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:00:25Z",
      },
      runningTurnId: "turn-2" as never,
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:01:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.filter((row) => row.kind === "turn-fold").map((row) => row.turnId)).toEqual([
      "turn-1",
    ]);
    expect(rows.map((row) => row.id)).toContain("work-live:running-work-entry");
  });

  it("only shows assistant metadata on the terminal assistant message", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Checking first.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:20Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:20Z",
            updatedAt: "2026-01-01T00:00:30Z",
            streaming: false,
          },
        },
      ],
      expandedTurnIds: new Set(["turn-1" as never]),
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRows.map((row) => row.showAssistantMeta)).toEqual([false, true]);
  });

  it("withholds assistant metadata while the active turn is still in progress", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-thought-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:10Z",
          message: {
            id: "assistant-thought" as never,
            role: "assistant",
            text: "Working on it.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:10Z",
            updatedAt: "2026-01-01T00:00:11Z",
            streaming: false,
          },
        },
      ],
      latestTurn: {
        turnId: "turn-1" as never,
        state: "running",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: "2026-01-01T00:00:00Z",
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const assistantRow = rows.find(
      (row): row is Extract<(typeof rows)[number], { kind: "message" }> =>
        row.kind === "message" && row.message.role === "assistant",
    );

    expect(assistantRow?.showAssistantMeta).toBe(false);
    expect(assistantRow?.showAssistantCopyButton).toBe(false);
  });

  it("models work log overflow expansion as inserted list rows", () => {
    const timelineEntries = [
      {
        id: "work-entry-1",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:01Z",
        entry: {
          id: "work-1",
          createdAt: "2026-01-01T00:00:01Z",
          label: "read",
          detail: "Reading package.json",
          tone: "tool" as const,
        },
      },
      {
        id: "work-entry-2",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:02Z",
        entry: {
          id: "work-2",
          createdAt: "2026-01-01T00:00:02Z",
          label: "edit",
          detail: "Editing MessagesTimeline.tsx",
          tone: "tool" as const,
        },
      },
      {
        id: "work-entry-3",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:03Z",
        entry: {
          id: "work-3",
          createdAt: "2026-01-01T00:00:03Z",
          label: "test",
          detail: "Running tests",
          tone: "tool" as const,
        },
      },
    ];

    const baseInput = {
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    };
    const collapsedRows = deriveMessagesTimelineRows(baseInput);
    const expandedRows = deriveMessagesTimelineRows({
      ...baseInput,
      expandedWorkGroupIds: new Set(["work-group:work-entry-1"]),
    });

    expect(collapsedRows.map((row) => row.id)).toEqual(["work-toggle:work-entry-1"]);
    expect(collapsedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      groupId: "work-group:work-entry-1",
      hiddenCount: 3,
      expanded: false,
      onlyToolEntries: true,
      summary: "Used 3 tools",
    });
    expect(expandedRows.map((row) => row.id)).toEqual([
      "work-toggle:work-entry-1",
      "work-1",
      "work-2",
      "work-3",
    ]);
    expect(expandedRows.find((row) => row.kind === "work-toggle")).toMatchObject({
      expanded: true,
    });
  });

  it.each([
    ["recovered", ["failed", "completed"], false],
    ["ending in failure", ["completed", "failed"], true],
    ["failed", ["failed", "failed"], true],
  ] as const)("uses the final call for %s tool groups", (_, statuses, hasFailure) => {
    const timelineEntries = statuses.map((status, index) => ({
      id: `work-entry-${index}`,
      kind: "work" as const,
      createdAt: `2026-01-01T00:00:0${index}Z`,
      entry: {
        id: `work-${index}`,
        createdAt: `2026-01-01T00:00:0${index}Z`,
        label: "Ran command",
        tone: "tool" as const,
        itemType: "command_execution" as const,
        toolLifecycleStatus: status,
      },
    }));

    const rows = deriveMessagesTimelineRows({
      timelineEntries,
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({
      hiddenCount: 2,
      hasFailure,
    });
  });

  it.each([
    ["the later success is hidden", ["failed", "completed", "info"], false],
    ["the later success is visible", ["failed", "info", "completed"], false],
    ["an error-toned entry recovers", ["error", "info", "completed"], false],
    ["the final failure is hidden", ["completed", "failed", "info"], true],
    ["the final failure is visible", ["failed", "info", "failed"], true],
    ["the only failure is visible", ["completed", "info", "failed"], false],
  ] as const)(
    "uses the final tool call for mixed work groups when %s",
    (_, statuses, hasFailure) => {
      const timelineEntries = statuses.map((status, index) => {
        const id = `work-${index}`;
        const createdAt = `2026-01-01T00:00:0${index}Z`;

        return {
          id: `work-entry-${index}`,
          kind: "work" as const,
          createdAt,
          entry:
            status === "info"
              ? { id, createdAt, label: "Status updated", tone: "info" as const }
              : status === "error"
                ? { id, createdAt, label: "Command failed", tone: "error" as const }
                : {
                    id,
                    createdAt,
                    label: "Ran command",
                    tone: "tool" as const,
                    toolLifecycleStatus: status,
                  },
        };
      });

      const rows = deriveMessagesTimelineRows({
        timelineEntries,
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

      expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({
        hiddenCount: 2,
        summary: null,
        hasFailure,
      });
    },
  );
});

describe("computeStableMessagesTimelineRows", () => {
  it("returns the previous result when row order and content are unchanged", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      updatedAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(rows, {
      byId: new Map(),
      result: [],
    });

    const repeated = computeStableMessagesTimelineRows(rows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result).toBe(initial.result);
  });

  it("reuses work rows when equivalent timeline derivations create new grouped arrays", () => {
    const firstWorkEntry = {
      id: "work-1",
      createdAt: "2026-01-01T00:00:00Z",
      label: "thinking",
      detail: "Inspecting repository state",
      tone: "thinking" as const,
    };
    const secondWorkEntry = {
      id: "work-2",
      createdAt: "2026-01-01T00:00:01Z",
      label: "read",
      detail: "Reading package.json",
      tone: "tool" as const,
    };

    const createRows = () =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "entry-work-1",
            kind: "work",
            createdAt: firstWorkEntry.createdAt,
            entry: firstWorkEntry,
          },
          {
            id: "entry-work-2",
            kind: "work",
            createdAt: secondWorkEntry.createdAt,
            entry: secondWorkEntry,
          },
        ],
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows();
    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });
    const secondRows = createRows();

    expect(secondRows[0]).not.toBe(firstRows[0]);

    const repeated = computeStableMessagesTimelineRows(secondRows, initial);

    expect(repeated).toBe(initial);
    expect(repeated.result[0]).toBe(initial.result[0]);
  });

  it("returns a new result when row order changes without content changes", () => {
    const firstUserMessage = {
      id: "user-1" as never,
      role: "user" as const,
      text: "First",
      turnId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      streaming: false,
    };
    const secondUserMessage = {
      id: "user-2" as never,
      role: "user" as const,
      text: "Second",
      turnId: null,
      createdAt: "2026-01-01T00:00:10Z",
      updatedAt: "2026-01-01T00:00:10Z",
      streaming: false,
    };

    const firstRows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "entry-user-1",
          kind: "message",
          createdAt: firstUserMessage.createdAt,
          message: firstUserMessage,
        },
        {
          id: "entry-user-2",
          kind: "message",
          createdAt: secondUserMessage.createdAt,
          message: secondUserMessage,
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const initial = computeStableMessagesTimelineRows(firstRows, {
      byId: new Map(),
      result: [],
    });

    const reordered = computeStableMessagesTimelineRows([firstRows[1]!, firstRows[0]!], initial);

    expect(reordered).not.toBe(initial);
    expect(reordered.result).toEqual([initial.result[1], initial.result[0]]);
  });
});
