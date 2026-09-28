import {
  classifyTaskAgentKind,
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveWorkLogEntries } from "./session-logic";

let nextId = 0;

function activity(input: {
  kind: string;
  createdAt?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload: Record<string, unknown>;
}): OrchestrationThreadActivity {
  const payload = input.kind.startsWith("task.")
    ? {
        ...input.payload,
        agentKind: classifyTaskAgentKind({
          taskType: typeof input.payload.taskType === "string" ? input.payload.taskType : undefined,
          agentId: undefined,
        }),
      }
    : input.payload;
  return {
    id: EventId.make(`call-input-${nextId++}`),
    createdAt: input.createdAt ?? "2026-09-27T08:00:00.000Z",
    kind: input.kind,
    summary: input.summary ?? "Tool call",
    tone: input.tone ?? "tool",
    payload,
    turnId: TurnId.make("turn-1"),
  } as OrchestrationThreadActivity;
}

function completedCall(itemType: string, data: Record<string, unknown>) {
  return activity({
    kind: "tool.completed",
    payload: { itemType, status: "completed", toolCallId: "toolu_a", data },
  });
}

describe("a call's own words and target reach its entry", () => {
  it.each([
    {
      name: "a command's description",
      itemType: "command_execution",
      data: {
        toolName: "Bash",
        command: "cd /var/www && npm test",
        input: { description: "Run the tests" },
      },
      expected: { description: "Run the tests" },
    },
    {
      name: "a read's file",
      itemType: "dynamic_tool_call",
      data: { toolName: "Read", input: { file_path: "/var/www/app/src/a.ts" } },
      expected: { filePath: "/var/www/app/src/a.ts" },
    },
    {
      name: "a search's pattern and path",
      itemType: "dynamic_tool_call",
      data: { toolName: "Grep", input: { pattern: "content-container", path: "src" } },
      expected: { pattern: "content-container", path: "src" },
    },
    {
      name: "a fetch's address",
      itemType: "web_search",
      data: { toolName: "WebFetch", input: { url: "https://example.com/docs" } },
      expected: { url: "https://example.com/docs" },
    },
    {
      name: "a web search's query and a glob",
      itemType: "web_search",
      data: { toolName: "WebSearch", input: { query: "zerops yml", glob: "*.md" } },
      expected: { query: "zerops yml", glob: "*.md" },
    },
  ])("keeps $name", ({ itemType, data, expected }) => {
    const [entry] = deriveWorkLogEntries([completedCall(itemType, data)]);
    expect(entry?.callInput).toEqual(expected);
  });

  it.each([
    { name: "no input", data: { toolName: "Bash", command: "ls" } },
    { name: "empty and non-string values", data: { input: { description: "  ", path: 3 } } },
  ])("carries none for $name", ({ data }) => {
    const [entry] = deriveWorkLogEntries([completedCall("command_execution", data)]);
    expect(entry?.callInput).toBeUndefined();
  });

  it("keeps what the running call said once it completes without it", () => {
    const entries = deriveWorkLogEntries([
      activity({
        kind: "tool.updated",
        createdAt: "2026-09-27T08:00:00.000Z",
        payload: {
          itemType: "command_execution",
          status: "inProgress",
          toolCallId: "toolu_b",
          data: { toolName: "Bash", command: "npm run build", input: { description: "Build" } },
        },
      }),
      activity({
        kind: "tool.completed",
        createdAt: "2026-09-27T08:00:09.000Z",
        payload: {
          itemType: "command_execution",
          status: "completed",
          toolCallId: "toolu_b",
          data: { toolName: "Bash", command: "npm run build" },
        },
      }),
    ]);
    expect(entries.map((entry) => entry.callInput)).toEqual([{ description: "Build" }]);
  });

  it("a task keeps the call it tracks and its kind", () => {
    const [entry] = deriveWorkLogEntries([
      activity({
        kind: "task.completed",
        tone: "info",
        summary: "Screenshot the home page",
        payload: {
          taskId: "b3nl7uota",
          toolUseId: "toolu_c",
          taskType: "local_bash",
          title: "Screenshot the home page",
          status: "completed",
        },
      }),
    ]);
    expect(entry).toMatchObject({ taskToolUseId: "toolu_c", taskType: "local_bash" });
  });
});
