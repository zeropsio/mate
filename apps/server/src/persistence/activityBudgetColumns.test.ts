import { describe, expect, it } from "vite-plus/test";

import { activityBudgetColumns } from "./activityBudgetColumns.ts";

const none = { agentId: null, callId: null, taskId: null, usedTokens: null };

describe("activityBudgetColumns", () => {
  it.each([
    ["a Mate's call", "tool.started", { toolCallId: "call-1" }, { ...none, callId: "call-1" }],
    [
      "a helper's call",
      "tool.completed",
      { toolCallId: "call-2", agentId: "helper-a" },
      { ...none, agentId: "helper-a", callId: "call-2" },
    ],
    [
      "a call named in its data",
      "tool.updated",
      { data: { toolCallId: " call-3 " } },
      { ...none, callId: "call-3" },
    ],
    ["a blank agent is the Mate's", "tool.updated", { agentId: "  " }, none],
    [
      "an agentId off a tool row",
      "task.progress",
      { agentId: "helper-a", taskId: "t" },
      { ...none, taskId: "t" },
    ],
    ["a task's start", "task.started", { taskId: "task-1" }, { ...none, taskId: "task-1" }],
    ["a task id off a task row", "tool.completed", { taskId: "task-1" }, none],
    ["a reading", "context-window.updated", { usedTokens: 1200 }, { ...none, usedTokens: 1200 }],
    ["an empty reading", "context-window.updated", { usedTokens: 0 }, { ...none, usedTokens: 0 }],
    ["an unreadable reading", "context-window.updated", { usedTokens: "1200" }, none],
    ["a negative reading", "context-window.updated", { usedTokens: -1 }, none],
    ["no payload", "tool.started", null, none],
    ["a list payload", "task.progress", ["taskId"], none],
  ])("%s", (_, kind, payload, expected) => {
    expect(activityBudgetColumns(kind, payload)).toEqual(expected);
  });
});
