/**
 * A V1 Mate thread as its projections held it, shaped after recorded threads (run 11 and 12's
 * exports): five turns — completed, stopped by the person, failed, running at the flip, and a
 * message never sent — holding every record V1's client draws: the person's words with a picture
 * and a file, the agent's notes and thoughts, a tool of every kind with its lifecycle, a helper
 * and its own call, background work, an approval and questions answered, dismissed and left, a
 * compaction, a plan, a warning, a denial, a failed provider call, a capture's gap, a runtime
 * note, a proposed plan, and the records V1 shows nowhere (progress, the meter, a capture).
 *
 * @module engine/testing/history/v1Thread
 */
import * as DateTime from "effect/DateTime";

import type { ProjectionThreadActivity } from "../../../persistence/Services/ProjectionThreadActivities.ts";
import type { ProjectionThreadMessage } from "../../../persistence/Services/ProjectionThreadMessages.ts";
import type { ProjectionThreadProposedPlan } from "../../../persistence/Services/ProjectionThreadProposedPlans.ts";
import type {
  ProjectionPendingTurnStart,
  ProjectionTurnById,
} from "../../../persistence/Services/ProjectionTurns.ts";

export const THREAD = "thread-main";
const BASE = Date.parse("2026-10-05T07:00:00.000Z");
/** The time `seconds` into the thread. */
export const at = (seconds: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(BASE + seconds * 1000));

export const LONG_THOUGHT = `I should read the recipe first. ${"The api needs its env. ".repeat(20)}`;
export const LONG_NOTE = `Here is the whole log:\n${"line of output\n".repeat(1300)}`;
/** A picture as zcp's browser returned it, inline. */
const SCREENSHOT = { type: "image", mimeType: "image/png", data: "iVBORw0KGgo".repeat(400) };

type Turn = ProjectionTurnById;
const turn = (
  id: string,
  state: Turn["state"],
  pending: string,
  from: number,
  to: number | null,
): Turn =>
  ({
    threadId: THREAD,
    turnId: id,
    pendingMessageId: pending,
    sourceProposedPlanThreadId: null,
    sourceProposedPlanId: null,
    assistantMessageId: null,
    state,
    requestedAt: at(from),
    startedAt: at(from),
    completedAt: to === null ? null : at(to),
    checkpointTurnCount: null,
    checkpointRef: null,
    checkpointStatus: null,
    checkpointFiles: [],
  }) as unknown as Turn;

export const turns: ReadonlyArray<Turn> = [
  turn("turn-1", "completed", "msg-1", 0, 100),
  turn("turn-2", "interrupted", "msg-4", 200, 300),
  turn("turn-3", "error", "msg-6", 400, 500),
  turn("turn-4", "running", "msg-7", 600, null),
];

/** A message the person sent while turn 4 ran: queued, never started before the flip. */
export const pendingTurn = {
  threadId: THREAD,
  messageId: "msg-9",
  sourceProposedPlanThreadId: null,
  sourceProposedPlanId: null,
  requestedAt: at(700),
} as unknown as ProjectionPendingTurnStart;

const message = (
  id: string,
  role: "user" | "assistant" | "reasoning" | "system",
  text: string,
  seconds: number,
  turnId: string | null,
  attachments?: ReadonlyArray<unknown>,
): ProjectionThreadMessage =>
  ({
    messageId: id,
    threadId: THREAD,
    turnId,
    role,
    text,
    ...(attachments === undefined ? {} : { attachments }),
    isStreaming: false,
    createdAt: at(seconds),
    updatedAt: at(seconds),
  }) as unknown as ProjectionThreadMessage;

