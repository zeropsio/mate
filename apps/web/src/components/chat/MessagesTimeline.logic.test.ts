import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT, USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";
import {
  assistant,
  at,
  landed,
  operation,
  reasoning,
  tool,
  turn,
  user,
} from "./conversationFixtures";

type Scene = {
  entries: TimelineEntry[];
  live?: string;
  settled?: string;
  working?: boolean;
  open?: string[];
  expanded?: string[];
  showReasoning?: boolean;
};

function rows(scene: Scene): MessagesTimelineRow[] {
  const latestId = scene.live ?? scene.settled;
  return deriveMessagesTimelineRows({
    timelineEntries: scene.entries,
    latestTurn: latestId
      ? {
          turnId: turn(latestId),
          state: scene.live ? "running" : "completed",
          startedAt: at(0),
          completedAt: scene.live ? null : at(59),
        }
      : null,
    runningTurnId: scene.live ? turn(scene.live) : null,
    isWorking: scene.working ?? scene.live !== undefined,
    activeTurnStartedAt: scene.live ? at(0) : null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    openStretchKeys: new Set(scene.open ?? []),
    expandedIds: new Set(scene.expanded ?? []),
    showReasoning: scene.showReasoning ?? false,
  });
}

const shape = (list: MessagesTimelineRow[]) => list.map((row) => `${row.kind}:${row.id}`);

