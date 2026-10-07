import {
  EventId,
  ProviderDriverKind,
  RuntimeTaskId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectActivityPayload } from "../ActivityPayloadProjection.ts";
import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

const base = {
  provider: ProviderDriverKind.make("codex"),
  createdAt: "2026-08-06T00:00:00.000Z",
  threadId: ThreadId.make("thread-1"),
};

describe("runtimeEventToActivities task progress", () => {
  it("persists usage independently from replaceable activity", () => {
    const taskId = RuntimeTaskId.make("agent-1");
    const usageOnly = {
      ...base,
      type: "task.progress",
      eventId: EventId.make("evt-usage"),
      payload: {
        taskId,
        description: "Agent one",
        typedUsage: { totalTokens: 73_700_000 },
      },
    } satisfies ProviderRuntimeEvent;
    const command = {
      ...base,
      type: "task.progress",
      eventId: EventId.make("evt-command"),
      payload: {
        taskId,
        description: "Agent one",
        summary: "Running tests",
        lastToolName: "exec_command",
      },
    } satisfies ProviderRuntimeEvent;

    const usageActivities = runtimeEventToActivities(usageOnly);
    const commandActivities = runtimeEventToActivities(command);

    expect(usageActivities.map((activity) => activity.id)).toEqual(["task-usage:thread-1:agent-1"]);
    expect(commandActivities.map((activity) => activity.id)).toEqual([
      "task-progress:thread-1:agent-1",
    ]);
    const usagePayload = usageActivities[0]?.payload as Record<string, unknown> | undefined;
    expect(usagePayload?.typedUsage).toEqual({ totalTokens: 73_700_000 });
    expect(usagePayload?.usageSnapshot).toBe(true);
  });

  it("splits combined progress and usage into their independent snapshots", () => {
    const event = {
      ...base,
      type: "task.progress",
      eventId: EventId.make("evt-combined"),
      payload: {
        taskId: RuntimeTaskId.make("agent-2"),
        description: "Agent two",
        summary: "Inspecting the panel",
        typedUsage: { totalTokens: 4_200, toolUses: 7 },
        status: "running",
      },
    } satisfies ProviderRuntimeEvent;

    const activities = runtimeEventToActivities(event);
    const progressPayload = activities[0]?.payload as Record<string, unknown>;
    const usagePayload = activities[1]?.payload as Record<string, unknown>;

    expect(activities.map((activity) => activity.id)).toEqual([
      "task-progress:thread-1:agent-2",
      "task-usage:thread-1:agent-2",
    ]);
    expect(progressPayload.summary).toBe("Inspecting the panel");
    expect(progressPayload.status).toBe("running");
    expect(progressPayload).not.toHaveProperty("typedUsage");
    expect(usagePayload.typedUsage).toEqual({ totalTokens: 4_200, toolUses: 7 });
    expect(usagePayload.usageSnapshot).toBe(true);
    expect(usagePayload).not.toHaveProperty("status");
  });
});
describe("runtimeEventToActivities tool streaming persistence", () => {
  const accumulatedStdout = [
    "first line of output",
    ...Array.from({ length: 500 }, (_, index) => `Capturing frame ${index}/9028`),
  ].join("\n");
  const streamingData = {
    toolCallId: "tool-call-1",
    kind: "execute",
    command: "blender --render",
    rawOutput: { stdout: accumulatedStdout },
    content: [{ type: "content", content: { type: "text", text: accumulatedStdout } }],
  };

  it("persists tool.updated with the wire projection of data, not the accumulated stream", () => {
    const event = {
      ...base,
      type: "item.updated",
      eventId: EventId.make("evt-tool-streaming-updated"),
      payload: {
        itemType: "command_execution",
        status: "inProgress",
        title: "Render",
        detail: accumulatedStdout,
        data: streamingData,
      },
    } satisfies ProviderRuntimeEvent;

    const activities = runtimeEventToActivities(event);

    expect(activities).toHaveLength(1);
    const payload = activities[0]?.payload as Record<string, unknown>;
    const data = payload.data as Record<string, unknown>;
    expect(payload.status).toBe("inProgress");
    expect(data.toolCallId).toBe("tool-call-1");
    expect(data.command).toBe("blender --render");
    expect(data.rawOutput).toEqual({ content: "first line of output" });
    expect(data.content).toBeUndefined();
    expect(JSON.stringify(data).length).toBeLessThan(1_000);
  });

  it("persists a tool.updated that keeps the call's own words through the projection", () => {
    const event = {
      ...base,
      provider: ProviderDriverKind.make("claudeAgent"),
      type: "item.updated",
      eventId: EventId.make("evt-tool-described-updated"),
      payload: {
        itemType: "command_execution",
        status: "inProgress",
        title: "Ran command",
        data: {
          toolName: "Bash",
          input: {
            command: "vp test run src/app.test.ts",
            description: "Run the app tests",
          },
          result: {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: accumulatedStdout }],
          },
        },
      },
    } satisfies ProviderRuntimeEvent;

    const activities = runtimeEventToActivities(event);

    expect(activities).toHaveLength(1);
    const persisted = activities[0]!;
    for (const activity of [persisted, projectActivityPayload(persisted)]) {
      const data = (activity.payload as { data: Record<string, unknown> }).data;
      expect(data.input).toEqual({ description: "Run the app tests" });
      expect(data.command).toBe("vp test run src/app.test.ts");
    }
  });

  it("persists the full terminal payload on tool.completed", () => {
    const event = {
      ...base,
      type: "item.completed",
      eventId: EventId.make("evt-tool-streaming-completed"),
      payload: {
        itemType: "command_execution",
        status: "completed",
        title: "Render",
        data: streamingData,
      },
    } satisfies ProviderRuntimeEvent;

    const activities = runtimeEventToActivities(event);

    expect(activities).toHaveLength(1);
    const payload = activities[0]?.payload as Record<string, unknown>;
    expect(payload.data).toEqual(streamingData);
  });
});