export const messages: ReadonlyArray<ProjectionThreadMessage> = [
  message("msg-1", "user", "[Picture 1] [File 1]\nStand up the shop from this design.", 0, null, [
    { type: "image", id: "pic-1", name: "design.png", mimeType: "image/png", sizeBytes: 2048 },
    { type: "file", id: "file-1", name: "brief.md", mimeType: "text/markdown", sizeBytes: 120 },
  ]),
  message("msg-2", "reasoning", LONG_THOUGHT, 1, "turn-1"),
  message("msg-3", "assistant", "The shop is up on the dev service.", 90, "turn-1"),
  message("msg-4", "user", "Now add the Czech prices.", 200, null),
  message("msg-5", "assistant", LONG_NOTE, 250, "turn-2"),
  message("msg-6", "user", "Deploy it to stage.", 400, null),
  message("msg-7", "user", "Keep going.", 600, null),
  message("msg-8", "system", "Thread forked.", 601, "turn-4"),
  message("msg-9", "user", "And the footer, please.", 700, null),
];

let sequence = 0;
const activity = (
  id: string,
  kind: string,
  summary: string,
  payload: unknown,
  seconds: number,
  turnId: string | null,
  tone: ProjectionThreadActivity["tone"] = kind.startsWith("tool.") ? "tool" : "info",
): ProjectionThreadActivity =>
  ({
    activityId: id,
    threadId: THREAD,
    turnId,
    tone,
    kind,
    summary,
    payload,
    sequence: ++sequence,
    createdAt: at(seconds),
  }) as unknown as ProjectionThreadActivity;

const command = (status: string, extra: object = {}) => ({
  itemType: "command_execution",
  toolCallId: "toolu_cmd1",
  status,
  detail: "Bash: ls /var/www",
  data: { command: "ls /var/www", toolName: "Bash", ...extra },
});

