import {
  classifyTaskAgentKind,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { weatherdashFirstDeploy } from "@t3tools/client-runtime/zerops/operations/fixtures";

import {
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  deriveTurnPlans,
  deriveZeropsOperations,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  workEntryIndicatesToolFailure,
  workEntryIndicatesToolNeutralStatus,
  workEntryIndicatesToolSuccess,
  type TimelineEntry,
  type WorkLogEntry,
} from "./session-logic";

let nextActivityId = 0;

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  // Fixtures model post-ingestion rows: ingestion stamps agentKind on every
  // task.* payload. Pass an explicit agentKind to model legacy rows.
  const rawPayload = overrides.payload ?? {};
  const payload =
    overrides.kind?.startsWith("task.") && !("agentKind" in rawPayload)
      ? {
          ...rawPayload,
          agentKind: classifyTaskAgentKind({
            taskType: typeof rawPayload.taskType === "string" ? rawPayload.taskType : undefined,
            agentId: typeof rawPayload.agentId === "string" ? rawPayload.agentId : undefined,
          }),
        }
      : rawPayload;
  return {
    id: EventId.make(overrides.id ?? `activity-${nextActivityId++}`),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload,
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("derivePendingApprovals", () => {
  it("tracks open approvals and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-1",
          requestKind: "command",
          detail: "bun run lint",
        },
      }),
      makeActivity({
        id: "approval-close",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "approval.resolved",
        summary: "Approval resolved",
        tone: "info",
        payload: { requestId: "req-2" },
      }),
      makeActivity({
        id: "approval-closed-request",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "approval.requested",
        summary: "File-change approval requested",
        tone: "approval",
        payload: { requestId: "req-2", requestKind: "file-change" },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-1",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "bun run lint",
      },
    ]);
  });

  it("maps canonical requestType payloads into pending approvals", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-request-type",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-request-type",
          requestType: "command_execution_approval",
          detail: "pwd",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-request-type",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "pwd",
      },
    ]);
  });

  it("keeps app access approvals and persistence choices from remote activities", () => {
    const options = [
      { decision: "decline", label: "Decline" },
      { decision: "acceptAlways", label: "Always allow Safari" },
      { decision: "accept", label: "Approve" },
    ];
    const activities = [
      makeActivity({
        kind: "approval.requested",
        summary: "App access approval requested",
        tone: "approval",
        payload: {
          requestId: "req-safari",
          requestType: "mcp_elicitation_approval",
          detail: "Allow ChatGPT to use Safari?",
          appName: "Safari",
          options,
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-safari",
        requestKind: "mcp-elicitation",
        createdAt: "2026-02-23T00:00:00.000Z",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    ]);
  });

  it("derives dynamic tool requests as actionable generic approvals", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-dynamic-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Approval requested",
        tone: "approval",
        payload: {
          requestId: "req-dynamic-tool",
          requestType: "dynamic_tool_call",
          detail: "Search the web",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([
      {
        requestId: "req-dynamic-tool",
        requestKind: "command",
        createdAt: "2026-02-23T00:00:01.000Z",
        detail: "Search the web",
      },
    ]);
  });

  it("clears stale pending approvals when provider reports unknown pending request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-1",
          detail: "Unknown pending permission request: req-stale-1",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });

  it("clears stale pending approvals when the backend marks them stale after restart", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "approval-open-stale-restart",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "approval.requested",
        summary: "Command approval requested",
        tone: "approval",
        payload: {
          requestId: "req-stale-restart-1",
          requestKind: "command",
        },
      }),
      makeActivity({
        id: "approval-failed-stale-restart",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        tone: "error",
        payload: {
          requestId: "req-stale-restart-1",
          detail:
            "Stale pending approval request: req-stale-restart-1. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.",
        },
      }),
    ];

    expect(derivePendingApprovals(activities)).toEqual([]);
  });
});

describe("derivePendingUserInputs", () => {
  it("tracks open structured prompts and removes resolved ones", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "workspace-write",
                  description: "Allow workspace writes only",
                },
              ],
              multiSelect: true,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-resolved",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "user-input.resolved",
        summary: "User input submitted",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          answers: {
            sandbox_mode: "workspace-write",
          },
        },
      }),
      makeActivity({
        id: "user-input-open-2",
        createdAt: "2026-02-23T00:00:01.500Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-2",
          questions: [
            {
              id: "approval",
              header: "Approval",
              question: "Continue?",
              options: [
                {
                  label: "yes",
                  description: "Continue execution",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([
      {
        requestId: "req-user-input-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        questions: [
          {
            id: "sandbox_mode",
            header: "Sandbox",
            question: "Which mode should be used?",
            options: [
              {
                label: "workspace-write",
                description: "Allow workspace writes only",
              },
            ],
            multiSelect: true,
          },
        ],
      },
    ]);
  });

  it("clears stale pending user-input prompts when the provider reports an orphaned request", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "user-input-open-stale",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "user-input.requested",
        summary: "User input requested",
        tone: "info",
        payload: {
          requestId: "req-user-input-stale-1",
          questions: [
            {
              id: "sandbox_mode",
              header: "Sandbox",
              question: "Which mode should be used?",
              options: [
                {
                  label: "workspace-write",
                  description: "Allow workspace writes only",
                },
              ],
              multiSelect: false,
            },
          ],
        },
      }),
      makeActivity({
        id: "user-input-failed-stale",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "provider.user-input.respond.failed",
        summary: "Provider user input response failed",
        tone: "error",
        payload: {
          requestId: "req-user-input-stale-1",
          detail:
            "Provider adapter request failed (codex) for item/tool/requestUserInput: Unknown pending Codex user input request: req-user-input-stale-1",
        },
      }),
    ];

    expect(derivePendingUserInputs(activities)).toEqual([]);
  });
});

describe("deriveActivePlanState", () => {
  it("returns the latest plan update for the active turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-old",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Initial plan",
          plan: [{ step: "Inspect code", status: "pending" }],
        },
      }),
      makeActivity({
        id: "plan-latest",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          explanation: "Refined plan",
          plan: [{ step: "Implement Codex user input", status: "inProgress" }],
        },
      }),
    ];

    expect(deriveActivePlanState(activities, TurnId.make("turn-1"))).toEqual({
      createdAt: "2026-02-23T00:00:02.000Z",
      turnId: "turn-1",
      explanation: "Refined plan",
      steps: [{ step: "Implement Codex user input", status: "inProgress" }],
    });
  });

  it("falls back to the most recent plan from a previous turn", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-from-turn-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [{ step: "Write tests", status: "completed" }],
        },
      }),
    ];

    // Current turn is turn-2, which has no plan activity — should fall back to turn-1's plan
    const result = deriveActivePlanState(activities, TurnId.make("turn-2"));
    expect(result).toEqual({
      createdAt: "2026-02-23T00:00:01.000Z",
      turnId: "turn-1",
      steps: [{ step: "Write tests", status: "completed" }],
    });
  });

  it("starts timing again after a plan is cleared and recreated", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-old-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [{ step: "Check", status: "inProgress" }] },
      }),
      makeActivity({
        id: "plan-old-complete",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [{ step: "Check", status: "completed" }] },
      }),
      makeActivity({
        id: "plan-clear",
        createdAt: "2026-02-23T00:00:06.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [] },
      }),
      makeActivity({
        id: "plan-new-start",
        createdAt: "2026-02-23T00:00:10.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [{ step: "Check", status: "inProgress" }] },
      }),
      makeActivity({
        id: "plan-new-complete",
        createdAt: "2026-02-23T00:00:13.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [{ step: "Check", status: "completed" }] },
      }),
    ];

    expect(deriveActivePlanState(activities, TurnId.make("turn-1"))?.steps).toEqual([
      { durationMs: 3_000, step: "Check", status: "completed" },
    ]);
  });
});

