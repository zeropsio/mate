import {
  EventId,
  type ItemLifecyclePayload,
  type OrchestrationThreadActivity,
  type ThreadLiveCall,
  type ThreadLiveStep,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import * as ThreadLiveStepModule from "./ThreadLiveStep.ts";
import { liveCallOf, liveStepObservationOf, type LiveStepObservation } from "./ThreadLiveStep.ts";

const at = (second: number) => `2026-09-29T08:00:${String(second).padStart(2, "0")}.000Z`;

const call = (id: string, second: number, extra: Partial<ThreadLiveCall> = {}): ThreadLiveCall => ({
  id,
  activityKind: "tool.updated",
  itemType: "command_execution",
  title: "Command run",
  startedAt: at(second),
  ...extra,
});

const started: LiveStepObservation = { type: "turn-started", at: at(0) };

describe("ThreadLiveStep", () => {
  it.each<{
    readonly name: string;
    readonly observations: ReadonlyArray<LiveStepObservation>;
    readonly step: ThreadLiveStep | null;
  }>([
    { name: "no turn has started: nothing to say", observations: [], step: null },
    {
      name: "a turn that has done nothing yet is thinking",
      observations: [started],
      step: { kind: "thinking", since: at(0) },
    },
    {
      name: "a call it makes is the step, from its start",
      observations: [started, { type: "call-running", call: call("c1", 5) }],
      step: { kind: "calls", since: at(5), calls: [call("c1", 5)] },
    },
    {
      name: "a call's update tells its facts; it keeps its start",
      observations: [
        started,
        { type: "call-running", call: call("c1", 5, { detail: "Bash: {}" }) },
        {
          type: "call-running",
          call: call("c1", 6, { detail: "Bash: pnpm build", command: "pnpm build" }),
        },
      ],
      step: {
        kind: "calls",
        since: at(5),
        calls: [call("c1", 5, { detail: "Bash: pnpm build", command: "pnpm build" })],
      },
    },
    {
      name: "a call that ends leaves it thinking, from the end",
      observations: [
        started,
        { type: "call-running", call: call("c1", 5) },
        { type: "call-ended", callId: "c1", at: at(9) },
      ],
      step: { kind: "thinking", since: at(9) },
    },
    {
      name: "calls at once: every one that runs, the newest last; one ending leaves the rest",
      observations: [
        started,
        { type: "call-running", call: call("c1", 5) },
        { type: "call-running", call: call("c2", 6) },
        { type: "call-running", call: call("c3", 7) },
        { type: "call-ended", callId: "c2", at: at(8) },
      ],
      step: { kind: "calls", since: at(7), calls: [call("c1", 5), call("c3", 7)] },
    },
    {
      name: "a thought after a call puts the call behind it, though it still runs",
      observations: [
        started,
        { type: "call-running", call: call("c1", 5) },
        { type: "thinking", at: at(7) },
      ],
      step: { kind: "thinking", since: at(7) },
    },
    {
      name: "a call put behind a thought that ends changes nothing",
      observations: [
        started,
        { type: "call-running", call: call("c1", 5) },
        { type: "thinking", at: at(7) },
        { type: "call-ended", callId: "c1", at: at(9) },
      ],
      step: { kind: "thinking", since: at(7) },
    },
    {
      name: "thinking on is the same thought: its start stands",
      observations: [started, { type: "thinking", at: at(3) }, { type: "thinking", at: at(4) }],
      step: { kind: "thinking", since: at(0) },
    },
    {
      name: "its words streaming are writing",
      observations: [started, { type: "writing", at: at(11) }, { type: "writing", at: at(12) }],
      step: { kind: "writing", since: at(11) },
    },
    {
      name: "its words ended: thinking again",
      observations: [started, { type: "writing", at: at(11) }, { type: "words-ended", at: at(13) }],
      step: { kind: "thinking", since: at(13) },
    },
    {
      name: "a call after its words is the step; its end leaves it thinking",
      observations: [
        started,
        { type: "writing", at: at(11) },
        { type: "call-running", call: call("c1", 12) },
        { type: "call-ended", callId: "c1", at: at(14) },
      ],
      step: { kind: "thinking", since: at(14) },
    },
    {
      name: "a new turn starts afresh",
      observations: [
        started,
        { type: "call-running", call: call("c1", 5) },
        { type: "turn-started", at: at(20) },
      ],
      step: { kind: "thinking", since: at(20) },
    },
    {
      name: "what arrives with no turn running says nothing",
      observations: [
        { type: "call-running", call: call("c1", 5) },
        { type: "writing", at: at(6) },
      ],
      step: null,
    },
  ])("$name", ({ observations, step }) => {
    const relay = ThreadLiveStepModule.make();
    for (const observation of observations) relay.observe("thread-1", observation);
    expect(relay.getThreadLiveStep("thread-1")).toEqual(step);
    expect(relay.getThreadLiveStep("thread-2")).toBeNull();
  });

  it("the calls it carries are the newest eight", () => {
    const relay = ThreadLiveStepModule.make();
    relay.observe("thread-1", started);
    for (let index = 0; index < 11; index += 1) {
      relay.observe("thread-1", { type: "call-running", call: call(`c${index}`, index + 1) });
    }
    const step = relay.getThreadLiveStep("thread-1");
    expect(step?.kind === "calls" ? step.calls.map((entry) => entry.id) : null).toEqual([
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "c10",
    ]);
  });

  it("a settled turn leaves nothing behind", () => {
    const relay = ThreadLiveStepModule.make();
    relay.observe("thread-1", started);
    relay.observe("thread-1", { type: "call-running", call: call("c1", 5) });
    relay.clearThread("thread-1");
    expect(relay.getThreadLiveStep("thread-1")).toBeNull();
  });

  it("an unchanged step reads as the same value", () => {
    const relay = ThreadLiveStepModule.make();
    relay.observe("thread-1", started);
    relay.observe("thread-1", { type: "call-running", call: call("c1", 5) });
    const before = relay.getThreadLiveStep("thread-1");
    relay.observe("thread-1", { type: "call-running", call: call("c1", 6) });
    expect(relay.getThreadLiveStep("thread-1")).toBe(before);
  });
});

describe("liveCallOf", () => {
  // The activity ingestion appends for a call, as `runtimeEventToActivities` makes it.
  const item = (
    payload: Omit<ItemLifecyclePayload, "title"> & { readonly title?: string },
    itemId: string | null = "call-1",
  ): OrchestrationThreadActivity => ({
    id: EventId.make(`activity-${itemId ?? "none"}`),
    createdAt: at(5),
    tone: "tool",
    kind: "tool.updated",
    summary: payload.title ?? "Tool updated",
    turnId: null,
    payload: {
      itemType: payload.itemType,
      ...(itemId === null ? {} : { toolCallId: itemId }),
      ...(payload.status === undefined ? {} : { status: payload.status }),
      ...(payload.detail === undefined ? {} : { detail: payload.detail }),
      ...(payload.data === undefined ? {} : { data: payload.data }),
      ...(payload.agentId === undefined ? {} : { agentId: payload.agentId }),
    },
  });

  it.each<{
    readonly name: string;
    readonly input: OrchestrationThreadActivity;
    readonly call: ThreadLiveCall | null;
  }>([
    {
      name: "Claude's command as it starts: its input not in yet",
      input: item({
        itemType: "command_execution",
        status: "inProgress",
        title: "Command run",
        detail: "Bash: {}",
        data: { toolName: "Bash", input: {} },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "command_execution",
        title: "Command run",
        detail: "Bash: {}",
        toolName: "Bash",
        startedAt: at(5),
      },
    },
    {
      name: "Claude's command once its input is in: what it is for, and the command",
      input: item({
        itemType: "command_execution",
        status: "inProgress",
        title: "Command run",
        detail: "Bash: pnpm build",
        data: {
          toolName: "Bash",
          input: { command: "pnpm build", description: "Build the app", timeout: 120000 },
        },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "command_execution",
        title: "Command run",
        detail: "Bash: pnpm build",
        toolName: "Bash",
        command: "pnpm build",
        input: { description: "Build the app" },
        startedAt: at(5),
      },
    },
    {
      name: "Codex's command, which says nothing of itself",
      input: item({
        itemType: "command_execution",
        status: "inProgress",
        title: "Ran command",
        data: {
          item: {
            type: "commandExecution",
            id: "call-1",
            command: "/bin/zsh -lc 'pnpm build'",
            cwd: "/var/www",
            status: "inProgress",
            commandActions: [],
          },
        },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "command_execution",
        title: "Ran command",
        command: "/bin/zsh -lc 'pnpm build'",
        startedAt: at(5),
      },
    },
    {
      name: "a read names its file; the content it read never rides along",
      input: item({
        itemType: "dynamic_tool_call",
        status: "inProgress",
        title: "Tool call",
        detail: 'Read: {"file_path":"/var/www/src/index.ts"}',
        data: {
          toolName: "Read",
          input: { file_path: "/var/www/src/index.ts" },
          result: { content: "export {};\n".repeat(400) },
        },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "dynamic_tool_call",
        title: "Tool call",
        detail: 'Read: {"file_path":"/var/www/src/index.ts"}',
        toolName: "Read",
        input: { file_path: "/var/www/src/index.ts" },
        startedAt: at(5),
      },
    },
    {
      name: "a Zerops tool keeps its plain arguments, cut short, and drops the rest",
      input: item({
        itemType: "mcp_tool_call",
        status: "inProgress",
        title: "MCP tool call",
        detail: "mcp__zerops__zerops_browser: {…}",
        data: {
          toolName: "mcp__zerops__zerops_browser",
          input: {
            url: "https://appdev-3000.example.app/status",
            commands: [["open", "/status"], ["screenshot"]],
            note: "x".repeat(900),
          },
        },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "mcp_tool_call",
        title: "MCP tool call",
        detail: "mcp__zerops__zerops_browser: {…}",
        toolName: "mcp__zerops__zerops_browser",
        input: { url: "https://appdev-3000.example.app/status", note: `${"x".repeat(299)}…` },
        startedAt: at(5),
      },
    },
    {
      name: "Codex's MCP call names its tool and arguments on the item",
      input: item({
        itemType: "mcp_tool_call",
        status: "inProgress",
        title: "zerops · zerops_deploy",
        data: {
          item: {
            type: "mcpToolCall",
            id: "call-1",
            server: "zerops",
            tool: "zerops_deploy",
            status: "inProgress",
            arguments: { targetService: "appdev" },
          },
        },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "mcp_tool_call",
        title: "zerops · zerops_deploy",
        toolName: "zerops_deploy",
        input: { targetService: "appdev" },
        startedAt: at(5),
      },
    },
    {
      name: "an edit names the files it changes",
      input: item({
        itemType: "file_change",
        status: "inProgress",
        title: "File change",
        data: {
          item: {
            type: "fileChange",
            id: "call-1",
            status: "inProgress",
            changes: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
          },
        },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "file_change",
        title: "File change",
        files: ["src/a.ts", "src/b.ts"],
        startedAt: at(5),
      },
    },
    {
      name: "a look at a picture names the picture",
      input: item({
        itemType: "image_view",
        status: "inProgress",
        title: "Image view",
        data: { toolName: "Read", input: { file_path: "/var/www/shot.png" } },
      }),
      call: {
        id: "call-1",
        activityKind: "tool.updated",
        itemType: "image_view",
        title: "Image view",
        toolName: "Read",
        input: { file_path: "/var/www/shot.png" },
        imagePath: "/var/www/shot.png",
        startedAt: at(5),
      },
    },
    {
      name: "a helper's own call is the helper's, not the Mate's step",
      input: item({
        itemType: "command_execution",
        status: "inProgress",
        title: "Command run",
        agentId: "agent-1",
        data: { toolName: "Bash", input: { command: "ls" } },
      }),
      call: null,
    },
    {
      name: "words are no call",
      input: item({ itemType: "assistant_message", title: "Assistant message" }),
      call: null,
    },
    {
      name: "a call with no id cannot be followed",
      input: item({ itemType: "command_execution", title: "Command run" }, null),
      call: null,
    },
  ])("$name", ({ input, call: expected }) => {
    expect(liveCallOf(input)).toEqual(expected);
  });
});

describe("liveStepObservationOf", () => {
  const activity = (
    kind: OrchestrationThreadActivity["kind"],
    status: string | undefined,
    summary = "Command run",
  ): OrchestrationThreadActivity => ({
    id: EventId.make(`activity-${kind}`),
    createdAt: at(7),
    tone: "tool",
    kind,
    summary,
    turnId: null,
    payload: {
      itemType: "command_execution",
      toolCallId: "call-1",
      ...(status === undefined ? {} : { status }),
      detail: "Bash: pnpm build",
      data: { toolName: "Bash", input: { command: "pnpm build" } },
    },
  });
  const running = (title: string, activityKind = "tool.updated"): LiveStepObservation => ({
    type: "call-running",
    call: {
      id: "call-1",
      activityKind,
      itemType: "command_execution",
      title,
      detail: "Bash: pnpm build",
      toolName: "Bash",
      command: "pnpm build",
      startedAt: at(7),
    },
  });
  const ended: LiveStepObservation = { type: "call-ended", callId: "call-1", at: at(7) };

  it.each<{
    readonly name: string;
    readonly activity: OrchestrationThreadActivity;
    readonly observation: LiveStepObservation | null;
  }>([
    {
      name: "a call starting runs, titled as the runtime titles it",
      activity: activity("tool.started", "inProgress", "Command run started"),
      observation: running("Command run", "tool.started"),
    },
    {
      name: "a call's update in progress runs",
      activity: activity("tool.updated", "inProgress"),
      observation: running("Command run"),
    },
    {
      name: "an update that does not say how it stands still runs",
      activity: activity("tool.updated", undefined),
      observation: running("Command run"),
    },
    {
      name: "an update saying it failed ends it",
      activity: activity("tool.updated", "failed"),
      observation: ended,
    },
    {
      name: "its completion ends it",
      activity: activity("tool.completed", "completed"),
      observation: ended,
    },
    {
      name: "what is no call says nothing of a step",
      activity: { ...activity("tool.updated", "inProgress"), kind: "task.progress" },
      observation: null,
    },
  ])("$name", ({ activity: input, observation }) => {
    expect(liveStepObservationOf(input)).toEqual(observation);
  });
});