describe("deriveMessagesTimelineRows", () => {
  it("draws a settled turn as the message, one work line and the answer", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        reasoning("r1", "t1", 1),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "**Building** the shop now."),
        tool("w2", "t1", 3),
        assistant("a2", "t1", 4, "The shop is live."),
      ],
      settled: "t1",
    });
    expect(shape(list)).toEqual([
      expect.stringMatching(/^seam:seam:day:/),
      "message:m0",
      "work-line:work-line:msg:m0",
      "message:a2",
    ]);
    expect(list[2]).toMatchObject({
      kind: "work-line",
      live: false,
      face: "idle",
      note: "Building the shop now.",
      noteCount: 1,
      hasLog: true,
      open: false,
      startedAt: at(0),
    });
    expect(list[3]).toMatchObject({ showAssistantMeta: true, receipt: null });
  });

  it("keeps every message the person sent where they sent it, with a line after each", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        user("m1", 3),
        tool("w2", "t1", 4),
        user("m2", 5),
        assistant("a3", "t1", 8, "Everything is in."),
      ],
      settled: "t1",
    });
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "message:m1",
      "work-line:work-line:msg:m1",
      "message:m2",
      "work-line:work-line:msg:m2",
      "message:a3",
    ]);
    expect(list.filter((row) => row.kind === "message" && row.message.role === "user")).toEqual([
      expect.objectContaining({ aside: false, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
    ]);
    // A stretch without notes says what it did instead.
    expect(list[2]).toMatchObject({ note: null, fallback: "Ran 1 command" });
  });

  it("keeps the running turn's last line live and holds the answer back", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 2, "Checking the build."),
        tool("w1", "t1", 3, {
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.started",
        }),
      ],
      live: "t1",
    });
    expect(shape(list).slice(1)).toEqual(["message:m0", "work-line:work-line:msg:m0"]);
    expect(list[2]).toMatchObject({
      live: true,
      face: "working",
      note: "Checking the build.",
      endedAt: null,
      activity: { kind: "tool" },
    });
  });

  it("opens a line into its log: notes in full, tool calls as one line per run, thinking hidden", () => {
    const scene: Scene = {
      entries: [
        user("m0", 0),
        reasoning("r1", "t1", 1),
        tool("w1", "t1", 1),
        reasoning("r2", "t1", 1),
        tool("w2", "t1", 2, { changedFiles: ["src/app.ts"], command: undefined as never }),
        assistant("a1", "t1", 3, "Built."),
        tool("w3", "t1", 4),
        assistant("a2", "t1", 5, "Done."),
      ],
      settled: "t1",
      open: ["msg:m0"],
    };
    expect(shape(rows(scene)).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "log-activity:log-activity:w1",
      "log-note:log-note:a1",
      "log-activity:log-activity:w3",
      "message:a2",
    ]);
    expect(rows(scene)[3]).toMatchObject({ summary: "Edited 1 file · ran 1 command" });

    // Thinking shown: it splits the run where it happened.
    expect(rows(scene)[2]).toMatchObject({ kind: "work-line", hasReasoning: true, open: true });
    expect(shape(rows({ ...scene, showReasoning: true })).slice(3, 7)).toEqual([
      "log-reasoning:log-reasoning:r1",
      "log-activity:log-activity:w1",
      "log-reasoning:log-reasoning:r2",
      "log-activity:log-activity:w2",
    ]);

    // An opened activity line lists its calls under it.
    expect(shape(rows({ ...scene, expanded: ["log-activity:w3"] })).slice(5, 8)).toEqual([
      "log-activity:log-activity:w3",
      "work:log-entry:w3",
      "message:a2",
    ]);
  });

  it("keeps what matters visible under a closed line, each where it appeared", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        operation("d1", "t1", 1, {
          kind: "deploy",
          phase: "failed",
          statusWord: "Failed",
          settledAt: at(6),
        }),
        operation("b1", "t1", 2, { kind: "browser", subject: "https://shop.dev/cart" }),
        landed("l1", 3),
        tool("w1", "t1", 4, {
          sourceActivityKind: "context-compaction",
          label: "Context compacted",
        }),
        tool("e1", "t1", 5, { tone: "error", label: "Claude API is overloaded (529)" }),
        operation("d2", "t1", 7, { kind: "deploy" }),
        assistant("a1", "t1", 8, "Deployed on the second try."),
      ],
      settled: "t1",
    });
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "strip:strip:op:b1",
      "event:event:l1",
      "event:event:w1",
      "error:e1",
      "operation:card:op:d1",
      "message:a1",
      "outcome:outcome:msg:m0",
    ]);
    expect(list[2]).toMatchObject({ face: "produced" });
  });

  it("draws one pause for a usage limit, however many attempts ran into it", () => {
    const limit = "You've hit your session limit · resets 9:20pm (UTC)";
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 48, limit),
        assistant("a2", "t2", 48, limit, { second: 10 }),
        assistant("a3", "t3", 48, limit, { second: 20 }),
        user("m1", 50, "keep going"),
        assistant("a4", "t4", 50, limit, { second: 5 }),
      ],
      settled: "t4",
    });
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "pause:pause:msg:m0",
      "message:m1",
      "work-line:work-line:msg:m1",
    ]);
    expect(list[3]).toMatchObject({
      held: 3,
      resumedAt: null,
      resetsAt: new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    });
    expect(list[2]).toMatchObject({ face: "paused" });
    expect(list[5]).toMatchObject({ face: "paused", fallback: "Stopped by the usage limit" });
  });

  it("tells a limit once when the server adds its own error row, and keeps a real answer", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "The first half is done."),
        tool("e1", "t1", 3, {
          tone: "error",
          label: "Runtime error",
          detail: "Claude usage limit reached. Send the message again once the limit resets.",
        }),
      ],
      settled: "t1",
    });
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "pause:pause:msg:m0",
      "message:a1",
    ]);
    expect(list[2]).toMatchObject({ face: "paused" });
  });

  it("marks a pause resumed once the Mate works again", () => {
    const limit = "You've hit your session limit · resets 9:20pm (UTC)";
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 48, limit),
        tool("w2", "t2", 55),
        assistant("a2", "t2", 56, "Back at it."),
      ],
      settled: "t2",
    });
    expect(list.find((row) => row.kind === "pause")).toMatchObject({ resumedAt: at(55) });
  });

  it("draws a slash command as an event, never a bubble", () => {
    const list = rows({
      entries: [
        user("m0", 0, "/compact"),
        tool("w1", "t1", 1, {
          sourceActivityKind: "context-compaction",
          label: "Context compacted",
        }),
      ],
      settled: "t1",
    });
    expect(list[1]).toMatchObject({
      kind: "event",
      id: "m0",
      event: { type: "command", command: { name: "compact" }, done: true },
    });
  });

  it("tells a /compact in one line: no work line, no second compaction line", () => {
    const compaction = tool("w1", "t1", 1, {
      sourceActivityKind: "context-compaction",
      label: "Context compacted",
    });
    const running = rows({ entries: [user("m0", 0, "/compact")], live: "t1" });
    expect(shape(running).slice(1)).toEqual(["event:m0"]);
    expect(running[1]).toMatchObject({ event: { done: false } });
    const done = rows({ entries: [user("m0", 0, "/compact"), compaction], settled: "t1" });
    expect(shape(done).slice(1)).toEqual(["event:m0"]);
    expect(done[1]).toMatchObject({ event: { done: true } });
  });

  it("draws the server's resume after a usage limit as an event, never the person's bubble", () => {
    const list = rows({
      entries: [user("m0", 0, USAGE_LIMIT_RESUME_PROMPT), tool("w1", "t1", 1)],
      settled: "t1",
    });
    expect(list[1]).toMatchObject({ kind: "event", id: "m0", event: { type: "resumed" } });
  });

  it("shows an image-only message's images without the placeholder", () => {
    const list = rows({ entries: [user("m0", 0, IMAGE_ONLY_BOOTSTRAP_PROMPT)], working: true });
    expect(list[1]).toMatchObject({ kind: "message", imageOnly: true, receipt: "sent" });
  });

  it("has nothing to add for a stretch that only thought before its answer", () => {
    const list = rows({
      entries: [user("m0", 0), reasoning("r1", "t1", 1), assistant("a1", "t1", 2, "Yes.")],
      settled: "t1",
    });
    expect(list[2]).toMatchObject({ kind: "work-line", note: null, fallback: null });
  });

  it("draws a seam where a day begins and where the conversation went quiet", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Hi."),
        user("m1", 45),
        assistant("a2", "t2", 46, "Again."),
      ],
      settled: "t2",
    });
    expect(
      list.filter((row) => row.kind === "seam").map((row) => (row as { seam: string }).seam),
    ).toEqual(["day", "gap"]);
  });

  it("marks where the person left off, once, before the first stretch after it", () => {
    const list = deriveMessagesTimelineRows({
      timelineEntries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Hi."),
        user("m1", 10),
        assistant("a2", "t2", 11, "Again."),
        user("m2", 20),
        assistant("a3", "t3", 21, "Once more."),
      ],
      latestTurn: {
        turnId: turn("t3"),
        state: "completed",
        startedAt: at(20),
        completedAt: at(22),
      },
      isWorking: false,
      activeTurnStartedAt: null,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
      newSince: at(5),
    });
    const seams = list.filter((row) => row.kind === "seam");
    expect(seams.map((row) => (row as { seam: string }).seam)).toEqual(["day", "new"]);
    const at10 = list.findIndex((row) => row.id === "m1");
    expect(list[at10 - 1]).toMatchObject({ kind: "seam", seam: "new", createdAt: at(5) });
  });

  it("gathers background work no turn owns into one line", () => {
    const background = (id: string, minute: number) => {
      const entry = tool(id, "t1", minute, { label: `Task ${id}` }) as Extract<
        TimelineEntry,
        { kind: "work" }
      >;
      return { ...entry, entry: { ...entry.entry, turnId: null } };
    };
    const scene: Scene = {
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started."),
        background("b1", 5),
        background("b2", 6),
        background("b3", 7),
        user("m1", 20),
      ],
      settled: "t1",
    };
    expect(shape(rows(scene)).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "message:a1",
      "background:background:b1",
      "message:m1",
    ]);
    expect(rows(scene)[4]).toMatchObject({ entries: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] });
    expect(shape(rows({ ...scene, expanded: ["background:b1"] })).slice(4, 8)).toEqual([
      "background:background:b1",
      "work:log-entry:b1",
      "work:log-entry:b2",
      "work:log-entry:b3",
    ]);
  });

  it("puts queued messages last", () => {
    const list = deriveMessagesTimelineRows({
      timelineEntries: [user("m0", 0)],
      isWorking: true,
      activeTurnStartedAt: at(0),
      turnDiffSummaries: [],
      supportsConversationRollback: false,
      queuedMessages: [
        {
          id: "q1",
          createdAt: at(1),
          prompt: "and the footer",
          images: [],
          terminalContexts: [],
          reviewComments: [],
        } as never,
      ],
    });
    expect(list.at(-1)).toMatchObject({ kind: "queued-message", isNext: true });
  });
});