describe("runtimeEventToActivities a call's response", () => {
  // The live slot tells a newer batch by the response a call was written in.
  it("keeps the response a call was written in on its start, through the projection", () => {
    const event = {
      ...base,
      provider: ProviderDriverKind.make("claudeAgent"),
      type: "item.started",
      eventId: EventId.make("evt-tool-started-response"),
      payload: {
        itemType: "command_execution",
        status: "inProgress",
        title: "Command run",
        responseId: "msg-response-1",
        data: { toolName: "Bash", input: { command: "pnpm test" } },
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);
    expect(activity?.kind).toBe("tool.started");
    const payload = projectActivityPayload(activity!).payload as Record<string, unknown>;
    expect(payload.responseId).toBe("msg-response-1");
  });

  // A call its turn's end closed never returned: the client reads no result.
  it("keeps a completion's word that its call never returned, through the projection", () => {
    const event = {
      ...base,
      provider: ProviderDriverKind.make("claudeAgent"),
      type: "item.completed",
      eventId: EventId.make("evt-tool-completed-unreturned"),
      payload: {
        itemType: "command_execution",
        status: "completed",
        title: "Command run",
        unreturned: true,
        data: { toolName: "Bash", input: { command: "pnpm test" } },
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);
    expect(activity?.kind).toBe("tool.completed");
    const payload = projectActivityPayload(activity!).payload as Record<string, unknown>;
    expect(payload.unreturned).toBe(true);
  });
});

describe("runtimeEventToActivities a call's presentation", () => {
  const presentation = {
    title: "Firecrawl scrape",
    source: { key: "mcp:claude_ai_firecrawl", name: "Firecrawl" },
  };
  it.each(["item.started", "item.updated", "item.completed"] as const)(
    "keeps how a call presents itself on its %s, through the projection",
    (type) => {
      const event = {
        ...base,
        provider: ProviderDriverKind.make("claudeAgent"),
        type,
        eventId: EventId.make(`evt-tool-presented-${type}`),
        payload: {
          itemType: "mcp_tool_call",
          status: type === "item.completed" ? "completed" : "inProgress",
          title: "MCP tool call",
          presentation,
          data: { toolName: "mcp__claude_ai_Firecrawl__firecrawl_scrape", input: {} },
        },
      } satisfies ProviderRuntimeEvent;

      const [activity] = runtimeEventToActivities(event);
      const payload = projectActivityPayload(activity!).payload as Record<string, unknown>;
      expect(payload.presentation).toEqual(presentation);
    },
  );
});

describe("runtimeEventToActivities a helper's words", () => {
  const taskId = RuntimeTaskId.make("helper-1");
  const longReport = Array.from(
    { length: 40 },
    (_, line) => `Table ${line} has a primary key and two indexes.`,
  ).join("\n");
  const longPrompt = Array.from(
    { length: 30 },
    (_, line) => `Step ${line}: read the schema file and list its tables.`,
  ).join("\n");
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly event: ProviderRuntimeEvent;
    readonly field: "prompt" | "result";
    readonly expected: string | undefined;
  }> = [
    {
      name: "a helper starts with its prompt, whole",
      event: {
        ...base,
        type: "task.started",
        eventId: EventId.make("evt-started"),
        payload: { taskId, taskType: "local_agent", description: "Check", prompt: longPrompt },
      },
      field: "prompt",
      expected: longPrompt,
    },
    {
      name: "a helper's report is kept whole beside its one-line summary",
      event: {
        ...base,
        type: "task.completed",
        eventId: EventId.make("evt-completed"),
        payload: { taskId, taskType: "local_agent", status: "completed", summary: longReport },
      },
      field: "result",
      expected: longReport,
    },
    {
      name: "a background command's end keeps no report of its own",
      event: {
        ...base,
        type: "task.completed",
        eventId: EventId.make("evt-shell"),
        payload: { taskId, taskType: "local_bash", status: "completed", summary: longReport },
      },
      field: "result",
      expected: undefined,
    },
  ];
  for (const { name, event, field, expected } of cases) {
    it(name, () => {
      const [activity] = runtimeEventToActivities(event);
      const payload = projectActivityPayload(activity!).payload as Record<string, unknown>;
      expect(payload[field]).toBe(expected);
    });
  }

  it("bounds a report past any reader's need", () => {
    const huge = "word ".repeat(20_000);
    const [activity] = runtimeEventToActivities({
      ...base,
      type: "task.completed",
      eventId: EventId.make("evt-huge"),
      payload: { taskId, taskType: "local_agent", status: "completed", summary: huge },
    });
    const result = (activity!.payload as Record<string, unknown>).result as string;
    expect(result.length).toBeLessThan(huge.length);
    expect(result.length).toBeGreaterThan(10_000);
  });
});
