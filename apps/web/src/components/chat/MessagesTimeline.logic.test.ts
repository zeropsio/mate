import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
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

  it("keeps every message the person sent where they sent it, with a line after each that did work", () => {
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
    // The last stretch only answered: nothing to open, so no line — the
    // answer stands under the message by itself.
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "message:m1",
      "work-line:work-line:msg:m1",
      "message:m2",
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

  it("keeps the running turn's last line live and its latest words at its tail", () => {
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
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "working:working:msg:m0",
    ]);
    expect(list[2]).toMatchObject({
      live: true,
      face: "working",
      note: "Checking the build.",
      endedAt: null,
      activity: { kind: "tool" },
    });
    // The Mate at work is the stretch's tail: its words stream there, in full.
    expect(list[3]).toMatchObject({
      kind: "working",
      turnKey: "msg:m0",
      stream: [{ kind: "note", key: "a1", message: expect.objectContaining({ id: "a1" }) }],
      strip: null,
      incidents: [],
    });
  });

  const typeCheck = (id: string, minute: number, failed: boolean) =>
    tool(id, "t1", minute, {
      label: "Run the type check",
      tone: failed ? "error" : "info",
      sourceActivityKind: "task.completed",
    });
  it.each([
    {
      name: "the Mate's words stream oldest first, the last few of them",
      entries: [
        assistant("a1", "t1", 1, "One."),
        tool("w1", "t1", 2),
        assistant("a2", "t1", 3, "Two."),
        assistant("a3", "t1", 4, "Three."),
        assistant("a4", "t1", 5, "Four."),
        assistant("a5", "t1", 6, "Five."),
        assistant("a6", "t1", 7, "Six."),
        assistant("a7", "t1", 8, "Seven."),
      ],
      stream: ["Two.", "Three.", "Four.", "Five.", "Six.", "Seven."],
    },
    {
      name: "a step that failed on the way streams where it failed",
      entries: [
        assistant("a1", "t1", 1, "Type checking."),
        typeCheck("t9", 2, true),
        assistant("a2", "t1", 3, "Fixing the types."),
      ],
      stream: ["Type checking.", "✗ Run the type check failed", "Fixing the types."],
    },
    {
      name: "a failure a later attempt came back from says so, in place",
      entries: [
        typeCheck("t9", 1, true),
        assistant("a1", "t1", 2, "Fixed."),
        typeCheck("t10", 3, false),
      ],
      stream: ["↺ Run the type check failed · then passed", "Fixed."],
    },
    {
      name: "a failed operation streams; a deploy, a check and a dev server carry their own",
      entries: [
        operation("v1", "t1", 1, { kind: "verify", phase: "failed", statusWord: "Unhealthy" }),
        operation("d1", "t1", 2, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        operation("b1", "t1", 3, { kind: "browser", phase: "failed", statusWord: "Failed" }),
        operation("v2", "t1", 4, { kind: "verify", phase: "done", statusWord: "Healthy" }),
      ],
      stream: ["↺ appdev Unhealthy · came back"],
    },
    {
      name: "words that are only space are no note, and nothing said yet is an empty stream",
      entries: [assistant("a1", "t1", 1, "  "), tool("w1", "t1", 2)],
      stream: [],
    },
  ])("$name", ({ entries, stream }) => {
    const working = rows({ entries: [user("m0", 0), ...entries], live: "t1" }).find(
      (row) => row.kind === "working",
    );
    expect(
      working?.kind === "working"
        ? working.stream.map((item) =>
            item.kind === "note"
              ? item.message.text
              : `${item.failure.recovered ? "↺" : "✗"} ${[item.failure.subject, item.failure.words].filter(Boolean).join(" ")}${item.failure.recovered ? ` · ${item.failure.recovered}` : ""}`,
          )
        : null,
    ).toEqual(stream);
  });

  it.each([
    {
      name: "a stretch the person interrupted keeps the words they answered, frozen",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Found it: the build used the dev setup."),
        user("m1", 3, "revert it"),
      ],
      turn: { live: "t1" },
      speech: [{ id: "speech:msg:m0", text: "Found it: the build used the dev setup." }],
    },
    {
      name: "a stretch that ends in its answer has no speech: the answer is the last word",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Looking."),
        tool("w2", "t1", 3),
        assistant("a2", "t1", 4, "Done."),
      ],
      turn: { settled: "t1" },
      speech: [],
    },
    {
      name: "a stretch with no words yet has no speech",
      entries: [user("m0", 0), tool("w1", "t1", 1)],
      turn: { live: "t1" },
      speech: [],
    },
  ])("$name", ({ entries, turn: state, speech }) => {
    const list = rows({ entries, ...state });
    expect(
      list.flatMap((row) =>
        row.kind === "speech" ? [{ id: row.id, text: row.message.text }] : [],
      ),
    ).toEqual(speech);
  });

  it("opens a line into its log: thinking, notes in full, tool calls as one line per run", () => {
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
    // One click shows everything the stretch did: thinking splits the run
    // of tool calls where it happened — there is no second switch for it.
    expect(shape(rows(scene)).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "log-reasoning:log-reasoning:r1",
      "log-activity:log-activity:w1",
      "log-reasoning:log-reasoning:r2",
      "log-activity:log-activity:w2",
      "log-note:log-note:a1",
      "log-activity:log-activity:w3",
      "message:a2",
    ]);
    expect(rows(scene)[6]).toMatchObject({ summary: "Edited 1 file" });

    // An opened activity line lists its calls under it.
    expect(shape(rows({ ...scene, expanded: ["log-activity:w3"] })).slice(8, 11)).toEqual([
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
        tool("t9", "t1", 5, {
          tone: "error",
          label: "Re-run type checks",
          sourceActivityKind: "task.completed",
        }),
        operation("d2", "t1", 7, { kind: "deploy" }),
        assistant("a1", "t1", 8, "Deployed on the second try."),
      ],
      settled: "t1",
    });
    // The failed deploy, the failed background task and the browser checks
    // are the work's own: they stay in the log, and the outcome says what the
    // turn came to. What happened *to* the conversation stays in view.
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "event:event:l1",
      "event:event:w1",
      "error:e1",
      "outcome:outcome:msg:m0",
      "message:a1",
    ]);
    expect(list[2]).toMatchObject({ face: "produced" });
  });

  it.each([false, true])(
    "draws the person's answer to the Mate's question as their own words (log open: %s)",
    (opened) => {
      const inputEntry = (id: string, minute: number, overrides: Partial<WorkLogEntry>) =>
        tool(id, "t1", minute, {
          tone: "info",
          command: undefined as never,
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          inputRequestId: "req-1",
          ...overrides,
        });
      const list = rows({
        entries: [
          user("m0", 0),
          inputEntry("rq", 1, {
            label: "User input requested",
            sourceActivityKind: "user-input.requested",
            inputQuestions: [
              { id: "accent", header: "Accent color", question: "Which accent colour?" },
            ],
          }),
          inputEntry("rs", 2, {
            label: "User input submitted",
            sourceActivityKind: "user-input.resolved",
            inputAnswers: [{ key: "accent", answer: "Green" }],
          }),
          tool("w1", "t1", 3),
          assistant("a1", "t1", 4, "Green it is."),
        ],
        settled: "t1",
        open: opened ? ["msg:m0"] : [],
      });
      const answers = list.filter((row) => row.kind === "answer");
      expect(answers).toEqual([
        expect.objectContaining({
          id: "answer:rs",
          pairs: [{ key: "accent", asked: "Accent color", answer: "Green" }],
        }),
      ]);
      // The request and the submission are not rows of their own.
      expect(shape(list).filter((id) => id.includes(":rq") || id === "work:rs")).toEqual([]);
    },
  );

  it("puts the browser checks back where they happened when the line is opened", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        operation("b1", "t1", 2, { kind: "browser", subject: "https://shop.dev/cart" }),
        assistant("a1", "t1", 3, "Checked."),
      ],
      settled: "t1",
      open: ["msg:m0"],
    });
    expect(shape(list).slice(1, 5)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "log-activity:log-activity:w1",
      "strip:strip:op:b1",
    ]);
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
    // The first stretch only answered — no line; the background work is one.
    expect(shape(rows(scene)).slice(1)).toEqual([
      "message:m0",
      "message:a1",
      "background:background:b1",
      "message:m1",
    ]);
    expect(rows(scene)[3]).toMatchObject({ entries: [{ id: "b1" }, { id: "b2" }, { id: "b3" }] });
    expect(shape(rows({ ...scene, expanded: ["background:b1"] })).slice(3, 7)).toEqual([
      "background:background:b1",
      "work:log-entry:b1",
      "work:log-entry:b2",
      "work:log-entry:b3",
    ]);
  });

  it.each([
    { afterTurnWork: "working" as const, last: "after-work:after-work" },
    { afterTurnWork: "monitoring" as const, last: "after-work:after-work" },
    { afterTurnWork: null, last: "message:a1" },
  ])(
    "keeps the Mate at work at the bottom after its answer while work runs on ($afterTurnWork)",
    ({ afterTurnWork, last }) => {
      const list = deriveMessagesTimelineRows({
        timelineEntries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
        latestTurn: {
          turnId: turn("t1"),
          state: "completed",
          startedAt: at(0),
          completedAt: at(3),
        },
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaries: [],
        supportsConversationRollback: false,
        afterTurnWork,
      });
      expect(shape(list).at(-1)).toBe(last);
      if (afterTurnWork !== null) {
        expect(list.at(-1)).toMatchObject({ state: afterTurnWork, gap: "block" });
      }
    },
  );

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
  // A turn as it arrives: everything a snapshot drew above its live tail must
  // be drawn the same by the next one — the timeline only grows at its bottom;
  // nothing already drawn moves, merges or leaves. The live tail is the Mate's
  // cursor: its live speech, or a live line with nothing under it yet, which
  // follows the conversation down like a typing indicator. A turn settling
  // re-forms what is under its live line (its last note becomes the answer, a
  // limit's notice becomes the pause). Queued messages leave when they are
  // sent, so they are not drawn.
  const liveTailStart = (list: MessagesTimelineRow[]) => {
    let end = list.length;
    while (end > 0) {
      const row = list[end - 1]!;
      if (row.kind === "working" || (row.kind === "work-line" && row.live)) end -= 1;
      else break;
    }
    return end;
  };
  const holds = (sequence: Array<{ entry: TimelineEntry; live: boolean }>, open: string[]) => {
    let previous: MessagesTimelineRow[] = [];
    let wasLive = false;
    for (let count = 1; count <= sequence.length; count += 1) {
      const entries = sequence.slice(0, count).map((arrival) => arrival.entry);
      const live = sequence[count - 1]!.live;
      const current = rows({ entries, ...(live ? { live: "t1" } : { settled: "t1" }), open });
      const settling = wasLive && !live;
      const liveLineEnd = previous.findLastIndex((row) => row.kind === "work-line" && row.live) + 1;
      const bound = settling
        ? Math.min(liveTailStart(previous), liveLineEnd)
        : liveTailStart(previous);
      expect(shape(current).slice(0, bound)).toEqual(shape(previous).slice(0, bound));
      previous = current;
      wasLive = live;
    }
  };
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
    holds(arrivals, open);
  });

  it("holds when the person writes twice before the Mate did anything: the live line follows", () => {
    holds(
      [
        { entry: user("m0", 0), live: true },
        { entry: user("m1", 1, "and the footer"), live: true },
        { entry: tool("w1", "t1", 2), live: true },
        { entry: assistant("a1", "t1", 3, "Looking at both."), live: true },
        { entry: user("m2", 4, "also the header"), live: true },
        { entry: tool("w2", "t1", 5), live: true },
        { entry: assistant("a2", "t1", 6, "All three are done."), live: false },
      ],
      [],
    );
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