describe("the no-shift contract", () => {
  // A turn as it arrives: every snapshot must draw a prefix of the next one —
  // the timeline only grows at its bottom; nothing already drawn moves, merges
  // or leaves. Queued messages leave when they are sent, so they are not drawn.
  const arrivals: Array<{ entry: TimelineEntry; live: boolean }> = [
    { entry: user("m0", 0), live: true },
    { entry: reasoning("r1", "t1", 1), live: true },
    { entry: tool("w1", "t1", 1), live: true },
    { entry: assistant("a1", "t1", 2, "Deploying to stage."), live: true },
    {
      entry: operation("d1", "t1", 3, {
        kind: "deploy",
        phase: "running",
        settledAt: undefined as never,
      }),
      live: true,
    },
    {
      entry: operation("b1", "t1", 4, { kind: "browser", subject: "https://shop.dev/" }),
      live: true,
    },
    { entry: user("m1", 5, "the footer too"), live: true },
    { entry: tool("w2", "t1", 6), live: true },
    {
      entry: operation("s1", "t1", 7, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Not running",
        steps: [
          {
            id: "dev-server",
            label: "Health check",
            state: "failed",
            stateLabel: "Failed",
            note: "HTTP 502",
          },
        ],
      }),
      live: true,
    },
    {
      entry: operation("b2", "t1", 8, {
        kind: "browser",
        subject: "https://shop.dev/cart",
        phase: "failed",
      }),
      live: true,
    },
    { entry: landed("l1", 9), live: true },
    { entry: assistant("a2", "t1", 10, "Stage is live, footer fixed."), live: false },
  ];

  it.each([
    ["closed", [] as string[]],
    ["with the live line opened", ["msg:m0", "msg:m1"]],
  ])("holds while a turn arrives, %s", (_label, open) => {
    let previous: string[] = [];
    for (let count = 1; count <= arrivals.length; count += 1) {
      const entries = arrivals.slice(0, count).map((arrival) => arrival.entry);
      const live = arrivals[count - 1]!.live;
      const current = shape(
        rows({ entries, ...(live ? { live: "t1" } : { settled: "t1" }), open }),
      );
      expect(current.slice(0, previous.length)).toEqual(previous);
      previous = current;
    }
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("keeps the rows that did not change, including rebuilt equal operations", () => {
    const scene: Scene = {
      entries: [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy", phase: "failed" }),
        assistant("a1", "t1", 2),
      ],
      settled: "t1",
    };
    const first = computeStableMessagesTimelineRows(rows(scene), { byId: new Map(), result: [] });
    const second = computeStableMessagesTimelineRows(rows(scene), first);
    expect(second).toBe(first);

    const changed = computeStableMessagesTimelineRows(
      rows({ ...scene, entries: [...scene.entries, landed("l1", 3)] }),
      first,
    );
    expect(changed.result[1]).toBe(first.result[1]);
    expect(changed.result.length).toBeGreaterThan(first.result.length);
  });
});

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

describe("normalizeCompactToolLabel", () => {
  it.each([
    ["Ran command complete", "Ran command"],
    ["Read file completed", "Read file"],
  ])("%j", (label, expected) => {
    expect(normalizeCompactToolLabel(label)).toBe(expected);
  });
});

describe("resolveAssistantMessageCopyState", () => {
  it.each([
    [
      { showCopyButton: true, text: "Ship it", streaming: false },
      { text: "Ship it", visible: true },
    ],
    [
      { showCopyButton: true, text: "Still streaming", streaming: true },
      { text: "Still streaming", visible: false },
    ],
    [
      { showCopyButton: true, text: "   ", streaming: false },
      { text: null, visible: false },
    ],
    [
      { showCopyButton: false, text: "Interim thought", streaming: false },
      { text: "Interim thought", visible: false },
    ],
  ])("%j", (input, expected) => {
    expect(resolveAssistantMessageCopyState(input)).toEqual(expected);
  });
});