describe("deriveTurnPlans", () => {
  it("keeps one entry per turn, anchored at the first snapshot with the latest steps", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-1a",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [{ step: "Inspect code", status: "inProgress" }],
        },
      }),
      makeActivity({
        id: "plan-1b",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [{ step: "Inspect code", status: "completed" }],
        },
      }),
      makeActivity({
        id: "plan-2a",
        createdAt: "2026-02-23T00:01:00.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-2",
        payload: {
          plan: [{ step: "Ship it", status: "pending" }],
        },
      }),
    ];

    const turnPlans = deriveTurnPlans(activities);
    expect(turnPlans).toHaveLength(2);
    expect(turnPlans[0]).toMatchObject({
      id: "turn-plan:turn-1",
      createdAt: "2026-02-23T00:00:01.000Z",
      turnId: "turn-1",
    });
    expect(turnPlans[0]?.plan.steps).toEqual([
      { durationMs: 4_000, step: "Inspect code", status: "completed" },
    ]);
    expect(turnPlans[1]?.plan.steps).toEqual([{ step: "Ship it", status: "pending" }]);
  });

  it("skips activities without parseable steps", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-bad",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [] },
      }),
    ];
    expect(deriveTurnPlans(activities)).toEqual([]);
  });

  it("tracks repeated step labels independently", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-1a",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [
            { step: "Check", status: "inProgress" },
            { step: "Check", status: "pending" },
          ],
        },
      }),
      makeActivity({
        id: "plan-1b",
        createdAt: "2026-02-23T00:00:05.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [
            { step: "Check", status: "completed" },
            { step: "Check", status: "inProgress" },
          ],
        },
      }),
      makeActivity({
        id: "plan-1c",
        createdAt: "2026-02-23T00:00:11.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [
            { step: "Check", status: "completed" },
            { step: "Check", status: "completed" },
          ],
        },
      }),
    ];

    expect(deriveTurnPlans(activities)[0]?.plan.steps).toEqual([
      { durationMs: 4_000, step: "Check", status: "completed" },
      { durationMs: 6_000, step: "Check", status: "completed" },
    ]);
  });

  it("derives fallback durations in completion order", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [
            { step: "First", status: "pending" },
            { step: "Second", status: "pending" },
          ],
        },
      }),
      makeActivity({
        id: "plan-second-complete",
        createdAt: "2026-02-23T00:00:06.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [
            { step: "First", status: "pending" },
            { step: "Second", status: "completed" },
          ],
        },
      }),
      makeActivity({
        id: "plan-first-complete",
        createdAt: "2026-02-23T00:00:11.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: {
          plan: [
            { step: "First", status: "completed" },
            { step: "Second", status: "completed" },
          ],
        },
      }),
    ];

    expect(deriveTurnPlans(activities)[0]?.plan.steps).toEqual([
      { durationMs: 5_000, step: "First", status: "completed" },
      { durationMs: 5_000, step: "Second", status: "completed" },
    ]);
  });

  it("drops a turn's chip when a later snapshot clears the plan", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "plan-set",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [{ step: "Inspect code", status: "inProgress" }] },
      }),
      makeActivity({
        id: "plan-clear",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        tone: "info",
        turnId: "turn-1",
        payload: { plan: [] },
      }),
    ];
    expect(deriveTurnPlans(activities)).toEqual([]);
  });
});

describe("findLatestProposedPlan", () => {
  it("prefers the latest proposed plan for the active turn", () => {
    expect(
      findLatestProposedPlan(
        [
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "# Older",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:01.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-1",
            turnId: TurnId.make("turn-1"),
            planMarkdown: "# Latest",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:01.000Z",
            updatedAt: "2026-02-23T00:00:02.000Z",
          },
          {
            id: "plan:thread-1:turn:turn-2",
            turnId: TurnId.make("turn-2"),
            planMarkdown: "# Different turn",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-02-23T00:00:03.000Z",
            updatedAt: "2026-02-23T00:00:03.000Z",
          },
        ],
        TurnId.make("turn-1"),
      ),
    ).toEqual({
      id: "plan:thread-1:turn:turn-1",
      turnId: "turn-1",
      planMarkdown: "# Latest",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: "2026-02-23T00:00:01.000Z",
      updatedAt: "2026-02-23T00:00:02.000Z",
    });
  });

  it("falls back to the most recently updated proposed plan", () => {
    const latestPlan = findLatestProposedPlan(
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# First",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:01.000Z",
          updatedAt: "2026-02-23T00:00:01.000Z",
        },
        {
          id: "plan:thread-1:turn:turn-2",
          turnId: TurnId.make("turn-2"),
          planMarkdown: "# Latest",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:03.000Z",
        },
      ],
      null,
    );

    expect(latestPlan?.planMarkdown).toBe("# Latest");
  });
});

describe("hasActionableProposedPlan", () => {
  it("returns true for an unimplemented proposed plan", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:01.000Z",
      }),
    ).toBe(true);
  });

  it("returns false for a proposed plan already implemented elsewhere", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: "2026-02-23T00:00:02.000Z",
        implementationThreadId: ThreadId.make("thread-implement"),
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:02.000Z",
      }),
    ).toBe(false);
  });
});

describe("workEntryIndicatesToolFailure", () => {
  const base = {
    id: "w1",
    createdAt: "2026-01-01T00:00:00.000Z",
    label: "Read",
  };

  it("is true for error tone", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "error",
        detail: "nothing special",
      }),
    ).toBe(true);
  });

  it("is true when lifecycle says failed even if detail is empty", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "failed",
      }),
    ).toBe(true);
  });

  it("detects file-not-found style tool output with completed lifecycle", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "File not found: C:\\foo\\nonexistent.ts",
      }),
    ).toBe(true);
  });

  it("detects glob no files and PowerShell command errors", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Glob",
        tone: "tool",
        detail: "No files found",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Bash",
        tone: "tool",
        detail:
          "The term 'this_is_not_a_command' is not recognized as the name of a cmdlet, function, script file, or operable program.",
      }),
    ).toBe(true);
  });

  it("is false for successful completed tools", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "Found 3 matching files",
      }),
    ).toBe(false);
  });

  it("treats successful tool rows as success candidates", () => {
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "ok",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        detail: "…",
      }),
    ).toBe(false);
    expect(workEntryIndicatesToolSuccess({ ...base, tone: "thinking", detail: "…" })).toBe(false);
    expect(
      workEntryIndicatesToolNeutralStatus({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        detail: "…",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolNeutralStatus({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "ok",
      }),
    ).toBe(false);
  });

  it("does not run heuristics on non-tool info rows", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Context compacted",
        tone: "info",
        detail: "File not found in conversation",
      }),
    ).toBe(false);
  });
});

