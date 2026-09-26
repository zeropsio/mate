import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  rowGap,
  thoughtParagraphs,
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

/** The conversation as the list draws it, its cards' frames included. */
function framed(scene: Scene): MessagesTimelineRow[] {
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

/** The conversation's rows, without the rows that only close a card's frame. */
function rows(scene: Scene): MessagesTimelineRow[] {
  return framed(scene).filter((row) => row.kind !== "card-end");
}

const shape = (list: MessagesTimelineRow[]) => list.map((row) => `${row.kind}:${row.id}`);

/** What a row draws, its frame included: a row that changes its gap or its place in a card changes its height. */
const frame = (list: MessagesTimelineRow[]) =>
  list.map((row) => `${row.kind}:${row.id}:${row.gap ?? "none"}:${row.card ?? "free"}`);

/** Background work that finished after its turn: no turn owns it. */
const background = (id: string, minute: number, overrides: Partial<WorkLogEntry> = {}) => {
  const entry = tool(id, "t1", minute, {
    label: `Task ${id}`,
    taskId: `task-${id}`,
    sourceActivityKind: "task.completed",
    ...overrides,
  }) as Extract<TimelineEntry, { kind: "work" }>;
  return { ...entry, entry: { ...entry.entry, turnId: null } };
};

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

  it("keeps every message the person sent where they sent it, inside the run's one card", () => {
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
    // Messages sent into the run are delivered at the Mate's next step and
    // the run goes on: one line for all of it, the messages inside its card
    // where they arrived, the answer after it.
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "message:m1",
      "message:m2",
      "message:a3",
    ]);
    expect(list.filter((row) => row.kind === "message" && row.message.role === "user")).toEqual([
      expect.objectContaining({ aside: false, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
    ]);
    // A run without notes says what it did instead, all of it.
    expect(list[2]).toMatchObject({ note: null, fallback: "Ran 2 commands" });
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
    });
    // The Mate at work is the stretch's tail: its words stream there, in
    // full, and what its hands are on right now is beside its face.
    expect(list[3]).toMatchObject({
      kind: "working",
      turnKey: "msg:m0",
      stream: [{ kind: "note", key: "a1", message: expect.objectContaining({ id: "a1" }) }],
      activity: { kind: "tool" },
      strip: null,
      incidents: [],
    });
  });

  const asked = (id: string, minute: number) =>
    tool(id, "t1", minute, {
      tone: "info",
      label: "User input requested",
      command: undefined as never,
      toolCallId: undefined as never,
      toolLifecycleStatus: undefined as never,
      sourceActivityKind: "user-input.requested",
      inputRequestId: "req-1",
      inputQuestions: [
        { id: "accent", header: "Accent colour", question: "Which accent colour do you prefer?" },
      ],
    });
  // "Nova worked for 7m 5s" counted the three minutes its question waited on
  // the person: the clock says how long the Mate worked, its tooltip the
  // run's whole span (Nova, 2026-09-26).
  it.each([
    { name: "a question", kinds: ["user-input.requested", "user-input.resolved"] as const },
    { name: "an approval", kinds: ["approval.requested", "approval.resolved"] as const },
  ])("leaves the time $name waited on the person out of how long the Mate worked", ({ kinds }) => {
    const waitOn = (id: string, minute: number, kind: (typeof kinds)[number]) =>
      tool(id, "t1", minute, {
        tone: "info",
        label: "Waiting on the person",
        command: undefined as never,
        toolCallId: undefined as never,
        toolLifecycleStatus: undefined as never,
        sourceActivityKind: kind,
      });
    const line = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "One thing first."),
        waitOn("q1", 2, kinds[0]),
        waitOn("q2", 7, kinds[1]),
        tool("w1", "t1", 8),
        assistant("a2", "t1", 9, "Done."),
      ],
      settled: "t1",
    }).find((row) => row.kind === "work-line");
    expect(line).toMatchObject({ waitedMs: 5 * 60_000 });
  });

  it.each([
    { name: "nothing yet: it thinks", entries: [], activity: { kind: "thinking" } },
    {
      name: "thinking after its words: it thinks again",
      entries: [assistant("a1", "t1", 1, "Looking."), reasoning("r1", "t1", 2)],
      activity: { kind: "thinking" },
    },
    {
      name: "a call running: its hands are on it",
      entries: [
        tool("w1", "t1", 1, {
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.started",
        }),
      ],
      activity: { kind: "tool" },
    },
    {
      name: "writing: the dots, its words held until they are known",
      entries: [assistant("a1", "t1", 1, "Writing this now.", { streaming: true })],
      activity: { kind: "writing" },
    },
    {
      name: "a question asked: it waits for the person",
      entries: [assistant("a1", "t1", 1, "One question first."), asked("q1", 2)],
      activity: { kind: "waiting" },
    },
  ])("the Mate at work says what it is on: $name", ({ entries, activity }) => {
    const working = rows({ entries: [user("m0", 0), ...entries], live: "t1" }).find(
      (row) => row.kind === "working",
    );
    expect(working).toMatchObject({ activity });
  });

  it("streams a question the Mate asked as its newest bubble while it waits", () => {
    const working = rows({
      entries: [user("m0", 0), assistant("a1", "t1", 1, "One question first."), asked("q1", 2)],
      live: "t1",
    }).find((row) => row.kind === "working");
    expect(working?.kind === "working" ? working.stream.map((item) => item.kind) : null).toEqual([
      "note",
      "question",
    ]);
    expect(working?.kind === "working" ? working.stream.at(-1) : null).toMatchObject({
      key: "question:q1",
      questions: ["Which accent colour do you prefer?"],
    });
  });

  // Answered, the question and the person's answer stand in the card where
  // the answer arrived; the Mate at work streams on under them from there.
  // Streaming what came before the question under the answer put thoughts
  // from half a minute earlier below the person's reply (Nova, 2026-09-26).
  it("streams on from the person's answer, and what came before stays above it", () => {
    const answered = tool("rs", "t1", 3, {
      tone: "info",
      label: "User input submitted",
      command: undefined as never,
      toolCallId: undefined as never,
      toolLifecycleStatus: undefined as never,
      sourceActivityKind: "user-input.resolved",
      inputRequestId: "req-1",
      inputAnswers: [{ key: "accent", answer: "Green" }],
    });
    const before = [user("m0", 0), assistant("a1", "t1", 1, "One question first."), asked("q1", 2)];
    const waiting = framed({ entries: before, live: "t1" });
    const after = framed({
      entries: [...before, answered, assistant("a2", "t1", 4, "Green it is."), tool("w9", "t1", 5)],
      live: "t1",
    });
    expect(shape(after).slice(-3)).toEqual([
      "answer:answer:rs",
      "working:working:msg:m0:rs",
      "card-end:card-end:msg:m0",
    ]);
    const working = after.find((row) => row.kind === "working");
    expect(working?.kind === "working" ? working.stream.map((item) => item.key) : null).toEqual([
      "a2",
    ]);
    // Everything above the live panel is drawn as it was.
    const panelAt = waiting.findIndex((row) => row.kind === "working");
    expect(frame(after).slice(0, panelAt)).toEqual(frame(waiting).slice(0, panelAt));
  });

  it("draws a turn a finished background task woke before its first words", () => {
    const list = rows({
      entries: [user("m0", 0), assistant("a1", "t1", 1, "Started it."), background("b1", 5)],
      live: "t2",
    });
    expect(shape(list).slice(-3)).toEqual([
      "background:background:b1",
      "work-line:work-line:turn:t2",
      "working:working:turn:t2",
    ]);
    expect(list.at(-1)).toMatchObject({ activity: { kind: "thinking" }, stream: [] });
  });

  // A result that woke the Mate and was answered in one breath flashed a
  // card for a frame: drawn live with the whole answer under it, gone as the
  // run settled 43 ms later, and the answer jumped up (Nova, 2026-09-26).
  it("draws a run with nothing in its log as its answer alone once the answer is known", () => {
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "The review is done.\n\nFour issues stood out."),
    ];
    expect(frame(framed({ entries, live: "t1" }))).toEqual(
      frame(framed({ entries, settled: "t1" })),
    );
  });

  it("keeps the card while the Mate composes, before its answer is known", () => {
    for (const entries of [
      [user("m0", 0)],
      [user("m0", 0), assistant("a1", "t1", 1, "The review is done.")],
    ]) {
      const kinds = rows({ entries, live: "t1" }).map((row) => row.kind);
      expect(kinds).toContain("work-line");
      expect(kinds).toContain("working");
    }
  });

  // Words that cannot be placed yet stream nowhere: the panel says the Mate
  // is writing, a note pops in whole once it moves on, and an answer streams
  // under the card once it reads as one — never first in the panel.
  it("holds the words the Mate is writing until they are known", () => {
    const before = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Reading the routes."),
      tool("w1", "t1", 2),
    ];
    const streamOf = (list: MessagesTimelineRow[]) => {
      const working = list.find((row) => row.kind === "working");
      return working?.kind === "working"
        ? { keys: working.stream.map((item) => item.key), activity: working.activity }
        : null;
    };
    const writing = rows({
      entries: [...before, assistant("a2", "t1", 3, "Checking /status next.")],
      live: "t1",
    });
    expect(streamOf(writing)).toEqual({ keys: ["a1"], activity: { kind: "writing" } });
    expect(writing.some((row) => row.id === "a2")).toBe(false);
    const movedOn = rows({
      entries: [...before, assistant("a2", "t1", 3, "Checking /status next."), tool("w2", "t1", 4)],
      live: "t1",
    });
    expect(streamOf(movedOn)?.keys).toEqual(["a1", "a2"]);
    const answering = rows({
      entries: [...before, assistant("a2", "t1", 3, "All three pass.\n\nThe routes:")],
      live: "t1",
    });
    expect(streamOf(answering)?.keys).toEqual(["a1"]);
    expect(answering.at(-1)?.id).toBe("a2");
  });

  // A background result wakes the Mate. A helper's review came back while the
  // run that started it still worked, and the run it woke had no line saying
  // why it began (Nova, 2026-09-26). Work no turn owns, right before the run,
  // draws its own line already.
  const helperDone = (id: string, turnId: string, minute: number) =>
    tool(id, turnId, minute, {
      label: `Review ${id}`,
      toolTitle: `Review ${id}`,
      taskId: `task-${id}`,
      agentRole: "general-purpose",
      sourceActivityKind: "task.completed",
      tone: "info",
    });
  const shellDone = (id: string, turnId: string, minute: number) =>
    tool(id, turnId, minute, {
      label: `Smoke test ${id}`,
      toolTitle: `Smoke test ${id}`,
      taskId: `task-${id}`,
      sourceActivityKind: "task.completed",
      tone: "info",
    });
  it.each([
    {
      name: "a helper that finished while the run before it worked",
      during: [helperDone("h1", "t1", 2)],
      after: [],
      woke: { entries: [{ id: "h1" }], tasks: 1, failed: 0, helpers: true, title: "Review h1" },
    },
    {
      name: "a background task that finished while the run before it worked",
      during: [shellDone("s1", "t1", 2)],
      after: [],
      woke: {
        entries: [{ id: "s1" }],
        tasks: 1,
        failed: 0,
        helpers: false,
        title: "Smoke test s1",
      },
    },
    {
      name: "two helpers",
      during: [helperDone("h1", "t1", 2), helperDone("h2", "t1", 3)],
      after: [],
      woke: { tasks: 2, helpers: true, title: "Review h2" },
    },
    {
      name: "work no turn owns, right before it",
      during: [],
      after: [background("b1", 5)],
      woke: null,
    },
    { name: "nothing that finished", during: [], after: [], woke: null },
  ])("says what woke a run nobody wrote to start: $name", ({ during, after, woke }) => {
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Started it."),
      ...during,
      assistant("a2", "t1", 4, "It reports back when done."),
      ...after,
      assistant("a3", "t2", 6, "It came back clean."),
    ];
    const list = rows({ entries, settled: "t2" });
    const line = list.find((row) => row.id === "woke:turn:t2");
    if (woke === null) {
      expect(line).toBeUndefined();
      return;
    }
    // It stands where the person's message would: first in the run.
    expect(line).toMatchObject({ kind: "background", ...woke });
    expect(list[list.indexOf(line!) + 1]?.id).toBe("a3");
    expect(shape(rows({ entries, settled: "t2", expanded: ["woke:turn:t2"] }))).toContain(
      `work:woke-entry:${woke.entries?.[0]?.id ?? "h1"}`,
    );
  });

  it("names only what finished since the run before the woken one began", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started it."),
        helperDone("h1", "t1", 2),
        assistant("a2", "t1", 3, "It came back."),
        user("m1", 5),
        assistant("a3", "t2", 6, "Done."),
        assistant("a4", "t3", 8, "Checking in."),
      ],
      settled: "t3",
    });
    expect(list.some((row) => row.id.startsWith("woke:"))).toBe(false);
  });

  it("says what woke a run from its first frame, and the line holds as the run speaks", () => {
    const before = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Started it."),
      helperDone("h1", "t1", 2),
      assistant("a2", "t1", 3, "It reports back when done."),
    ];
    const waking = framed({ entries: before, live: "t2" });
    const speaking = framed({
      entries: [...before, assistant("a3", "t2", 5, "It came back clean.")],
      live: "t2",
    });
    expect(shape(waking).slice(-4)).toEqual([
      "background:woke:turn:t2",
      "work-line:work-line:turn:t2",
      "working:working:turn:t2",
      "card-end:card-end:turn:t2",
    ]);
    const lineAt = waking.findIndex((row) => row.id === "woke:turn:t2");
    expect(frame(speaking).slice(0, lineAt + 2)).toEqual(frame(waking).slice(0, lineAt + 2));
  });

  const typeCheck = (id: string, minute: number, failed: boolean) =>
    tool(id, "t1", minute, {
      label: "Run the type check",
      tone: failed ? "error" : "info",
      sourceActivityKind: "task.completed",
    });
  it.each([
    {
      name: "the Mate's words stream oldest first, every one of them, to scroll back through",
      entries: [
        assistant("a1", "t1", 1, "One."),
        tool("w1", "t1", 2),
        assistant("a2", "t1", 3, "Two."),
        assistant("a3", "t1", 4, "Three."),
        assistant("a4", "t1", 5, "Four."),
        assistant("a5", "t1", 6, "Five."),
        assistant("a6", "t1", 7, "Six."),
        assistant("a7", "t1", 8, "Seven."),
        tool("w2", "t1", 9),
      ],
      stream: ["One.", "Two.", "Three.", "Four.", "Five.", "Six.", "Seven."],
    },
    {
      name: "what it thinks streams too, in order with what it says",
      entries: [
        reasoning("r1", "t1", 1),
        tool("w1", "t1", 2),
        assistant("a1", "t1", 3, "Deploying."),
        reasoning("r2", "t1", 4),
      ],
      stream: ["~ thinking about it", "Deploying.", "~ thinking about it"],
    },
    {
      name: "words that read as the answer leave the stream: they stream under the card",
      entries: [
        assistant("a1", "t1", 1, "Deploying."),
        tool("w1", "t1", 2),
        assistant("a2", "t1", 3, "It is live.\n\n**What changed**"),
      ],
      stream: ["Deploying."],
    },
    {
      name: "a step that failed on the way streams where it failed",
      entries: [
        assistant("a1", "t1", 1, "Type checking."),
        typeCheck("t9", 2, true),
        assistant("a2", "t1", 3, "Fixing the types."),
        tool("w1", "t1", 4),
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
              : item.kind === "thought"
                ? `~ ${item.text}`
                : item.kind === "question"
                  ? `? ${item.questions.join(" ")}`
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
          pairs: [{ key: "accent", question: "Which accent colour?", answer: "Green" }],
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

  // A /compact the harness ran without a turn of its own was claimed by the
  // person's next message's turn as its opener: that message became a message
  // "sent into" the compaction, and the compaction's one line swallowed the
  // run — two and a half hours of a real conversation drew nothing but three
  // "Context condensed" lines (the owner, 2026-09-26: "I sent a message and
  // its completely gone from the chat log").
  const compacted = tool("c1", "t1", 1, {
    sourceActivityKind: "context-compaction",
    label: "Context compacted",
  });
  it.each([
    {
      name: "a /compact with no turn of its own, then a run",
      entries: [
        user("m0", 0, "/compact"),
        user("m1", 5),
        reasoning("r1", "t2", 6),
        tool("w1", "t2", 7),
      ],
      live: "t2",
      settled: undefined,
      after: ["message:m1", "work-line:work-line:msg:m1", "working:working:msg:m1"],
    },
    {
      name: "a /compact with no turn of its own, then a settled run",
      entries: [
        user("m0", 0, "/compact"),
        user("m1", 5),
        tool("w1", "t2", 7),
        assistant("a1", "t2", 8, "Done."),
      ],
      live: undefined,
      settled: "t2",
      after: ["message:m1", "work-line:work-line:msg:m1", "message:a1"],
    },
    {
      name: "a /compact's own turn, then a run",
      entries: [
        user("m0", 0, "/compact"),
        compacted,
        user("m1", 5),
        tool("w1", "t2", 7),
        assistant("a1", "t2", 8, "Done."),
      ],
      live: undefined,
      settled: "t2",
      after: ["message:m1", "work-line:work-line:msg:m1", "message:a1"],
    },
    {
      name: "a message sent while the /compact ran",
      entries: [
        user("m0", 0, "/compact"),
        compacted,
        user("m1", 2),
        tool("w1", "t1", 3),
        assistant("a1", "t1", 4, "Done."),
      ],
      live: undefined,
      settled: "t1",
      after: ["message:m1", "work-line:work-line:msg:m1", "message:a1"],
    },
  ])("draws the person's message after $name as theirs, and its run", (scene) => {
    const list = rows({
      entries: scene.entries,
      ...(scene.live ? { live: scene.live } : {}),
      ...(scene.settled ? { settled: scene.settled } : {}),
    });
    const drawn = shape(list).filter((row) => !row.startsWith("seam:"));
    expect(drawn[0]).toBe("event:m0");
    expect(list.find((row) => row.id === "m0")).toMatchObject({ event: { done: true } });
    expect(drawn.slice(1)).toEqual(scene.after);
    expect(list.find((row) => row.id === "m1")).toMatchObject({ kind: "message", aside: false });
  });

  it("says a /compact that ran without a turn is done once nothing runs", () => {
    const list = rows({ entries: [user("m0", 0, "/compact")] });
    expect(list.find((row) => row.id === "m0")).toMatchObject({
      kind: "event",
      event: { done: true },
    });
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
    expect(rows(scene)[3]).toMatchObject({
      entries: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
      tasks: 3,
      failed: 0,
      title: "Task b3",
    });
    expect(shape(rows({ ...scene, expanded: ["background:b1"] })).slice(3, 7)).toEqual([
      "background:background:b1",
      "work:log-entry:b1",
      "work:log-entry:b2",
      "work:log-entry:b3",
    ]);
  });

  it("counts a background run by its tasks, not by what each one reported", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started."),
        background("p1", 5, { taskId: "task-1", sourceActivityKind: "task.progress" }),
        background("p2", 6, { taskId: "task-1", sourceActivityKind: "task.progress" }),
        background("c1", 7, { taskId: "task-1", label: "Watch the logs" }),
        background("c2", 8, { taskId: "task-2", label: "Run the tests", tone: "error" }),
      ],
      settled: "t1",
    });
    expect(list.find((row) => row.kind === "background")).toMatchObject({
      tasks: 2,
      failed: 1,
      title: "Run the tests",
    });
  });

  it("says the words the person answered once: in the opened log, else in the speech", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Deploying now."),
        user("m1", 3, "and the footer"),
      ],
      live: "t1",
      open: ["msg:m0"],
    });
    expect(shape(list).slice(1, 6)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "log-activity:log-activity:w1",
      "log-note:log-note:a1",
      "message:m1",
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

describe("thoughtParagraphs", () => {
  it.each([
    { text: "One.", paragraphs: ["One."] },
    { text: "One.\n\nTwo.\n\n\nThree.", paragraphs: ["One.", "Two.", "Three."] },
    {
      text: "**Checking the menu**\n\nThe panel glides.\n\n**Next**\n\nThe keyboard.",
      paragraphs: ["**Checking the menu**\n\nThe panel glides.", "**Next**\n\nThe keyboard."],
    },
    { text: "The panel glides.\n\n**Next**", paragraphs: ["The panel glides.", "**Next**"] },
    { text: "  \n\n ", paragraphs: [] },
  ])("$text", ({ text, paragraphs }) => {
    expect(thoughtParagraphs(text)).toEqual(paragraphs);
  });
});

describe("a stretch's card", () => {
  // Every stretch of work is one card, from its line to its edge: the log,
  // the Mate at work, the words the person answered and the report inside;
  // the person's messages and the Mate's answer on the conversation's edge.
  const cards = (list: MessagesTimelineRow[]) =>
    list
      .filter((row) => row.kind !== "seam")
      .map((row) => `${row.kind}${row.card === undefined ? "" : `:${row.card}`}`);

  it.each([
    {
      case: "settled, closed, with a report: its line, the report, its edge; the answer outside",
      scene: {
        entries: [
          user("m0", 0),
          operation("d1", "t1", 1, { kind: "deploy" }),
          assistant("a1", "t1", 2, "Done."),
        ],
        settled: "t1",
      } satisfies Scene,
      expected: ["message", "work-line:top", "outcome:middle", "card-end:bottom", "message"],
    },
    {
      case: "settled, closed, nothing under its line: one quiet line, no empty box",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
        settled: "t1",
      } satisfies Scene,
      expected: ["message", "work-line", "message"],
    },
    {
      case: "settled, opened: the log inside the card",
      scene: {
        entries: [
          user("m0", 0),
          reasoning("r1", "t1", 1),
          tool("w1", "t1", 1),
          assistant("a1", "t1", 2, "Looking."),
          assistant("a2", "t1", 3, "Done."),
        ],
        settled: "t1",
        open: ["msg:m0"],
      } satisfies Scene,
      expected: [
        "message",
        "work-line:top",
        "log-reasoning:middle",
        "log-activity:middle",
        "log-note:middle",
        "card-end:bottom",
        "message",
      ],
    },
    {
      case: "live: the Mate at work is the card's body",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Looking.")],
        live: "t1",
      } satisfies Scene,
      expected: ["message", "work-line:top", "working:middle", "card-end:bottom"],
    },
    {
      case: "written into: the person's message inside the card, under the words it answered",
      scene: {
        entries: [
          user("m0", 0),
          tool("w1", "t1", 1),
          assistant("a1", "t1", 2, "Which colour?"),
          user("m1", 3, "Blue"),
          tool("w2", "t1", 4),
        ],
        live: "t1",
      } satisfies Scene,
      // The run goes on after the person's message: one card, the message
      // inside it under the Mate's words it answered, the Mate still at work.
      expected: [
        "message",
        "work-line:top",
        "speech:middle",
        "message:middle",
        "working:middle",
        "card-end:bottom",
      ],
    },
    {
      case: "an answer with no work before it: no card",
      scene: {
        entries: [user("m0", 0), assistant("a1", "t1", 1, "Hi.")],
        settled: "t1",
      } satisfies Scene,
      expected: ["message", "message"],
    },
  ])("$case", ({ scene, expected }) => {
    expect(cards(framed(scene))).toEqual(expected);
  });

  it("streams a running turn's answer under its card, the panel saying nothing of its own", () => {
    const list = framed({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
      ],
      live: "t1",
    });
    expect(cards(list)).toEqual([
      "message",
      "work-line:top",
      "working:middle",
      "card-end:bottom",
      "message",
    ]);
    expect(list.at(-1)).toMatchObject({ kind: "message", id: "a1" });
    expect(list.find((row) => row.kind === "working")).toMatchObject({ answering: true });
  });

  it("keeps the room after a card that the card's last row kept", () => {
    const list = framed({
      entries: [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy" }),
        assistant("a1", "t1", 2, "Done."),
      ],
      settled: "t1",
    });
    const edge = list.findIndex((row) => row.kind === "card-end");
    expect(list[edge]!.gap).toBe("none");
    expect(list[edge + 1]!.gap).toBe(rowGap(list[edge - 1], list[edge + 1]!));
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
  // A running turn's answer streams under its card: it is the live tail too.
  const liveTailStart = (list: MessagesTimelineRow[], live: boolean) => {
    let end = list.length;
    while (end > 0) {
      const row = list[end - 1]!;
      if (
        row.kind === "working" ||
        row.kind === "card-end" ||
        (row.kind === "work-line" && row.live) ||
        (live && row.kind === "message" && row.message.role === "assistant")
      )
        end -= 1;
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
      const current = framed({ entries, ...(live ? { live: "t1" } : { settled: "t1" }), open });
      const settling = wasLive && !live;
      const liveLineEnd = previous.findLastIndex((row) => row.kind === "work-line" && row.live) + 1;
      const bound = settling
        ? Math.min(liveTailStart(previous, wasLive), liveLineEnd)
        : liveTailStart(previous, wasLive);
      expect(frame(current).slice(0, bound)).toEqual(frame(previous).slice(0, bound));
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

  it("holds while the answer streams under the card, and as the turn settles", () => {
    holds(
      [
        { entry: user("m0", 0), live: true },
        { entry: reasoning("r1", "t1", 1), live: true },
        { entry: tool("w1", "t1", 2), live: true },
        { entry: assistant("a1", "t1", 3, "Deploying."), live: true },
        { entry: operation("d1", "t1", 4, { kind: "deploy" }), live: true },
        { entry: assistant("a2", "t1", 5, "It is live.\n\n**What changed**"), live: true },
        { entry: landed("l1", 6), live: false },
      ],
      [],
    );
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
