import { MessageId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  computeMessageDurationStart,
  deriveMessagesTimelineRows,
  deriveMessagesTimelineRowsWithState,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
} from "./MessagesTimeline.logic";
import {
  createMessageAttachmentPreviewProjector,
  deriveTimelineEntries,
  deriveTimelineEntriesWithState,
} from "../../session-logic";
import { isImageAttachment, type ChatMessage, type TurnDiffSummary } from "../../types";

describe("streaming row projection", () => {
  function fixture(text = "") {
    const turnId = TurnId.make("live-turn");
    const historyTurnId = TurnId.make("history-turn");
    const time = (second: number) => new Date(Date.UTC(2026, 8, 4, 0, 0, second)).toISOString();
    const messages: ChatMessage[] = [
      {
        id: MessageId.make("history-user"),
        role: "user",
        text: "Inspect",
        turnId: null,
        createdAt: time(0),
        updatedAt: time(0),
        streaming: false,
      },
      {
        id: MessageId.make("history-assistant"),
        role: "assistant",
        text: "Done",
        turnId: historyTurnId,
        createdAt: time(3),
        updatedAt: time(4),
        streaming: false,
      },
      {
        id: MessageId.make("live-user"),
        role: "user",
        text: "Continue",
        turnId: null,
        createdAt: time(5),
        updatedAt: time(5),
        streaming: false,
      },
      {
        id: MessageId.make("live-assistant"),
        role: "assistant",
        text,
        turnId,
        createdAt: time(7),
        updatedAt: time(7),
        streaming: true,
      },
    ];
    const work: WorkLogEntry[] = [
      {
        id: "history-work",
        turnId: historyTurnId,
        createdAt: time(1),
        label: "Ran command",
        tone: "tool",
        command: "vp test",
        toolCallId: "history-tool",
        toolLifecycleStatus: "failed",
        sourceActivityKind: "tool.completed",
      },
      {
        id: "live-work",
        turnId,
        createdAt: time(6),
        label: "Read file",
        tone: "tool",
        changedFiles: ["/repo/src/index.ts"],
        toolCallId: "live-tool",
        toolLifecycleStatus: "completed",
        sourceActivityKind: "tool.completed",
      },
    ];
    const timeline = deriveTimelineEntriesWithState(messages, [], work);
    const input = {
      timelineEntries: timeline.entries,
      latestTurn: { turnId, state: "running", startedAt: time(5), completedAt: null },
      runningTurnId: turnId,
      isWorking: true,
      activeTurnStartedAt: time(5),
      turnDiffSummaryByAssistantMessageId: new Map<MessageId, TurnDiffSummary>(),
      revertTurnCountByUserMessageId: new Map<MessageId, number>(),
    } satisfies Parameters<typeof deriveMessagesTimelineRows>[0];
    return { messages, work, timeline, input, time, turnId, historyTurnId };
  }

  it.each([
    ["", "Now visible"],
    [" \n", "Now visible"],
    ["Visible", ""],
    ["", " \t\n"],
    ["Visible", "★ Insight\nKeep these line breaks"],
  ])("keeps row parity and history identity when text changes from %j to %j", (before, after) => {
    const initial = fixture(before);
    const previous = deriveMessagesTimelineRowsWithState(initial.input);
    Object.freeze(previous.rows);
    for (const row of previous.rows) Object.freeze(row);
    const last = initial.messages.at(-1)!;
    const messages = [
      ...initial.messages.slice(0, -1),
      { ...last, text: after, updatedAt: initial.time(8) },
    ];
    const timeline = deriveTimelineEntriesWithState(messages, [], initial.work, initial.timeline);
    const input = { ...initial.input, timelineEntries: timeline.entries };
    const next = deriveMessagesTimelineRowsWithState(input, previous);

    expect(next.rows).toEqual(
      deriveMessagesTimelineRows({
        ...input,
        timelineEntries: deriveTimelineEntries(messages, [], initial.work),
      }),
    );
    // A flip between blank and visible text re-derives the working row in full.
    if (before.trim().length > 0 !== after.trim().length > 0) return;
    for (const [index, row] of previous.rows.entries()) {
      if (row.kind === "message" && row.message === last) {
        expect(next.rows[index]).toMatchObject({ message: { text: after } });
        expect(row.message.text).toBe(before);
      } else {
        expect(next.rows[index]).toBe(row);
      }
    }
  });

  it("keeps earlier emitted rows unchanged across two projection branches", () => {
    const initial = fixture();
    const previous = deriveMessagesTimelineRowsWithState(initial.input);
    const last = initial.messages.at(-1)!;
    const branch = (text: string) => {
      const messages = [...initial.messages.slice(0, -1), { ...last, text }];
      const timeline = deriveTimelineEntriesWithState(messages, [], initial.work, initial.timeline);
      const input = { ...initial.input, timelineEntries: timeline.entries };
      const projection = deriveMessagesTimelineRowsWithState(input, previous);
      expect(projection.rows).toEqual(deriveMessagesTimelineRows(input));
      return projection;
    };
    const first = branch("First branch");
    const savedFirst = structuredClone(first.rows);
    branch("Second branch");
    expect(first.rows).toEqual(savedFirst);
    expect(previous.rows).toEqual(deriveMessagesTimelineRows(initial.input));
  });

  it.each(["file", "image", "handoff", "streaming-image"] as const)(
    "preserves stream reuse through the real %s preview materializer",
    (kind) => {
      const initial = fixture("Partial");
      const image = {
        type: "image" as const,
        id: "image",
        name: "image.png",
        mimeType: "image/png",
        sizeBytes: 42,
      };
      const file = {
        type: "file" as const,
        id: "file",
        name: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 8,
      };
      const source = initial.messages.map((message, index) =>
        index === 0 || (kind === "streaming-image" && index === initial.messages.length - 1)
          ? { ...message, attachments: kind === "file" ? [file] : [image, file] }
          : message,
      );
      const server = createMessageAttachmentPreviewProjector();
      const handoff = createMessageAttachmentPreviewProjector();
      const materialize = (messages: ReadonlyArray<ChatMessage>, url: string) => {
        const urls = new Map(kind === "handoff" ? [] : [[image.id, url]]);
        return messages.map((message) => {
          const displayed = server(message, (attachment) => urls.get(attachment.id));
          return kind === "handoff" && message.role === "user"
            ? handoff(displayed, (attachment) =>
                isImageAttachment(attachment) ? "blob:handoff" : undefined,
              )
            : displayed;
        });
      };
      const firstMessages = materialize(source, "https://first.test/image");
      const firstTimeline = deriveTimelineEntriesWithState(firstMessages, [], initial.work);
      const input = { ...initial.input, timelineEntries: firstTimeline.entries };
      const previous = deriveMessagesTimelineRowsWithState(input);
      const saved = structuredClone(previous.rows);
      const nextSource = [...source.slice(0, -1), { ...source.at(-1)!, text: "Next token" }];
      const nextMessages = materialize(nextSource, "https://first.test/image");
      const nextTimeline = deriveTimelineEntriesWithState(
        nextMessages,
        [],
        initial.work,
        firstTimeline,
      );
      const nextInput = { ...input, timelineEntries: nextTimeline.entries };
      const next = deriveMessagesTimelineRowsWithState(nextInput, previous);

      expect(nextMessages[0]).toBe(firstMessages[0]);
      expect(next.rows).toEqual(deriveMessagesTimelineRows(nextInput));
      for (const [index, row] of previous.rows.entries()) {
        if (row.kind === "message" && row.message.id === source.at(-1)?.id) continue;
        expect(next.rows[index]).toBe(row);
      }
      expect(previous.rows).toEqual(saved);

      if (kind === "image" || kind === "streaming-image") {
        const renewed = materialize(nextSource, "https://renewed.test/image");
        const renewedTimeline = deriveTimelineEntriesWithState(
          renewed,
          [],
          initial.work,
          nextTimeline,
        );
        const renewedInput = { ...input, timelineEntries: renewedTimeline.entries };
        const renewedRows = deriveMessagesTimelineRowsWithState(renewedInput, next);
        expect(renewedRows.rows).toEqual(deriveMessagesTimelineRows(renewedInput));
        expect(renewed[0]?.attachments?.[0]).toMatchObject({
          previewUrl: "https://renewed.test/image",
        });
        expect(firstMessages[0]?.attachments?.[0]).toMatchObject({
          previewUrl: "https://first.test/image",
        });
      }
    },
  );

  it.each(["completion", "turn", "role", "ordering"] as const)(
    "rebuilds row structure for a %s change with otherwise unchanged controls",
    (change) => {
      const initial = fixture("Partial");
      const input = {
        ...initial.input,
        latestTurn: {
          ...initial.input.latestTurn,
          state: "completed" as const,
          completedAt: initial.time(9),
        },
        runningTurnId: null,
        isWorking: false,
      };
      const previous = deriveMessagesTimelineRowsWithState(input);
      const last = initial.messages.at(-1)!;
      const changed: ChatMessage =
        change === "completion"
          ? { ...last, streaming: false, updatedAt: initial.time(10) }
          : change === "turn"
            ? { ...last, turnId: initial.historyTurnId }
            : change === "role"
              ? { ...last, role: "user", turnId: null }
              : { ...last, createdAt: initial.time(0) };
      const messages = [...initial.messages.slice(0, -1), changed];
      const timeline = deriveTimelineEntriesWithState(messages, [], initial.work, initial.timeline);
      const nextInput = { ...input, timelineEntries: timeline.entries };
      const next = deriveMessagesTimelineRowsWithState(nextInput, previous);
      expect(next.rows).toEqual(
        deriveMessagesTimelineRows({
          ...nextInput,
          timelineEntries: deriveTimelineEntries(messages, [], initial.work),
        }),
      );
      expect(previous.rows).toEqual(deriveMessagesTimelineRows(input));
    },
  );

  it("keeps full parity through completion, trailing failure, metadata, expansion, and paging", () => {
    const initial = fixture("Partial");
    let timeline = initial.timeline;
    let input: Parameters<typeof deriveMessagesTimelineRows>[0] = initial.input;
    let projection = deriveMessagesTimelineRowsWithState(input);
    let messages = initial.messages;
    let work = initial.work;
    const check = (changes: Partial<typeof input> = {}) => {
      const oldRows = structuredClone(projection.rows);
      const previous = projection;
      timeline = deriveTimelineEntriesWithState(messages, [], work, timeline);
      input = { ...input, ...changes, timelineEntries: timeline.entries };
      projection = deriveMessagesTimelineRowsWithState(input, previous);
      expect(projection.rows).toEqual(
        deriveMessagesTimelineRows({
          ...input,
          timelineEntries: deriveTimelineEntries(messages, [], work),
        }),
      );
      expect(previous.rows).toEqual(oldRows);
    };

    messages = [
      ...messages.slice(0, -1),
      { ...messages.at(-1)!, streaming: false, text: "Complete", updatedAt: initial.time(9) },
    ];
    check({
      latestTurn: { ...initial.input.latestTurn, state: "completed", completedAt: initial.time(9) },
      runningTurnId: null,
      isWorking: false,
    });
    work = [
      ...work,
      {
        id: "late-failure",
        turnId: initial.turnId,
        createdAt: initial.time(10),
        label: "Failed command",
        command: "vp test",
        tone: "error",
        toolCallId: "failed-tool",
        toolLifecycleStatus: "failed",
        sourceActivityKind: "tool.completed",
      },
    ];
    check();
    messages = [
      ...messages.slice(0, -1),
      { ...messages.at(-1)!, text: "Updated final text", updatedAt: initial.time(11) },
    ];
    check();
    check({
      latestTurn: {
        ...initial.input.latestTurn,
        state: "interrupted",
        completedAt: initial.time(12),
      },
    });
    check({ expandedTurnIds: new Set([initial.historyTurnId, initial.turnId]) });
    const group = projection.rows.find((row) => row.kind === "work-toggle");
    check({ expandedWorkGroupIds: new Set(group ? [group.id] : []) });
    messages = [
      { ...messages[0]!, id: MessageId.make("older-user"), createdAt: "2026-09-03T23:59:00.000Z" },
      ...messages,
    ];
    check();
    messages = messages.map((message) =>
      message.id === MessageId.make("live-assistant")
        ? { ...message, role: "user", turnId: null, createdAt: initial.time(0) }
        : message,
    );
    check({ revertTurnCountByUserMessageId: new Map([[MessageId.make("live-user"), 3]]) });
  });
});

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

  const makeOperation = (overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
    key: "call:op-1",
    kind: "deploy",
    phase: "done",
    anchorActivityId: "op-1",
    anchorAt: "2026-01-01T00:00:50Z",
    turnId: "turn-milestone" as never,
    subject: "api",
    kicker: "Deploy · api",
    voice: "Deploying api.",
    voiceSource: "mate",
    statusWord: "Deployed",
    steps: [],
    links: [],
    callIds: ["op-1"],
    attempts: 1,
    hasResult: true,
    ...overrides,
  });

  const makeOperationTimelineEntry = (
    id: string,
    overrides: Partial<ZeropsOperation> = {},
  ): Extract<TimelineEntry, { kind: "operation" }> => {
    const operation = makeOperation({
      anchorActivityId: id,
      key: `call:${id}`,
      callIds: [id],
      ...overrides,
    });
    return {
      id: `operation:${operation.anchorActivityId}`,
      kind: "operation",
      createdAt: operation.anchorAt,
      operation,
    };
  };

  /** A Zerops call the model classified "generic" — a `generic-call` timeline entry. */
  const makeGenericCallTimelineEntry = (
    id: string,
    entry: Partial<WorkLogEntry> = {},
  ): Extract<TimelineEntry, { kind: "generic-call" }> => ({
    id: `${id}-entry`,
    kind: "generic-call",
    createdAt: "2026-01-01T00:00:01Z",
    entry: {
      id: `${id}-work`,
      createdAt: "2026-01-01T00:00:01Z",
      label: id,
      tone: "tool",
      itemType: "mcp_tool_call",
      toolLifecycleStatus: "completed",
      ...entry,
    },
  });

  it("moves a settled-turn fold anchor past a leading operation entry", () => {
    const operation = makeOperationTimelineEntry("anchor-operation", {
      anchorAt: "2026-01-01T00:00:02Z",
    });
    const ordinary = makeWorkTimelineEntry("anchor-ordinary", {
      turnId: "turn-milestone" as never,
      itemType: "command_execution",
    });

    const rows = deriveSettledRows([
      makeAssistantTimelineEntry("assistant-first", "2026-01-01T00:00:01Z"),
      operation,
      ordinary,
      makeAssistantTimelineEntry("assistant-final", "2026-01-01T00:00:59Z"),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "assistant-first-entry", kind: "message" },
      { id: "operation:anchor-operation", kind: "operation" },
      { id: "turn-fold:turn-milestone", kind: "turn-fold" },
      { id: "assistant-final-entry", kind: "message" },
    ]);
    expect(rows.find((row) => row.kind === "turn-fold")?.createdAt).toBe(ordinary.createdAt);
  });

  it("drops the fold row when an operation entry was the turn's only hidden entry", () => {
    const rows = deriveSettledRows([
      makeAssistantTimelineEntry("assistant-first", "2026-01-01T00:00:01Z"),
      makeOperationTimelineEntry("only-hidden-operation", {
        anchorAt: "2026-01-01T00:00:02Z",
      }),
      makeAssistantTimelineEntry("assistant-final", "2026-01-01T00:00:59Z"),
    ]);

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.map((row) => row.id)).toContain("operation:only-hidden-operation");
  });

  it("emits two operation rows and no work group when the timeline holds only operations", () => {
    const rows = deriveSettledRows([
      makeOperationTimelineEntry("deploy-operation", {
        kind: "deploy",
        anchorAt: "2026-01-01T00:00:01Z",
      }),
      makeOperationTimelineEntry("verify-operation", {
        kind: "verify",
        anchorAt: "2026-01-01T00:00:02Z",
      }),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "operation:deploy-operation", kind: "operation" },
      { id: "operation:verify-operation", kind: "operation" },
    ]);
  });

  it("keeps a standalone tool group and a distinct operation row side by side, never merged into the toggle", () => {
    const rows = deriveSettledRows([
      makeOperationTimelineEntry("standalone-operation", {
        anchorAt: "2026-01-01T00:00:01Z",
      }),
      makeWorkTimelineEntry("standalone-tool-1", { itemType: "command_execution" }),
      makeWorkTimelineEntry("standalone-tool-2", { itemType: "command_execution" }),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "operation:standalone-operation", kind: "operation" },
      { id: "work-toggle:standalone-tool-1-entry", kind: "work-toggle" },
    ]);
    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({ hiddenCount: 2 });
  });

  it("keeps a generic-call row distinct from a neighbouring work group, never merged into its toggle", () => {
    const rows = deriveSettledRows([
      makeGenericCallTimelineEntry("generic-status"),
      makeWorkTimelineEntry("standalone-tool-1", { itemType: "command_execution" }),
      makeWorkTimelineEntry("standalone-tool-2", { itemType: "command_execution" }),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "generic-status-entry", kind: "generic-call" },
      { id: "work-toggle:standalone-tool-1-entry", kind: "work-toggle" },
    ]);
    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({ hiddenCount: 2 });
  });

  it("splits an active work group around a middle operation entry", () => {
    const rows = deriveActiveRows([
      makeRunningTool("active-running-before"),
      makeOperationTimelineEntry("active-middle-operation", {
        turnId: "turn-active" as never,
        anchorAt: "2026-01-01T00:00:01Z",
      }),
      makeRunningTool("active-running-after"),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "work-live:active-running-before-entry", kind: "work-live" },
      { id: "operation:active-middle-operation", kind: "operation" },
      { id: "work-live:active-running-after-entry", kind: "work-live" },
    ]);
  });

  it("keeps a trailing operation entry out of an active work group", () => {
    const rows = deriveActiveRows([
      makeRunningTool("active-running-before"),
      makeOperationTimelineEntry("active-trailing-operation", {
        turnId: "turn-active" as never,
        anchorAt: "2026-01-01T00:00:01Z",
      }),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "work-live:active-running-before-entry", kind: "work-live" },
      { id: "operation:active-trailing-operation", kind: "operation" },
    ]);
  });

  it("keeps a leading operation entry visible ahead of a running tool", () => {
    const operation = makeOperationTimelineEntry("active-leading-operation", {
      turnId: "turn-active" as never,
      anchorAt: "2026-01-01T00:00:01Z",
    });
    const running = makeRunningTool("active-running");

    const rows = deriveActiveRows([operation, running]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "operation:active-leading-operation", kind: "operation" },
      { id: "work-live:active-running-entry", kind: "work-live" },
    ]);
  });

  it("renders an active turn whose only entry is an operation, with no Thinking indicator", () => {
    const rows = deriveActiveRows([
      makeOperationTimelineEntry("active-only-operation", {
        turnId: "turn-active" as never,
        anchorAt: "2026-01-01T00:00:01Z",
      }),
    ]);

    expect(rowIdentities(rows)).toEqual([
      { id: "working-indicator-row", kind: "working" },
      { id: "operation:active-only-operation", kind: "operation" },
    ]);
    expect(rows.find((row) => row.kind === "working")).toMatchObject({ showThinking: false });
  });

  it("keeps context compaction visible outside folded work", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "compaction-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:00Z",
          entry: {
            id: "compaction",
            createdAt: "2026-01-01T00:00:00Z",
            label: "Compacted context 899K → 19K tokens",
            tone: "info",
            sourceActivityKind: "context-compaction",
          },
        },
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows).toEqual([
      {
        kind: "context-compaction",
        id: "compaction-entry",
        createdAt: "2026-01-01T00:00:00Z",
        label: "Compacted context 899K → 19K tokens",
      },
    ]);
  });

  it("folds a compaction row into a settled turn's fold alongside other hidden work", () => {
    const timelineEntries = [
      {
        id: "assistant-first-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:01Z",
        message: {
          id: "assistant-first" as never,
          role: "assistant" as const,
          text: "Starting the compaction.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:01Z",
          updatedAt: "2026-01-01T00:00:01Z",
          streaming: false,
        },
      },
      {
        id: "work-entry",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:02Z",
        entry: {
          id: "work",
          createdAt: "2026-01-01T00:00:02Z",
          turnId: "turn-1" as never,
          label: "Ran command",
          tone: "tool" as const,
        },
      },
      {
        id: "compaction-entry",
        kind: "work" as const,
        createdAt: "2026-01-01T00:00:03Z",
        entry: {
          id: "compaction",
          createdAt: "2026-01-01T00:00:03Z",
          turnId: "turn-1" as never,
          label: "Compacted context 899K → 19K tokens",
          tone: "info" as const,
          sourceActivityKind: "context-compaction" as const,
        },
      },
      {
        id: "assistant-final-entry",
        kind: "message" as const,
        createdAt: "2026-01-01T00:00:04Z",
        message: {
          id: "assistant-final" as never,
          role: "assistant" as const,
          text: "Done.",
          turnId: "turn-1" as never,
          createdAt: "2026-01-01T00:00:04Z",
          updatedAt: "2026-01-01T00:00:04Z",
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

    // Both the tool work and the compaction row fold behind one turn-fold
    // row: the turn hides real work, so the compaction row does not get to
    // stay visible on its own (contrast the lone-compaction case above).
    expect(collapsedRows.map((row) => row.id)).toEqual([
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

    // Expanding the fold reveals both hidden entries, proving the fold's
    // hidden set held the tool work AND the compaction row, not just one.
    expect(expandedRows.map((row) => ({ id: row.id, kind: row.kind }))).toEqual([
      { id: "assistant-first-entry", kind: "message" },
      { id: "turn-fold:turn-1", kind: "turn-fold" },
      { id: "work-toggle:work-entry", kind: "work-toggle" },
      { id: "compaction-entry", kind: "context-compaction" },
      { id: "assistant-final-entry", kind: "message" },
    ]);
  });

  it("never folds a turn whose only hidden entry is its compaction row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "assistant-first-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:01Z",
          message: {
            id: "assistant-first" as never,
            role: "assistant",
            text: "Starting the compaction.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:01Z",
            updatedAt: "2026-01-01T00:00:01Z",
            streaming: false,
          },
        },
        {
          id: "compaction-entry",
          kind: "work",
          createdAt: "2026-01-01T00:00:02Z",
          entry: {
            id: "compaction",
            createdAt: "2026-01-01T00:00:02Z",
            turnId: "turn-1" as never,
            label: "Compacted context 899K → 19K tokens",
            tone: "info",
            sourceActivityKind: "context-compaction",
          },
        },
        {
          id: "assistant-final-entry",
          kind: "message",
          createdAt: "2026-01-01T00:00:03Z",
          message: {
            id: "assistant-final" as never,
            role: "assistant",
            text: "Done.",
            turnId: "turn-1" as never,
            createdAt: "2026-01-01T00:00:03Z",
            updatedAt: "2026-01-01T00:00:03Z",
            streaming: false,
          },
        },
      ] satisfies TimelineEntry[],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.map((row) => ({ id: row.id, kind: row.kind }))).toEqual([
      { id: "assistant-first-entry", kind: "message" },
      { id: "compaction-entry", kind: "context-compaction" },
      { id: "assistant-final-entry", kind: "message" },
    ]);
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

  it("folds all assistant messages before the terminal message", () => {
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

  const reasoningEntry = (id: string, at: string, turnId: string | null) => ({
    id,
    kind: "message" as const,
    createdAt: at,
    message: {
      id: id as never,
      role: "reasoning" as const,
      text: "weighing it up",
      turnId: turnId as never,
      createdAt: at,
      updatedAt: at,
      streaming: false,
    },
  });

  const answerEntry = (id: string, at: string, turnId: string) => ({
    id,
    kind: "message" as const,
    createdAt: at,
    message: {
      id: id as never,
      role: "assistant" as const,
      text: "the answer",
      turnId: turnId as never,
      createdAt: at,
      updatedAt: at,
      streaming: false,
    },
  });

  const toolEntry = (id: string, at: string, turnId: string) => ({
    id,
    kind: "work" as const,
    createdAt: at,
    entry: {
      id,
      createdAt: at,
      turnId: turnId as never,
      label: "Ran a command",
      tone: "tool" as const,
    },
  });

  it("keeps a thought-only turn out of the work fold", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        reasoningEntry("reasoning-entry", "2026-01-01T00:00:01Z", "turn-1"),
        answerEntry("assistant-entry", "2026-01-01T00:00:02Z", "turn-1"),
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.map((row) => row.id)).toContain("reasoning-entry");
  });

  it("folds a thinking block away with the tool work beside it", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        reasoningEntry("reasoning-entry", "2026-01-01T00:00:01Z", "turn-1"),
        toolEntry("tool-entry", "2026-01-01T00:00:02Z", "turn-1"),
        answerEntry("assistant-entry", "2026-01-01T00:00:03Z", "turn-1"),
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(true);
    expect(rows.map((row) => row.id)).not.toContain("reasoning-entry");
  });

  it("still folds a lone trailing tool call when a thought follows the answer", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        toolEntry("tool-before", "2026-01-01T00:00:01Z", "turn-1"),
        answerEntry("assistant-entry", "2026-01-01T00:00:02Z", "turn-1"),
        reasoningEntry("reasoning-after", "2026-01-01T00:00:03Z", "turn-1"),
        toolEntry("tool-after", "2026-01-01T00:00:04Z", "turn-1"),
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    const ids = rows.map((row) => row.id);
    expect(ids).not.toContain("tool-after");
    expect(ids).not.toContain("reasoning-after");
  });

  it("does not let a stranded streaming thought hold a settled turn open", () => {
    const stranded = reasoningEntry("reasoning-stranded", "2026-01-01T00:00:01Z", "turn-1");
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        { ...stranded, message: { ...stranded.message, streaming: true } },
        toolEntry("tool-entry", "2026-01-01T00:00:02Z", "turn-1"),
        answerEntry("assistant-entry", "2026-01-01T00:00:03Z", "turn-1"),
      ],
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.some((row) => row.kind === "turn-fold")).toBe(true);
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

  it("reuses an operation row when an equivalent derivation rebuilds a fresh ZeropsOperation object", () => {
    const operation = (overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
      key: "call:op-stable",
      kind: "deploy",
      phase: "done",
      anchorAt: "2026-01-01T00:00:00Z",
      anchorActivityId: "op-stable",
      turnId: null,
      subject: "api",
      kicker: "Deploy · api",
      voice: "Deploying api.",
      voiceSource: "mate",
      statusWord: "Deployed",
      steps: [],
      links: [],
      callIds: ["op-stable"],
      attempts: 1,
      hasResult: true,
      ...overrides,
    });

    const createRows = (op: ZeropsOperation) =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "zerops:call:op-stable",
            kind: "operation",
            createdAt: op.anchorAt,
            operation: op,
          },
        ],
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows(operation());
    const initial = computeStableMessagesTimelineRows(firstRows, { byId: new Map(), result: [] });

    // A brand-new `ZeropsOperation` object, equal in every field the row
    // cares about — the model rebuilds this fresh on every derive, with no
    // per-operation cache of its own.
    const secondRows = createRows(operation());
    expect(secondRows[0]?.kind === "operation" && secondRows[0].operation).not.toBe(
      firstRows[0]?.kind === "operation" && firstRows[0].operation,
    );

    const repeated = computeStableMessagesTimelineRows(secondRows, initial);
    expect(repeated.result[0]).toBe(initial.result[0]);

    // A field the row actually renders changes: the row is NOT reused.
    const changedRows = createRows(operation({ phase: "failed" }));
    const changed = computeStableMessagesTimelineRows(changedRows, initial);
    expect(changed.result[0]).not.toBe(initial.result[0]);
  });

  it("does not reuse an operation row when only a step's own state changes", () => {
    const operation = (overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
      key: "call:op-steps",
      kind: "bootstrap",
      phase: "running",
      anchorAt: "2026-01-01T00:00:00Z",
      anchorActivityId: "op-steps",
      turnId: null,
      subject: "kanbandev",
      kicker: "Bootstrap · kanbandev",
      voice: "Setting up kanbandev.",
      voiceSource: "mate",
      statusWord: "Working",
      steps: [
        { id: "discover", label: "Discover", state: "done", stateLabel: "Done" },
        { id: "provision", label: "Provision", state: "running", stateLabel: "Running" },
        { id: "deploy", label: "Deploy", state: "queued", stateLabel: "Waiting" },
      ],
      links: [],
      callIds: ["op-steps"],
      attempts: 1,
      hasResult: false,
      ...overrides,
    });

    const createRows = (op: ZeropsOperation) =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "zerops:call:op-steps",
            kind: "operation",
            createdAt: op.anchorAt,
            operation: op,
          },
        ],
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows(operation());
    const initial = computeStableMessagesTimelineRows(firstRows, { byId: new Map(), result: [] });

    // Same phase, same attempts/settledAt/hasResult, same step COUNT — only
    // the middle step's own `state` (and `stateLabel`) advances.
    const secondRows = createRows(
      operation({
        steps: [
          { id: "discover", label: "Discover", state: "done", stateLabel: "Done" },
          { id: "provision", label: "Provision", state: "done", stateLabel: "Done" },
          { id: "deploy", label: "Deploy", state: "queued", stateLabel: "Waiting" },
        ],
      }),
    );

    const updated = computeStableMessagesTimelineRows(secondRows, initial);
    expect(updated.result[0]).not.toBe(initial.result[0]);
    expect(
      updated.result[0]?.kind === "operation"
        ? updated.result[0].operation.steps[1]?.state
        : undefined,
    ).toBe("done");
  });

  it("does not reuse a generic-call row when the entry's toolInput changes mid-flight", () => {
    const createRows = (toolInput: Record<string, unknown>) =>
      deriveMessagesTimelineRows({
        timelineEntries: [
          {
            id: "generic-input-entry",
            kind: "generic-call",
            createdAt: "2026-01-01T00:00:01Z",
            entry: {
              id: "generic-input-work",
              createdAt: "2026-01-01T00:00:01Z",
              label: "zerops_env_set",
              tone: "tool",
              itemType: "mcp_tool_call",
              toolLifecycleStatus: "inProgress",
              toolInput,
            },
          },
        ],
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaryByAssistantMessageId: new Map(),
        revertTurnCountByUserMessageId: new Map(),
      });

    const firstRows = createRows({});
    const initial = computeStableMessagesTimelineRows(firstRows, { byId: new Map(), result: [] });

    // Same status ("inProgress") and detail (undefined) — only the
    // streamed-in `toolInput` changes.
    const secondRows = createRows({ key: "TZ", value: "UTC" });
    const updated = computeStableMessagesTimelineRows(secondRows, initial);

    expect(updated.result[0]).not.toBe(initial.result[0]);
    expect(
      updated.result[0]?.kind === "generic-call" ? updated.result[0].entry.toolInput : undefined,
    ).toEqual({ key: "TZ", value: "UTC" });
  });
});