describe("deriveWorkLogEntries", () => {
  it("omits tool started entries and keeps completed entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "tool-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Tool call",
        kind: "tool.started",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("drops runtime warnings with no displayable content, keeps ones with a preview", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "warning-noise",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Claude system message 'background_tasks_changed' (no displayable text content)",
        tone: "info",
      }),
      makeActivity({
        id: "warning-signal",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Reconnecting... 2/5",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["warning-signal"]);
  });

  it("omits task.started but shows task.progress and task.completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "default task started",
        tone: "info",
      }),
      makeActivity({
        id: "task-progress",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Updating files",
        tone: "info",
      }),
      makeActivity({
        id: "task-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task completed",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["task-progress", "task-complete"]);
  });

  it("uses payload summary as label for task entries when available", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-progress-with-summary",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Reasoning update",
        tone: "info",
        payload: { summary: "Searching for API endpoints" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries[0]?.label).toBe("Searching for API endpoints");
  });

  it("uses payload detail as label for task.completed and preserves error tone", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-completed-failed",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task failed",
        tone: "error",
        payload: { detail: "Failed to deploy changes" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries[0]?.label).toBe("Failed to deploy changes");
    expect(entries[0]?.tone).toBe("error");
  });

  it("keeps tool entries from every turn and tags each with its turn id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "turn-1-tool",
        turnId: "turn-1",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "turn-2-tool",
        turnId: "turn-2",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["turn-1-tool", "turn-2-tool"]);
    expect(entries.map((entry) => entry.turnId)).toEqual([
      TurnId.make("turn-1"),
      TurnId.make("turn-2"),
    ]);
  });

  it("omits checkpoint captured info entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "checkpoint",
        createdAt: "2026-02-23T00:00:01.000Z",
        summary: "Checkpoint captured",
        tone: "info",
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Ran command",
        tone: "tool",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("omits ExitPlanMode lifecycle entries once the plan card is shown", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "exit-plan-updated",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          detail: 'ExitPlanMode: {"allowedPrompts":[{"tool":"Bash","prompt":"run tests"}]}',
        },
      }),
      makeActivity({
        id: "exit-plan-completed",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          detail: "ExitPlanMode: {}",
        },
      }),
      makeActivity({
        id: "real-work-log",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail: "Bash: bun test",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["real-work-log"]);
  });

  it("orders work log by activity sequence when present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "second",
        createdAt: "2026-02-23T00:00:03.000Z",
        sequence: 2,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "first",
        createdAt: "2026-02-23T00:00:04.000Z",
        sequence: 1,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("extracts command text for command tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["bun", "run", "lint"],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("bun run lint");
  });

  it("extracts failed tool lifecycle status from item payloads", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-failed",
        kind: "tool.updated",
        summary: "Glob",
        tone: "tool",
        payload: {
          itemType: "mcp_tool_call",
          status: "failed",
          detail: "No files found",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolLifecycleStatus).toBe("failed");
  });

  it("defaults tool.completed entries to completed lifecycle status", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-done",
        kind: "tool.completed",
        summary: "Glob",
        tone: "tool",
        payload: {
          itemType: "mcp_tool_call",
          detail: "Found 3 files",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolLifecycleStatus).toBe("completed");
  });

  it("preserves MCP server, tool, arguments, and results for expanded display", () => {
    const item = {
      type: "mcpToolCall",
      server: "t3-code",
      tool: "preview_status",
      arguments: {},
      status: "completed",
      result: { content: [{ type: "text", text: "attached" }] },
    };
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "mcp-tool-done",
        kind: "tool.completed",
        summary: "t3-code · preview_status",
        payload: {
          itemType: "mcp_tool_call",
          title: "t3-code · preview_status",
          data: { item },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolTitle).toBe("t3-code · preview_status");
    expect(entry?.toolData).toEqual(item);
  });

  it("keeps MCP payloads while collapsing lifecycle updates", () => {
    const item = {
      type: "mcpToolCall",
      server: "t3-code",
      tool: "preview_snapshot",
      arguments: { interactiveOnly: true },
      status: "completed",
    };
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "mcp-tool-progress",
        kind: "tool.updated",
        summary: "t3-code · preview_snapshot",
        payload: {
          itemType: "mcp_tool_call",
          toolCallId: "call-1",
          data: { item },
        },
      }),
      makeActivity({
        id: "mcp-tool-complete",
        kind: "tool.completed",
        summary: "t3-code · preview_snapshot",
        payload: {
          itemType: "mcp_tool_call",
          toolCallId: "call-1",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolData).toEqual(item);
    expect(entry?.toolCallId).toBe("call-1");
  });

  /**
   * Claude's `mcp_tool_call` projection carries no `item` at all — its
   * arguments are the flat `data.input` record (`ActivityPayloadProjection.ts`
   * `projectMcpToolCallData`, proven by the same file's own tests). Without
   * `toolInput`, a pending `zerops_deploy` call from Claude has no readable
   * target hostname anywhere on the entry.
   */
  it("captures a Claude-shaped mcp_tool_call's flat input as toolInput while the call is still running", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "claude-deploy-updated",
        kind: "tool.updated",
        summary: "zerops_deploy",
        payload: {
          itemType: "mcp_tool_call",
          status: "inProgress",
          toolCallId: "call-claude-deploy",
          data: { toolName: "mcp__zerops__zerops_deploy", input: { targetService: "kanbandev" } },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolLifecycleStatus).toBe("inProgress");
    expect(entry?.toolInput).toEqual({ targetService: "kanbandev" });
    expect(entry?.toolData).toBeUndefined();
  });

  it("prefers a Codex-shaped item over toolInput when both would be present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "codex-deploy",
        kind: "tool.completed",
        summary: "zerops_deploy",
        payload: {
          itemType: "mcp_tool_call",
          data: { item: { input: { targetService: "kanbandev" } } },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolData).toEqual({ input: { targetService: "kanbandev" } });
    expect(entry?.toolInput).toBeUndefined();
  });

  /**
   * `createdAt` moves to the newest activity's own timestamp on every merge
   * (right for "last updated"); `startedAt` must stay pinned to the FIRST
   * observation so the platform-activity overlay's attribution window starts
   * at the real call start, not at whenever the call happened to finish.
   */
  it("keeps startedAt pinned to the first observation across a started-then-completed merge", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "deploy-updated",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "zerops_deploy",
        payload: {
          itemType: "mcp_tool_call",
          status: "inProgress",
          toolCallId: "call-timing",
          data: { toolName: "mcp__zerops__zerops_deploy", input: { targetService: "kanbandev" } },
        },
      }),
      makeActivity({
        id: "deploy-completed",
        createdAt: "2026-02-23T00:00:09.000Z",
        kind: "tool.completed",
        summary: "zerops_deploy",
        payload: {
          itemType: "mcp_tool_call",
          toolCallId: "call-timing",
          data: {
            toolName: "mcp__zerops__zerops_deploy",
            zerops: { toolName: "zerops_deploy", resultText: '{"status":"DEPLOYED"}' },
          },
        },
      }),
    ];

    // A Zerops call keeps its anchor: id/createdAt stay pinned to the FIRST
    // lifecycle activity, not the latest — unlike an ordinary tool merge.
    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.id).toBe("deploy-updated");
    expect(entry?.createdAt).toBe("2026-02-23T00:00:02.000Z");
    expect(entry?.startedAt).toBe("2026-02-23T00:00:02.000Z");
    expect(entry?.updatedAt).toBe("2026-02-23T00:00:09.000Z");
  });

  it("collapses interleaved lifecycle updates by tool call id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-a-progress",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-1",
        kind: "tool.updated",
        summary: "Tool A",
        payload: {
          itemType: "command_execution",
          toolCallId: "call-a",
          status: "inProgress",
          data: { command: "vp test run" },
        },
      }),
      makeActivity({
        id: "tool-b-progress",
        createdAt: "2026-02-23T00:00:02.000Z",
        turnId: "turn-1",
        kind: "tool.updated",
        summary: "Tool B",
        payload: {
          itemType: "command_execution",
          toolCallId: "call-b",
          status: "inProgress",
          data: { command: "vp lint" },
        },
      }),
      makeActivity({
        id: "tool-a-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        turnId: "turn-1",
        kind: "tool.completed",
        summary: "Tool A completed",
        payload: {
          itemType: "command_execution",
          toolCallId: "call-a",
          status: "completed",
        },
      }),
      makeActivity({
        id: "tool-b-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        turnId: "turn-1",
        kind: "tool.completed",
        summary: "Tool B completed",
        payload: {
          itemType: "command_execution",
          toolCallId: "call-b",
          status: "completed",
        },
      }),
    ];

    expect(deriveWorkLogEntries(activities)).toMatchObject([
      {
        id: "tool-a-complete",
        command: "vp test run",
        toolCallId: "call-a",
        toolLifecycleStatus: "completed",
      },
      {
        id: "tool-b-complete",
        command: "vp lint",
        toolCallId: "call-b",
        toolLifecycleStatus: "completed",
      },
    ]);
  });

  it("does not merge reused tool call ids across turns", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "turn-1-tool",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-1",
        kind: "tool.updated",
        summary: "Tool",
        payload: {
          itemType: "command_execution",
          toolCallId: "reused-call",
          status: "inProgress",
        },
      }),
      makeActivity({
        id: "turn-2-tool",
        createdAt: "2026-02-23T00:00:02.000Z",
        turnId: "turn-2",
        kind: "tool.completed",
        summary: "Tool completed",
        payload: {
          itemType: "command_execution",
          toolCallId: "reused-call",
          status: "completed",
        },
      }),
    ];

    expect(deriveWorkLogEntries(activities)).toHaveLength(2);
  });

  it("unwraps PowerShell command wrappers for displayed command text", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("bun run lint");
    expect(entry?.rawCommand).toBe(
      "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
    );
  });

  it("unwraps PowerShell command wrappers from argv-style command payloads", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper-argv",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-Command", "rg -n foo ."],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("rg -n foo .");
    expect(entry?.rawCommand).toBe(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n foo ."',
    );
  });

  it("extracts command text from command detail when structured command metadata is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-detail-fallback",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail:
            '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command \'rg -n -F "new Date()" .\' <exited with exit code 0>',
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe('rg -n -F "new Date()" .');
    expect(entry?.rawCommand).toBe(
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command 'rg -n -F "new Date()" .'`,
    );
  });

  it("does not unwrap shell commands when no wrapper flag is present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-shell-script",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "bash script.sh",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("bash script.sh");
    expect(entry?.rawCommand).toBeUndefined();
  });

  it("keeps compact Codex tool metadata used for icons and labels", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-with-metadata",
        kind: "tool.completed",
        summary: "bash",
        payload: {
          itemType: "command_execution",
          title: "bash",
          status: "completed",
          detail: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
          data: {
            item: {
              command: ["bun", "run", "dev"],
              result: {
                content: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
                exitCode: 0,
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry).toMatchObject({
      command: "bun run dev",
      detail: '{ "dev": "vite dev --port 3000" }',
      itemType: "command_execution",
      toolTitle: "bash",
    });
  });

  it("extracts changed file paths for file-change tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "file-tool",
        kind: "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          data: {
            item: {
              changes: [
                { path: "apps/web/src/components/ChatView.tsx" },
                { filename: "apps/web/src/session-logic.ts" },
              ],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.changedFiles).toEqual([
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/session-logic.ts",
    ]);
  });

  it("drops duplicated tool detail when it only repeats the title", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-file-generic",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolTitle).toBe("Read File");
    expect(entry?.detail).toBeUndefined();
  });

  it("uses grep raw output summaries instead of repeating the generic tool label", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "grep-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "grep",
        payload: {
          itemType: "web_search",
          title: "grep",
          detail: "grep",
          data: {
            toolCallId: "tool-grep-1",
            kind: "search",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "grep-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "grep",
        payload: {
          itemType: "web_search",
          title: "grep",
          detail: "grep",
          data: {
            toolCallId: "tool-grep-1",
            kind: "search",
            rawOutput: {
              totalFiles: 19,
              truncated: false,
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "grep-complete",
      toolTitle: "grep",
      detail: "19 files",
      itemType: "web_search",
    });
  });

  it("uses completed read-file output previews and still collapses the same tool call", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-1",
            kind: "read",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "read-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-1",
            kind: "read",
            rawOutput: {
              content:
                'import * as Effect from "effect/Effect"\nimport * as Layer from "effect/Layer"\n',
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "read-complete",
      toolTitle: "Read File",
      detail: 'import * as Effect from "effect/Effect"',
      itemType: "dynamic_tool_call",
    });
  });

  it("does not use command stdout as the detail when Cursor omits the command input", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "cursor-command-complete",
        createdAt: "2026-04-16T22:40:42.221Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          data: {
            toolCallId: "toolu_vrtx_01WypXgRM8PPygBtrVAZwzy5",
            kind: "execute",
            rawInput: {},
            rawOutput: {
              exitCode: 0,
              stdout: "total 960\napps\npackages\n",
              stderr: "",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry).toMatchObject({
      id: "cursor-command-complete",
      label: "Ran command",
      itemType: "command_execution",
      toolTitle: "Ran command",
    });
    expect(entry?.detail).toBeUndefined();
    expect(entry?.command).toBeUndefined();
  });

  it("collapses legacy completed tool rows that are missing tool metadata", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "legacy-read-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-legacy",
            kind: "read",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "legacy-read-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "legacy-read-complete",
      toolTitle: "Read File",
      itemType: "dynamic_tool_call",
    });
    expect(entries[0]?.detail).toBeUndefined();
  });

  it("collapses repeated lifecycle updates for the same tool call into one entry", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-update-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-update-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
          data: {
            item: {
              command: ["sed", "-n", "1,40p", "/tmp/app.ts"],
            },
          },
        },
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "tool-complete",
      createdAt: "2026-02-23T00:00:03.000Z",
      label: "Tool call completed",
      detail: 'Read: {"file_path":"/tmp/app.ts"}',
      command: "sed -n 1,40p /tmp/app.ts",
      itemType: "dynamic_tool_call",
      toolTitle: "Tool call",
    });
  });

  it("keeps separate tool entries when an identical call starts after the prior one completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-1-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-1-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-update",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);

    expect(entries.map((entry) => entry.id)).toEqual(["tool-1-complete", "tool-2-complete"]);
  });

  it("collapses same-timestamp lifecycle rows even when completed sorts before updated by id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "z-update-earlier",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "a-complete-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "z-update-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("a-complete-same-timestamp");
  });
});

describe("deriveTimelineEntries", () => {
  it("includes proposed plans alongside messages and work entries in chronological order", () => {
    const entries = deriveTimelineEntries(
      [
        {
          id: MessageId.make("message-1"),
          role: "assistant",
          text: "hello",
          createdAt: "2026-02-23T00:00:01.000Z",
          turnId: null,
          updatedAt: "2026-02-23T00:00:01.000Z",
          streaming: false,
        },
      ],
      [
        {
          id: "plan:thread-1:turn:turn-1",
          turnId: TurnId.make("turn-1"),
          planMarkdown: "# Ship it",
          implementedAt: null,
          implementationThreadId: null,
          createdAt: "2026-02-23T00:00:02.000Z",
          updatedAt: "2026-02-23T00:00:02.000Z",
        },
      ],
      [
        {
          id: "work-1",
          createdAt: "2026-02-23T00:00:03.000Z",
          label: "Ran tests",
          tone: "tool",
        },
      ],
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["message", "proposed-plan", "work"]);
    expect(entries[1]).toMatchObject({
      kind: "proposed-plan",
      proposedPlan: {
        planMarkdown: "# Ship it",
        implementedAt: null,
        implementationThreadId: null,
      },
    });
  });
});

describe("deriveWorkLogEntries context window handling", () => {
  it("excludes context window updates from the work log", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "context-1",
        turnId: "turn-1",
        kind: "context-window.updated",
        summary: "Context window updated",
        tone: "info",
      }),
      makeActivity({
        id: "tool-1",
        turnId: "turn-1",
        kind: "tool.completed",
        summary: "Ran command",
        tone: "tool",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Ran command");
  });

  it("keeps context compaction activities as normal work log entries", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "compaction-1",
        turnId: "turn-1",
        kind: "context-compaction",
        summary: "Context compacted",
        tone: "info",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Context compacted");
  });
});

describe("deriveActiveWorkStartedAt", () => {
  const latestTurn = {
    turnId: TurnId.make("turn-1"),
    startedAt: "2026-02-27T21:10:00.000Z",
    completedAt: "2026-02-27T21:10:06.000Z",
  } as const;

  it("prefers the in-flight turn start when the latest turn is not settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          status: "running",
          activeTurnId: TurnId.make("turn-1"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:10:00.000Z");
  });

  it("uses the new send start while the session is running a different turn", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          status: "running",
          activeTurnId: TurnId.make("turn-2"),
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("falls back to the latest user message while a running turn is being acknowledged", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          status: "running",
          activeTurnId: TurnId.make("turn-2"),
        },
        null,
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("falls back to sendStartedAt once the latest turn is settled", () => {
    expect(
      deriveActiveWorkStartedAt(
        latestTurn,
        {
          status: "ready",
          activeTurnId: null,
        },
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });

  it("uses sendStartedAt for a fresh send after the prior turn completed", () => {
    expect(
      deriveActiveWorkStartedAt(
        {
          turnId: TurnId.make("turn-1"),
          startedAt: "2026-02-27T21:10:00.000Z",
          completedAt: "2026-02-27T21:10:06.000Z",
        },
        null,
        "2026-02-27T21:11:00.000Z",
      ),
    ).toBe("2026-02-27T21:11:00.000Z");
  });
});

describe("deriveWorkLogEntries quiet-timeline guarantee", () => {
  it("N concurrent subagents produce exactly N lifecycle rows, zero attributed tool rows", () => {
    const activities: OrchestrationThreadActivity[] = [];
    for (let agent = 0; agent < 5; agent += 1) {
      const taskId = `task-${agent}`;
      // Progress ticks (several per agent) + attributed tool rows.
      for (let tick = 0; tick < 4; tick += 1) {
        activities.push(
          makeActivity({
            kind: "task.progress",
            summary: `agent ${agent} tick ${tick}`,
            tone: "info",
            payload: { taskId, summary: `working ${tick}`, role: "explorer" },
            turnId: "turn-batch",
            sequence: agent * 20 + tick,
          }),
        );
        activities.push(
          makeActivity({
            kind: "tool.completed",
            summary: "Read",
            payload: { itemType: "dynamic_tool_call", agentId: taskId },
            sequence: agent * 20 + 10 + tick,
          }),
        );
      }
      activities.push(
        makeActivity({
          kind: "task.completed",
          summary: "Task completed",
          tone: "info",
          payload: {
            taskId,
            status: "completed",
            summary: `agent ${agent} done`,
            role: "explorer",
          },
          turnId: "turn-batch",
          sequence: agent * 20 + 19,
        }),
      );
    }

    const entries = deriveWorkLogEntries(activities);
    // A1 CTA design: all direct spawns in one turn collapse into ONE
    // call-to-action row carrying the batch's agent ids.
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows).toHaveLength(1);
    expect(spawnRows[0]!.agentSpawn!.agentTaskIds).toHaveLength(5);
    expect(spawnRows[0]!.agentSpawn!.workflowId).toBeNull();
    // No agent-attributed tool rows leak into the main log.
    expect(entries.some((entry) => entry.sourceActivityKind?.startsWith("tool."))).toBe(false);
  });

  it("a workflow run and its members collapse into one CTA row keyed to the coordinator", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "coordinator",
        tone: "info",
        payload: { taskId: "wf-1", taskType: "local_workflow", workflowName: "math-check" },
        sequence: 1,
      }),
      makeActivity({
        kind: "task.progress",
        summary: "member",
        tone: "info",
        payload: { taskId: "wf-1:wf:0", status: "running", parentAgentId: "wf-1" },
        sequence: 2,
      }),
      makeActivity({
        kind: "task.completed",
        summary: "member done",
        tone: "info",
        payload: { taskId: "wf-1:wf:1", status: "completed", parentAgentId: "wf-1" },
        sequence: 3,
      }),
    ]);
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows).toHaveLength(1);
    expect(spawnRows[0]!.agentSpawn!.workflowId).toBe("wf-1");
    expect(spawnRows[0]!.agentSpawn!.agentTaskIds).toEqual(
      expect.arrayContaining(["wf-1", "wf-1:wf:0", "wf-1:wf:1"]),
    );
  });

  it("keeps unattributed tool rows (over-hiding loses the only signal)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "tool.completed",
        summary: "Bash",
        payload: { itemType: "command_execution", command: "ls" },
      }),
    ]);
    expect(entries).toHaveLength(1);
  });

  it("folds timelineBypass agent rows into one CTA (Codex children, workflow members)", () => {
    // Codex children carry their parent's spawn turn (spawnTurnId stamping),
    // which is what batches a fleet into one CTA.
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "child work",
        tone: "info",
        payload: { taskId: "child-1", timelineBypass: true },
        turnId: "turn-spawn",
      }),
      makeActivity({
        kind: "task.progress",
        summary: "child work again",
        tone: "info",
        payload: { taskId: "child-2", timelineBypass: true },
        turnId: "turn-spawn",
      }),
    ]);
    // Not suppressed outright (a Codex fleet's rows are ALL bypassed and
    // still need a CTA anchor) — but never more than the batch's single row.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.agentSpawn?.agentTaskIds).toEqual(["child-1", "child-2"]);
  });

  it("timelineBypass non-agent rows (background shells) stay suppressed", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "stall",
        tone: "info",
        payload: { taskId: "sh-1", taskType: "local_bash", timelineBypass: true },
      }),
    ]);
    expect(entries).toHaveLength(0);
  });

  it("drops task.updated and tool.progress from the work log (fold input only)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.updated",
        summary: "Task running",
        tone: "info",
        payload: { taskId: "task-1", status: "running" },
      }),
      makeActivity({
        kind: "tool.progress",
        summary: "Read",
        tone: "info",
        payload: { taskId: "task-1", toolName: "Read" },
      }),
    ]);
    expect(entries).toHaveLength(0);
  });
});

describe("rerun workflows", () => {
  it("turn-less direct spawns do not collapse into one global batch", () => {
    // Rows that lost their turn id (defensive path) group per task, so two
    // unrelated turn-less spawns never merge into one immortal CTA.
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.started",
        summary: "Task started",
        payload: { taskId: "loose-1", taskType: "local_agent", role: "a" },
        sequence: 1,
      }),
      makeActivity({
        kind: "task.started",
        summary: "Task started",
        payload: { taskId: "loose-2", taskType: "local_agent", role: "b" },
        sequence: 2,
      }),
    ]);
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows).toHaveLength(2);
    expect(spawnRows.map((row) => row.agentSpawn!.agentTaskIds)).toEqual([
      ["loose-1"],
      ["loose-2"],
    ]);
  });

  it("each workflow run gets its own CTA row (distinct coordinator ids)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "run 1",
        tone: "info",
        payload: { taskId: "wf-run1", taskType: "local_workflow", workflowName: "math-check" },
        turnId: "turn-1",
        sequence: 1,
      }),
      makeActivity({
        kind: "task.completed",
        summary: "run 1 done",
        tone: "info",
        payload: { taskId: "wf-run1", status: "completed", taskType: "local_workflow" },
        turnId: "turn-1",
        sequence: 2,
      }),
      makeActivity({
        kind: "task.progress",
        summary: "run 2",
        tone: "info",
        payload: { taskId: "wf-run2", taskType: "local_workflow", workflowName: "math-check" },
        turnId: "turn-2",
        sequence: 3,
      }),
    ]);
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows.map((row) => row.agentSpawn!.workflowId)).toEqual(["wf-run1", "wf-run2"]);
    expect(spawnRows.map((row) => row.turnId)).toEqual(["turn-1", "turn-2"]);
  });
});

describe("session activity performance", () => {
  it("reuses entries for unchanged activities", () => {
    const activities = ["status", "diff", "log"].map((command, index) =>
      makeActivity({
        id: `stable-tool-${index}`,
        kind: "tool.completed",
        sequence: index,
        payload: {
          itemType: "command_execution",
          data: { toolCallId: `stable-tool-${index}`, item: { command: ["git", command] } },
        },
      }),
    );

    const initialEntries = deriveWorkLogEntries(activities.slice(0, 2));
    const appendedEntries = deriveWorkLogEntries(activities);
    expect(appendedEntries[0]).toBe(initialEntries[0]);
    expect(appendedEntries[1]).toBe(initialEntries[1]);
  });

  it("derives only the appended entry in a large ordered tool activity list", () => {
    let cachedActivityDataReads = 0;
    const activityCount = 20_000;
    const activities = Array.from({ length: activityCount }, (_, index) => {
      const data = {
        toolCallId: `benchmark-tool-${index}`,
        item: { command: ["git", "status"] },
      };
      return makeActivity({
        id: `benchmark-tool-${index}`,
        createdAt: new Date(1_700_000_000_000 + index).toISOString(),
        kind: "tool.completed",
        summary: "Ran command",
        sequence: index,
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          get data() {
            cachedActivityDataReads += 1;
            return data;
          },
        },
      });
    });
    deriveWorkLogEntries(activities);
    cachedActivityDataReads = 0;

    const entries = deriveWorkLogEntries([
      ...activities,
      makeActivity({
        id: "benchmark-tool-appended",
        createdAt: new Date(1_700_000_000_000 + activityCount).toISOString(),
        kind: "tool.completed",
        summary: "Ran command",
        sequence: activityCount,
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          data: {
            toolCallId: "benchmark-tool-appended",
            item: { command: ["git", "diff"] },
          },
        },
      }),
    ]);

    expect(entries).toHaveLength(activityCount + 1);
    expect(cachedActivityDataReads).toBe(0);
  });
});

function activityToolNameForTest(activity: OrchestrationThreadActivity): unknown {
  const payload =
    activity.payload && typeof activity.payload === "object"
      ? (activity.payload as Record<string, unknown>)
      : null;
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  return data?.toolName;
}

describe("deriveWorkLogEntries — hidden Zerops calls never become entries", () => {
  it("skips every ToolSearch/Skill activity in a real captured thread", () => {
    const activities = weatherdashFirstDeploy.activities;
    const hiddenActivityIds = new Set<string>(
      activities
        .filter(
          (activity) =>
            (activity.kind === "tool.updated" || activity.kind === "tool.completed") &&
            (activityToolNameForTest(activity) === "ToolSearch" ||
              activityToolNameForTest(activity) === "Skill"),
        )
        .map((activity) => activity.id),
    );
    expect(hiddenActivityIds.size).toBeGreaterThan(0);

    const entries = deriveWorkLogEntries(activities);

    for (const entry of entries) {
      expect(hiddenActivityIds.has(entry.id)).toBe(false);
    }
  });

  it("skips a hand-built ToolSearch tool.completed activity: no entry's label starts with ToolSearch", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "tool-search-1",
        kind: "tool.completed",
        summary: "ToolSearch: query zerops tools",
        payload: {
          toolCallId: "call-tool-search-1",
          itemType: "dynamic_tool_call",
          status: "completed",
          data: { toolName: "ToolSearch", input: { query: "deploy" } },
        },
      }),
      makeActivity({
        id: "read-file-1",
        kind: "tool.completed",
        summary: "Read package.json",
        payload: {
          toolCallId: "call-read-1",
          itemType: "dynamic_tool_call",
          status: "completed",
          data: { toolName: "Read" },
        },
      }),
    ]);

    expect(entries.some((entry) => entry.label.startsWith("ToolSearch"))).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Read package.json");
  });

  it("skips a hand-built Skill tool.completed activity the same way", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "skill-1",
        kind: "tool.completed",
        summary: "Skill: zerops-onboarding",
        payload: {
          toolCallId: "call-skill-1",
          itemType: "dynamic_tool_call",
          status: "completed",
          data: { toolName: "Skill", input: { skill: "zerops-onboarding" } },
        },
      }),
    ]);

    expect(entries).toHaveLength(0);
  });
});

describe("deriveWorkLogEntries — a Zerops call keeps its anchor", () => {
  it("a zerops_deploy entry's id and createdAt are the FIRST lifecycle activity's, not the latest", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "deploy-started",
        kind: "tool.started",
        createdAt: "2026-02-23T00:00:00.000Z",
        turnId: "turn-1",
        payload: { toolCallId: "call-deploy", itemType: "mcp_tool_call", status: "inProgress" },
      }),
      makeActivity({
        id: "deploy-updated",
        kind: "tool.updated",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-1",
        payload: {
          toolCallId: "call-deploy",
          itemType: "mcp_tool_call",
          status: "inProgress",
          data: { toolName: "mcp__zerops__zerops_deploy", input: { targetService: "weatherdash" } },
        },
      }),
      makeActivity({
        id: "deploy-completed",
        kind: "tool.completed",
        createdAt: "2026-02-23T00:00:42.000Z",
        turnId: "turn-1",
        payload: {
          toolCallId: "call-deploy",
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_deploy",
            zerops: {
              toolName: "zerops_deploy",
              resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
            },
          },
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("deploy-updated");
    expect(entries[0]?.createdAt).toBe("2026-02-23T00:00:01.000Z");
    expect(entries[0]?.updatedAt).toBe("2026-02-23T00:00:42.000Z");
  });

  it("an ordinary (non-Zerops) merge still moves id/createdAt to the newest activity", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "cmd-updated",
        kind: "tool.updated",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: "turn-1",
        payload: {
          toolCallId: "call-cmd",
          itemType: "command_execution",
          status: "inProgress",
          detail: "pnpm test",
        },
      }),
      makeActivity({
        id: "cmd-completed",
        kind: "tool.completed",
        createdAt: "2026-02-23T00:00:05.000Z",
        turnId: "turn-1",
        payload: {
          toolCallId: "call-cmd",
          itemType: "command_execution",
          status: "completed",
          detail: "pnpm test",
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("cmd-completed");
    expect(entries[0]?.createdAt).toBe("2026-02-23T00:00:05.000Z");
    expect(entries[0]?.updatedAt).toBe("2026-02-23T00:00:05.000Z");
  });
});

describe("toDerivedWorkLogEntry — zerops raw-content fallback", () => {
  it("synthesizes zeropsResult from data.result.content when no data.zerops enrichment is present", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "verify-no-enrichment",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-verify-legacy",
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_verify",
            result: {
              content: JSON.stringify({ hostname: "api", status: "healthy", checks: [] }),
            },
          },
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.zeropsResult).toEqual({
      toolName: "zerops_verify",
      resultText: JSON.stringify({ hostname: "api", status: "healthy", checks: [] }),
    });
  });

  it("reads the SDK content-block-array shape too", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "verify-array-content",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-verify-array",
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_verify",
            result: {
              content: [
                { type: "text", text: JSON.stringify({ hostname: "api", status: "healthy" }) },
              ],
            },
          },
        },
      }),
    ]);

    expect(entries[0]?.zeropsResult?.resultText).toBe(
      JSON.stringify({ hostname: "api", status: "healthy" }),
    );
  });

  it("does not synthesize a fallback for prose (not a JSON object)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "verify-prose",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-verify-prose",
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_verify",
            result: { content: "the verify tool is still running" },
          },
        },
      }),
    ]);

    expect(entries[0]?.zeropsResult).toBeUndefined();
  });

  it("does not synthesize a fallback for a non-zerops tool", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "read-file",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-read",
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "Read",
            result: { content: JSON.stringify({ ok: true }) },
          },
        },
      }),
    ]);

    expect(entries[0]?.zeropsResult).toBeUndefined();
  });

  it("prefers the data.zerops enrichment over the raw fallback when both are present", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "verify-both",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-verify-both",
          itemType: "mcp_tool_call",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_verify",
            zerops: { toolName: "zerops_verify", resultText: "enriched" },
            result: { content: JSON.stringify({ hostname: "api" }) },
          },
        },
      }),
    ]);

    expect(entries[0]?.zeropsResult).toEqual({ toolName: "zerops_verify", resultText: "enriched" });
  });
});

describe("deriveZeropsOperations", () => {
  it("adapts a completed zerops_deploy entry into a done deploy operation and consumes it", () => {
    const entries: WorkLogEntry[] = [
      {
        id: "work-deploy-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        startedAt: "2026-02-23T00:00:01.000Z",
        updatedAt: "2026-02-23T00:00:42.000Z",
        turnId: TurnId.make("turn-1"),
        toolCallId: "call-deploy-1",
        label: "Deploy weatherdash",
        tone: "tool",
        toolLifecycleStatus: "completed",
        toolInput: { targetService: "weatherdash" },
        zeropsResult: {
          toolName: "zerops_deploy",
          resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
        },
      },
      {
        id: "work-plain-1",
        createdAt: "2026-02-23T00:00:02.000Z",
        label: "Read package.json",
        tone: "tool",
        toolLifecycleStatus: "completed",
      },
    ];

    const { operations, consumedEntryIds } = deriveZeropsOperations(entries);

    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe("deploy");
    expect(operations[0]?.phase).toBe("done");
    expect(operations[0]?.anchorEntryId).toBe("work-deploy-1");
    expect(operations[0]?.settledAt).toBe("2026-02-23T00:00:42.000Z");
    expect(consumedEntryIds.has("work-deploy-1")).toBe(true);
    expect(consumedEntryIds.has("work-plain-1")).toBe(false);
  });

  it("leaves an inProgress zerops_deploy entry's settledAt undefined", () => {
    const entries: WorkLogEntry[] = [
      {
        id: "work-deploy-running",
        createdAt: "2026-02-23T00:00:01.000Z",
        turnId: null,
        label: "Deploy weatherdash",
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        toolInput: { targetService: "weatherdash" },
        zeropsResult: { toolName: "zerops_deploy" },
      },
    ];

    const { operations } = deriveZeropsOperations(entries);

    expect(operations[0]?.phase).toBe("running");
    expect(operations[0]?.settledAt).toBeUndefined();
  });

  it("adapts nothing for entries with no zeropsResult", () => {
    const entries: WorkLogEntry[] = [
      {
        id: "work-other",
        createdAt: "2026-02-23T00:00:01.000Z",
        label: "Read package.json",
        tone: "tool",
      },
    ];

    expect(deriveZeropsOperations(entries).operations).toHaveLength(0);
  });
});

describe("deriveTimelineEntries — Zerops operations", () => {
  it("drops consumed work entries and inserts operation entries in time order", () => {
    const deployWorkEntry: WorkLogEntry = {
      id: "work-deploy-1",
      createdAt: "2026-02-23T00:00:01.000Z",
      label: "Deploy weatherdash",
      tone: "tool",
      toolLifecycleStatus: "completed",
      zeropsResult: {
        toolName: "zerops_deploy",
        resultText: JSON.stringify({ status: "DEPLOYED", targetService: "weatherdash" }),
      },
    };
    const plainWorkEntry: WorkLogEntry = {
      id: "work-plain-1",
      createdAt: "2026-02-23T00:00:02.000Z",
      label: "Read package.json",
      tone: "tool",
    };
    const workEntries = [deployWorkEntry, plainWorkEntry];
    const operations = deriveZeropsOperations(workEntries);

    const entries = deriveTimelineEntries([], [], workEntries, [], operations);

    expect(entries.map((entry) => entry.kind)).toEqual(["operation", "work"]);
    expect(
      entries.some((entry) => entry.kind === "work" && entry.entry.id === "work-deploy-1"),
    ).toBe(false);
    const operationEntry = entries.find((entry) => entry.kind === "operation");
    expect(operationEntry?.id).toBe(`operation:${operations.operations[0]!.anchorEntryId}`);
    expect(operationEntry?.createdAt).toBe(operations.operations[0]!.createdAt);
  });

  it("keeps existing behavior when no operations are given (default arg)", () => {
    const entries = deriveTimelineEntries(
      [],
      [],
      [{ id: "work-1", createdAt: "2026-02-23T00:00:01.000Z", label: "Read", tone: "tool" }],
    );

    expect(entries.map((entry) => entry.kind)).toEqual(["work"]);
  });
});

describe("toDerivedWorkLogEntry — a Zerops call's input capture is itemType-independent (MF-3)", () => {
  it("captures toolInput for a file_change-typed zerops_delete activity", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "delete-file-change",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-delete-1",
          itemType: "file_change",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_delete",
            input: { hostname: "api" },
            zerops: {
              toolName: "zerops_delete",
              resultText: JSON.stringify({ message: "api deleted" }),
            },
          },
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolInput).toEqual({ hostname: "api" });

    const { operations } = deriveZeropsOperations(entries);
    expect(operations).toHaveLength(1);
    expect(operations[0]?.kind).toBe("delete");
    expect(operations[0]?.target).toEqual({ hostname: "api" });
  });

  it("captures toolData (Codex item shape) the same way for a file_change-typed zerops_delete", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "delete-file-change-codex",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-delete-2",
          itemType: "file_change",
          status: "completed",
          data: {
            toolName: "mcp__zerops__zerops_delete",
            item: { arguments: { hostname: "worker" } },
            zerops: {
              toolName: "zerops_delete",
              resultText: JSON.stringify({ message: "worker deleted" }),
            },
          },
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolData).toEqual({ arguments: { hostname: "worker" } });

    const { operations } = deriveZeropsOperations(entries);
    expect(operations[0]?.target).toEqual({ hostname: "worker" });
  });

  it("does not widen input capture for a non-Zerops file_change activity", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "plain-file-change",
        kind: "tool.completed",
        payload: {
          toolCallId: "call-plain-1",
          itemType: "file_change",
          status: "completed",
          data: {
            toolName: "Edit",
            input: { file: "a.ts" },
          },
        },
      }),
    ]);

    expect(entries[0]?.toolInput).toBeUndefined();
  });
});

describe("deriveWorkLogEntries + deriveZeropsOperations — hidden zerops_* calls stay entries", () => {
  it("keeps a real thread's route-menu start as an entry so the bootstrap operation reads the agent's intent, not the phrase producer fallback", () => {
    const workEntries = deriveWorkLogEntries(weatherdashFirstDeploy.activities);
    const { operations } = deriveZeropsOperations(workEntries);
    const bootstrap = operations.find((operation) => operation.kind === "bootstrap");

    expect(bootstrap).toBeDefined();
    expect(bootstrap?.voiceSource).toBe("agent");
    expect(bootstrap?.voice).toContain("Nový service pro weather dashboard");
  });

  it("removes every hidden zerops_workflow call from the visible timeline once consumed", () => {
    const workEntries = deriveWorkLogEntries(weatherdashFirstDeploy.activities);
    const operations = deriveZeropsOperations(workEntries);
    const timelineEntries = deriveTimelineEntries([], [], workEntries, [], operations);
    const visibleWorkIds = new Set(
      timelineEntries
        .filter((entry): entry is Extract<TimelineEntry, { kind: "work" }> => entry.kind === "work")
        .map((entry) => entry.entry.id),
    );

    // The route-menu start (its own entry.id survives inside the reducer's
    // consumedEntryIds even though it never anchors or joins the operation)
    // and close-mode: both hidden zerops_workflow calls, both consumed, both
    // absent from the visible timeline. The develop-start call (classified
    // "generic", not hidden) is a control: it must still render.
    const routeMenuStart = workEntries.find(
      (entry) =>
        entry.toolInput?.action === "start" &&
        entry.toolInput?.workflow === "bootstrap" &&
        entry.toolInput?.route === undefined,
    );
    const closeMode = workEntries.find((entry) => entry.toolInput?.action === "close-mode");
    const developStart = workEntries.find(
      (entry) => entry.toolInput?.action === "start" && entry.toolInput?.workflow === "develop",
    );
    expect(routeMenuStart).toBeDefined();
    expect(closeMode).toBeDefined();
    expect(developStart).toBeDefined();

    expect(visibleWorkIds.has(routeMenuStart!.id)).toBe(false);
    expect(visibleWorkIds.has(closeMode!.id)).toBe(false);
    expect(visibleWorkIds.has(developStart!.id)).toBe(true);
  });
});