export const activities: ReadonlyArray<ProjectionThreadActivity> = [
  // turn 1 — a tool of every kind
  activity("a-1", "tool.started", "Tool call started", command("inProgress"), 2, "turn-1"),
  activity("a-2", "tool.updated", "Command run", command("inProgress"), 3, "turn-1"),
  activity(
    "a-3",
    "tool.completed",
    "Command run",
    command("completed", { rawOutput: { content: "app\nzerops.yaml" } }),
    4,
    "turn-1",
  ),
  activity(
    "a-4",
    "tool.started",
    "Tool call started",
    {
      itemType: "dynamic_tool_call",
      toolCallId: "toolu_search",
      status: "inProgress",
      detail: "ToolSearch: {}",
      data: { toolName: "ToolSearch" },
    },
    5,
    "turn-1",
  ),
  activity(
    "a-5",
    "tool.completed",
    "Tool call",
    {
      itemType: "dynamic_tool_call",
      toolCallId: "toolu_search",
      status: "completed",
      detail: 'ToolSearch: {"query":"zerops"}',
      data: { input: { query: "zerops" }, toolName: "ToolSearch" },
    },
    6,
    "turn-1",
  ),
  activity(
    "a-6",
    "tool.started",
    "Tool call started",
    {
      itemType: "mcp_tool_call",
      toolCallId: "toolu_deploy",
      status: "inProgress",
      title: "Deploy",
      data: { toolName: "mcp__zerops__zerops_deploy", server: "zerops" },
      presentation: {
        title: "Deploy",
        source: { key: "mcp:zerops", name: "Zerops" },
      },
    },
    10,
    "turn-1",
  ),
  activity("a-7", "tool.progress", "Progress", { toolCallId: "toolu_deploy" }, 11, "turn-1"),
  activity(
    "a-8",
    "tool.completed",
    "Deploy",
    {
      itemType: "mcp_tool_call",
      toolCallId: "toolu_deploy",
      status: "completed",
      title: "Deploy",
      data: {
        toolName: "mcp__zerops__zerops_deploy",
        server: "zerops",
        zerops: {
          toolName: "zerops_deploy",
          resultText: '{"status":"DEPLOYED","service":"api"}',
          images: [SCREENSHOT],
        },
      },
    },
    40,
    "turn-1",
  ),
  activity(
    "a-9",
    "tool.started",
    "Tool call started",
    {
      itemType: "file_change",
      toolCallId: "toolu_edit",
      status: "inProgress",
      data: { toolName: "Edit", input: { file_path: "/var/www/app/index.ts" } },
    },
    41,
    "turn-1",
  ),
  activity(
    "a-10",
    "tool.completed",
    "File change",
    {
      itemType: "file_change",
      toolCallId: "toolu_edit",
      status: "failed",
      data: { toolName: "Edit", input: { file_path: "/var/www/app/index.ts" } },
    },
    42,
    "turn-1",
  ),
  activity(
    "a-11",
    "tool.started",
    "Tool call started",
    {
      itemType: "image_view",
      toolCallId: "toolu_look",
      status: "inProgress",
      data: { toolName: "Read", imagePath: "/var/www/design.png" },
    },
    43,
    "turn-1",
  ),
  activity(
    "a-12",
    "tool.completed",
    "Image view",
    {
      itemType: "image_view",
      toolCallId: "toolu_look",
      status: "completed",
      data: { toolName: "Read", imagePath: "/var/www/design.png" },
    },
    44,
    "turn-1",
  ),
  activity(
    "a-13",
    "context-window.updated",
    "Context window updated",
    { usedTokens: 200838, maxTokens: 1000000 },
    45,
    "turn-1",
  ),
  activity(
    "a-14",
    "turn.plan.updated",
    "Plan updated",
    {
      plan: [
        { step: "Read the recipe", status: "completed" },
        { step: "Deploy the api", status: "inProgress" },
      ],
      explanation: "Deploy before the frontend.",
    },
    46,
    "turn-1",
  ),
  activity("a-15", "checkpoint.captured", "Checkpoint captured", {}, 100, "turn-1"),
  // turn 2 — a helper, its own call, background work, an approval, a question answered
  activity(
    "a-20",
    "tool.started",
    "Tool call started",
    {
      itemType: "collab_agent_tool_call",
      toolCallId: "toolu_agent",
      status: "inProgress",
      data: { toolName: "Agent" },
    },
    201,
    "turn-2",
  ),
  activity(
    "a-21",
    "task.started",
    "local_agent task started",
    {
      taskId: "helper-1",
      taskType: "local_agent",
      detail: "Translate the catalogue",
      agentKind: "agent",
      toolUseId: "toolu_agent",
    },
    202,
    "turn-2",
  ),
  activity(
    "a-22",
    "tool.started",
    "Tool call started",
    {
      itemType: "command_execution",
      toolCallId: "toolu_helper_cmd",
      status: "inProgress",
      agentId: "helper-1",
      data: { toolName: "Bash", command: "cat catalogue.json" },
    },
    203,
    "turn-2",
  ),
  activity(
    "a-23",
    "tool.completed",
    "Command run",
    {
      itemType: "command_execution",
      toolCallId: "toolu_helper_cmd",
      status: "completed",
      agentId: "helper-1",
      data: { toolName: "Bash", command: "cat catalogue.json" },
    },
    204,
    "turn-2",
  ),
  activity(
    "a-24",
    "task.progress",
    "Running Translate",
    { taskId: "helper-1", title: "Translate the catalogue", agentKind: "agent" },
    205,
    "turn-2",
  ),
  activity(
    "a-25",
    "task.completed",
    "Task completed",
    {
      taskId: "helper-1",
      status: "completed",
      title: "Translate the catalogue",
      agentKind: "agent",
      taskType: "local_agent",
    },
    220,
    "turn-2",
  ),
  activity(
    "a-26",
    "tool.completed",
    "Agent",
    {
      itemType: "collab_agent_tool_call",
      toolCallId: "toolu_agent",
      status: "completed",
      data: { toolName: "Agent" },
    },
    221,
    "turn-2",
  ),
  activity(
    "a-27",
    "approval.requested",
    "Command approval requested",
    {
      requestId: "req-approve",
      requestKind: "command",
      requestType: "command",
      detail: "rm -rf dist",
    },
    222,
    "turn-2",
    "approval",
  ),
  activity(
    "a-28",
    "approval.resolved",
    "Approval resolved",
    { requestId: "req-approve", requestKind: "command", decision: "accept" },
    223,
    "turn-2",
    "approval",
  ),
  activity(
    "a-29",
    "user-input.requested",
    "User input requested",
    {
      requestId: "req-ask",
      questions: [{ id: "q1", question: "Which currency?", options: [{ label: "CZK" }] }],
    },
    224,
    "turn-2",
  ),
  activity(
    "a-30",
    "user-input.answer-submitted",
    "Answer submitted",
    { requestId: "req-ask", answers: { q1: "CZK" } },
    225,
    "turn-2",
  ),
  activity(
    "a-31",
    "user-input.resolved",
    "User input submitted",
    { requestId: "req-ask", answers: { q1: "CZK" } },
    226,
    "turn-2",
  ),
  activity(
    "a-32",
    "tool.started",
    "Tool call started",
    {
      itemType: "command_execution",
      toolCallId: "toolu_cut",
      status: "inProgress",
      data: { toolName: "Bash", command: "yarn build" },
    },
    290,
    "turn-2",
  ),
  // turn 3 — what went wrong: a warning, a denial, a failed call, a compaction, the break
  activity(
    "a-40",
    "runtime.warning",
    "Rate limits are close",
    { message: "Rate limits are close" },
    401,
    "turn-3",
  ),
  activity(
    "a-41",
    "tool.denied",
    "Tool denied: Bash",
    { toolName: "Bash", detail: "not allowed in plan mode" },
    402,
    "turn-3",
    "error",
  ),
  activity(
    "a-42",
    "provider.user-input.respond.failed",
    "Provider user input response failed",
    { detail: "the session is gone\n  at stack" },
    403,
    "turn-3",
    "error",
  ),
  activity(
    "a-43",
    "context-compaction",
    "Context compacted",
    { state: "compacted", beforeTokens: 190000, afterTokens: 30000 },
    404,
    "turn-3",
  ),
  activity(
    "a-44",
    "task.started",
    "local_bash task started",
    { taskId: "shell-1", taskType: "local_bash", detail: "yarn dev" },
    405,
    "turn-3",
  ),
  activity(
    "a-45",
    "approval.requested",
    "File-change approval requested",
    { requestId: "req-left", requestKind: "file-change", detail: "write .env" },
    406,
    "turn-3",
    "approval",
  ),
  activity(
    "a-46",
    "runtime.error",
    "Runtime error",
    { message: "The agent process exited.", turnEnd: "failed" },
    499,
    "turn-3",
    "error",
  ),
  // turn 4 — running when the Mate moved
  activity(
    "a-50",
    "checkpoint.capture.failed",
    "Checkpoint capture failed",
    { detail: "api: the service did not answer" },
    602,
    "turn-4",
    "error",
  ),
  activity(
    "a-51",
    "runtime.error",
    "Runtime error",
    { message: "Socket hang up." },
    603,
    "turn-4",
    "error",
  ),
  activity("a-52", "runtime.note", "Model switched to opus", {}, 604, "turn-4"),
  activity(
    "a-53",
    "user-input.requested",
    "User input requested",
    { requestId: "req-dismissed", questions: [{ id: "q1", question: "Keep the old footer?" }] },
    605,
    "turn-4",
  ),
  activity(
    "a-54",
    "user-input.resolved",
    "User input dismissed",
    { requestId: "req-dismissed" },
    606,
    "turn-4",
  ),
  // A helper's report that came after its turn, without one: placed by its time.
  activity(
    "a-55",
    "task.completed",
    "Task completed",
    { taskId: "helper-late", status: "failed", title: "Check the footer", agentKind: "agent" },
    607,
    null,
  ),
];

export const proposedPlans: ReadonlyArray<ProjectionThreadProposedPlan> = [
  {
    planId: "plan-1",
    threadId: THREAD,
    turnId: "turn-4",
    planMarkdown: "# Footer plan\n\n1. Move the links.",
    implementedAt: null,
    implementationThreadId: null,
    createdAt: at(608),
    updatedAt: at(608),
  } as unknown as ProjectionThreadProposedPlan,
];
