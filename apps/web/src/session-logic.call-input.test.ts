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
    {
      name: "the skill a skill call loads",
      itemType: "dynamic_tool_call",
      data: { toolName: "skill", input: { name: "zerops-deploy" } },
      expected: { skill: "zerops-deploy" },
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

describe("a call's tool reaches its entry, from every driver", () => {
  it.each([
    { name: "Claude's own", data: { toolName: "Read" }, toolName: "Read" },
    { name: "OpenCode's", data: { toolName: "grep" }, toolName: "grep" },
    {
      name: "an ACP agent's kind",
      data: { toolName: "search", kind: "search" },
      toolName: "search",
    },
    { name: "none named", data: { command: "ls" }, toolName: undefined },
  ])("$name", ({ data, toolName }) => {
    const [entry] = deriveWorkLogEntries([completedCall("dynamic_tool_call", data)]);
    expect(entry?.toolName).toBe(toolName);
  });
});

// A probe on Dara: a job sent to the background said so only in its call's
// own output, and the task that tracks it reaches the log only once it ends.
describe("a command sent to the background", () => {
  it.each([
    {
      name: "says so: the job's id",
      content:
        "Command running in background with ID: b94yypkxx. Output is being written to: /tmp/x",
      sent: "b94yypkxx",
    },
    { name: "an ordinary command: nothing", content: "4 passed", sent: undefined },
  ])("$name", ({ content, sent }) => {
    const [entry] = deriveWorkLogEntries([
      completedCall("command_execution", {
        toolName: "Bash",
        command: "sleep 40; exit 2",
        rawOutput: { content },
      }),
    ]);
    expect(entry?.sentToBackground).toBe(sent);
  });
});

// Run 11: a command's output too long to hand back whole, saved to a file the
// agent then read; its call's own output names the file.
describe("a call whose output was saved to a file", () => {
  it.each([
    {
      name: "names the file: its id",
      content:
        "<persisted-output>\nOutput too large (48.1KB). Full output saved to: /home/zerops/.claude/projects/-srv-app/0a1b2c3d-1111-4222-8333-444455556666/tool-results/q7t2m4xke.txt\n\nPreview (first 2KB):\n[]\n</persisted-output>",
      spilled: "q7t2m4xke",
    },
    { name: "an ordinary command: nothing", content: "4 passed", spilled: undefined },
    // Review of pass 42: a `find` listing a project's own file of that shape saved nothing.
    {
      name: "a listing of a project's file of that shape: nothing",
      content: "./api/tool-results/report.txt",
      spilled: undefined,
    },
  ])("$name", ({ content, spilled }) => {
    const [entry] = deriveWorkLogEntries([
      completedCall("command_execution", {
        toolName: "Bash",
        command: "curl -s localhost:3000/catalogue",
        rawOutput: { content },
      }),
    ]);
    expect(entry?.spilledTo).toBe(spilled);
  });
});

describe("a call that wrote a file is marked on its entry by its end", () => {
  it.each([
    { name: "its start and its end say so", started: true, completed: true, wrote: true },
    { name: "only its end says so", started: false, completed: true, wrote: true },
    { name: "neither says so", started: false, completed: false, wrote: false },
  ])("$name", ({ started, completed, wrote }) => {
    const data = (marked: boolean) => ({
      toolName: "Write",
      input: { file_path: "/srv/a.md" },
      ...(marked ? { wrote: true } : {}),
    });
    const entries = deriveWorkLogEntries(
      [
        activity({
          kind: "tool.started",
          payload: { itemType: "file_change", toolCallId: "toolu_w", data: data(started) },
        }),
        activity({
          kind: "tool.completed",
          createdAt: "2026-09-27T08:00:01.000Z",
          payload: {
            itemType: "file_change",
            status: "completed",
            toolCallId: "toolu_w",
            data: data(completed),
          },
        }),
      ],
      undefined,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.wroteFile === true).toBe(wrote);
  });
});

describe("how a call presents itself reaches its entry", () => {
  it("keeps the title and server its agent gave it, from its first word through its completion", () => {
    const presentation = {
      title: "Firecrawl scrape",
      source: { key: "mcp:claude_ai_firecrawl", name: "Firecrawl" },
    };
    const data = { toolName: "mcp__claude_ai_Firecrawl__firecrawl_scrape", input: {} };
    const entries = deriveWorkLogEntries([
      activity({
        kind: "tool.updated",
        payload: {
          itemType: "mcp_tool_call",
          status: "inProgress",
          toolCallId: "toolu_fc",
          data,
          presentation,
        },
      }),
      activity({
        kind: "tool.completed",
        createdAt: "2026-09-27T08:00:05.000Z",
        payload: { itemType: "mcp_tool_call", status: "completed", toolCallId: "toolu_fc", data },
      }),
    ]);
    expect(entries.map((entry) => entry.toolPresentation)).toEqual([presentation]);
  });
});
