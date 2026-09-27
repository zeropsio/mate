import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  rowGap,
  thoughtParagraphs,
  thoughtPreview,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
  type MessagesTimelineRow,
  type RecordItem,
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
  /** The minute the latest turn started, when not the conversation's first. */
  startedAt?: number;
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
          startedAt: at(scene.startedAt ?? 0),
          completedAt: scene.live ? null : at(59),
        }
      : null,
    runningTurnId: scene.live ? turn(scene.live) : null,
    isWorking: scene.working ?? scene.live !== undefined,
    activeTurnStartedAt: scene.live ? at(scene.startedAt ?? 0) : null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
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

/** The run's record, as the card draws it. */
const recordOf = (list: MessagesTimelineRow[]) => {
  const record = list.find((row) => row.kind === "record");
  return record?.kind === "record" ? record : null;
};

/** A record's lines, each as a person would read it at a glance. */
const said = (item: RecordItem): string => {
  switch (item.kind) {
    case "step":
      return `· ${item.step.words ?? item.step.code}`;
    case "call":
      return `· ${item.entry.label}`;
    case "thought":
      return `~ ${thoughtPreview(item.messages)}`;
    case "note":
      return item.message.text;
    case "person":
      return `> ${item.words ?? item.message?.text ?? ""}`;
    case "operation":
      return `${item.operation.phase === "failed" ? "✗" : "✓"} ${item.operation.kind} ${item.operation.subject}`;
    case "helpers":
      return `helpers ${item.entry.agentSpawn?.agentTaskIds.length ?? 0}`;
    case "task":
      return `${item.entry.tone === "error" ? "✗" : "✓"} ${item.entry.label}`;
    case "plan":
      return "plan";
    case "strip":
      return "strip";
    case "incident":
      return `incident ${item.incident.hostname}`;
    case "event":
      return `event ${item.event.type}`;
    case "error":
      return `error ${item.entry.label}`;
  }
};

const lines = (list: MessagesTimelineRow[]) => recordOf(list)?.items.map(said) ?? null;

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

const answeredWith = (id: string, minute: number, answer: string) =>
  tool(id, "t1", minute, {
    tone: "info",
    label: "User input submitted",
    command: undefined as never,
    toolCallId: undefined as never,
    toolLifecycleStatus: undefined as never,
    sourceActivityKind: "user-input.resolved",
    inputRequestId: "req-1",
    inputAnswers: [{ key: "accent", answer }],
  });

describe("deriveMessagesTimelineRows", () => {
  it("draws a settled run as the message, its card — heading, record, result — and the answer", () => {
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
      "record:record:msg:m0",
      "outcome:outcome:msg:m0",
      "message:a2",
    ]);
    expect(list[2]).toMatchObject({
      kind: "work-line",
      live: false,
      face: "idle",
      worked: true,
      startedAt: at(0),
    });
    // The record keeps everything it did, in order, once the run is over.
    expect(lines(list)).toEqual([
      "~ thinking about it",
      "· pnpm test",
      "**Building** the shop now.",
      "· pnpm test",
    ]);
    expect(recordOf(list)).toMatchObject({ live: false, now: null });
    // What its calls came to is the result's, in pills (the owner, 2026-09-27).
    expect(list[4]).toMatchObject({
      outcome: { activity: [{ kind: "command", count: 2, words: "Ran 2 commands" }] },
    });
    expect(list[5]).toMatchObject({ showAssistantMeta: true, receipt: null });
  });

  it("keeps every message the person sent where they sent it, and marks each in the record", () => {
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
      "message:m1",
      "message:m2",
      "work-line:work-line:msg:m0",
      "record:record:msg:m0",
      "outcome:outcome:msg:m0",
      "message:a3",
    ]);
    expect(list.filter((row) => row.kind === "message" && row.message.role === "user")).toEqual([
      expect.objectContaining({ aside: false, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
    ]);
    expect(lines(list)).toEqual(["· pnpm test", "> message m1", "· pnpm test", "> message m2"]);
  });

  it("keeps the running run's heading live, its record, and what its hands are on at the end", () => {
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
      "record:record:msg:m0",
      "working:working:msg:m0",
    ]);
    expect(list[2]).toMatchObject({ live: true, face: "working", endedAt: null });
    // The call it is making is beside its face, never a line of the record yet.
    expect(recordOf(list)).toMatchObject({
      live: true,
      answering: false,
      now: { kind: "step", step: { state: "running" } },
    });
    expect(lines(list)).toEqual(["Checking the build."]);
    expect(list[4]).toMatchObject({
      kind: "working",
      turnKey: "msg:m0",
      cardKey: "msg:m0",
      strip: null,
      incidents: [],
    });
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

  // Live, the clock stops while the question waits and leaves the wait out
  // once answered, so it never drops as the run settles; a run stopped while
  // it waited counts the wait as the person's to its end.
  it.each([
    { name: "while it waits", live: true, answered: false, waited: 0, since: 2 },
    { name: "once answered", live: true, answered: true, waited: 5, since: null },
    { name: "stopped while it waited", live: false, answered: false, waited: 7, since: null },
  ])("keeps the clock on the Mate's own work $name", ({ live, answered, waited, since }) => {
    const waitOn = (id: string, minute: number, kind: string) =>
      tool(id, "t1", minute, {
        tone: "info",
        label: "Waiting on the person",
        command: undefined as never,
        toolCallId: undefined as never,
        toolLifecycleStatus: undefined as never,
        sourceActivityKind: kind as never,
      });
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "One thing first."),
      waitOn("q1", 2, "user-input.requested"),
      ...(answered ? [waitOn("q2", 7, "user-input.resolved")] : []),
      tool("w1", "t1", answered ? 8 : 9, live ? {} : { toolLifecycleStatus: "completed" }),
    ];
    const line = rows(live ? { entries, live: "t1" } : { entries, settled: "t1" }).find(
      (row) => row.kind === "work-line",
    );
    expect(line).toMatchObject({
      waitedMs: waited * 60_000,
      waitingSince: since === null ? null : at(since),
    });
  });

  it.each([
    { name: "nothing yet: it thinks", entries: [], now: { kind: "thinking", messages: [] } },
    {
      name: "thinking after its words: the thought it is thinking",
      entries: [assistant("a1", "t1", 1, "Looking."), reasoning("r1", "t1", 2)],
      now: { kind: "thinking", messages: [expect.objectContaining({ id: "r1" })] },
    },
    {
      name: "a call returned after its thought: between steps",
      entries: [reasoning("r1", "t1", 1), tool("w1", "t1", 2)],
      now: { kind: "thinking", messages: [] },
    },
    {
      name: "a call running: its hands are on it",
      entries: [
        tool("w1", "t1", 1, {
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.started",
        }),
      ],
      now: { kind: "step" },
    },
    {
      name: "writing: the dots, its words held until they are known",
      entries: [assistant("a1", "t1", 1, "Writing this now.", { streaming: true })],
      now: { kind: "writing" },
    },
    {
      name: "a question asked: it waits for the person",
      entries: [assistant("a1", "t1", 1, "One question first."), asked("q1", 2)],
      now: { kind: "waiting" },
    },
  ])("says beside its face what the Mate is on: $name", ({ entries, now }) => {
    expect(recordOf(rows({ entries: [user("m0", 0), ...entries], live: "t1" }))).toMatchObject({
      now,
    });
  });

  // The thought it is thinking is beside its face and nowhere else: the
  // record takes it once it ends (the owner, 2026-09-27: "it literally
  // duplicates what's the mate bubbles").
  it("draws the thought in progress beside the face alone, and in the record once it ended", () => {
    const thinking = rows({
      entries: [user("m0", 0), tool("w1", "t1", 1), reasoning("r1", "t1", 2)],
      live: "t1",
    });
    expect(lines(thinking)).toEqual(["· pnpm test"]);
    expect(recordOf(thinking)?.now).toMatchObject({ kind: "thinking" });
    const moved = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        reasoning("r1", "t1", 2),
        assistant("a1", "t1", 4, "Found it."),
      ],
      live: "t1",
    });
    expect(lines(moved)).toEqual(["· pnpm test", "~ thinking about it", "Found it."]);
  });

  // A call is first seen when it starts, and the Mate's words before it can
  // carry a later time: sorted by its start, the step that returned landed
  // above the note said before it, pushing it down (Nova, 2026-09-27, caught
  // by a live sampler). A line stands where it joined the record.
  it("lands a returning step at the record's end, after the words said before it", () => {
    const call = (status: "inProgress" | "completed") =>
      tool("w2", "t1", 3, {
        toolLifecycleStatus: status,
        sourceActivityKind: status === "inProgress" ? "tool.started" : "tool.completed",
        ...(status === "completed" ? { updatedAt: at(5) } : {}),
      });
    const before = [
      user("m0", 0),
      tool("w1", "t1", 1),
      call("inProgress"),
      assistant("a1", "t1", 3, "Now checking memory.", { second: 30 }),
    ];
    const running = rows({ entries: before, live: "t1" });
    expect(lines(running)).toEqual(["· pnpm test", "Now checking memory."]);
    const returned = rows({
      entries: [...before.slice(0, 2), call("completed"), before[3]!],
      live: "t1",
    });
    expect(lines(returned)).toEqual(["· pnpm test", "Now checking memory.", "· pnpm test"]);
    const settled = rows({
      entries: [
        ...before.slice(0, 2),
        call("completed"),
        before[3]!,
        assistant("a2", "t1", 6, "Done."),
      ],
      settled: "t1",
    });
    expect(lines(settled)).toEqual(["· pnpm test", "Now checking memory.", "· pnpm test"]);
  });

  // A call still running when the person wrote into the run is a running line
  // at the end of its part, and stays there when it returns; only the call
  // the Mate is making now stands beside its face.
  it("keeps a call that ran on past the person's message where it stood", () => {
    const build = (status: "inProgress" | "completed") =>
      tool("w1", "t1", 1, {
        toolLifecycleStatus: status,
        sourceActivityKind: status === "inProgress" ? "tool.started" : "tool.completed",
        ...(status === "completed" ? { updatedAt: at(4) } : {}),
      });
    const scene = (status: "inProgress" | "completed") =>
      rows({
        entries: [
          user("m0", 0),
          build(status),
          user("m1", 2, "and the footer"),
          tool("w2", "t1", 3),
        ],
        live: "t1",
      });
    const running = scene("inProgress");
    expect(lines(running)).toEqual(["· pnpm test", "> and the footer", "· pnpm test"]);
    expect(recordOf(running)?.items[0]).toMatchObject({ step: { state: "running" } });
    const returned = scene("completed");
    expect(recordOf(returned)?.items.map((item) => item.key)).toEqual(
      recordOf(running)?.items.map((item) => item.key),
    );
  });

  // A task that names no call and ended while a command still runs may be
  // that command's own: it waits, so it never stands a moment as a line of
  // its own and then turns into the command's step (replayed on three real
  // threads, 2026-09-27).
  it("holds a task that names no call while a command still runs", () => {
    const command = (status: "inProgress" | "completed") =>
      tool("c1", "t1", 1, {
        command: "npm run build",
        toolLifecycleStatus: status,
        sourceActivityKind: status === "inProgress" ? "tool.started" : "tool.completed",
        ...(status === "completed" ? { updatedAt: at(1, 31) } : {}),
      });
    const task = tool("k1", "t1", 1, {
      label: "Build the app",
      toolTitle: "Build the app",
      tone: "info",
      command: undefined as never,
      toolCallId: undefined as never,
      toolLifecycleStatus: undefined as never,
      sourceActivityKind: "task.completed",
      taskId: "bk1",
      createdAt: at(1, 30),
    });
    const running = rows({ entries: [user("m0", 0), command("inProgress"), task], live: "t1" });
    expect(lines(running)).toEqual([]);
    const returned = rows({ entries: [user("m0", 0), command("completed"), task], live: "t1" });
    expect(lines(returned)).toEqual(["· Build the app"]);
  });

  // A command it left running in the background returned: its line is in the
  // record from the moment it started, running, while its bar says it runs.
  it("draws a background command as a running line, its call returned", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1, { command: "npm run dev", toolCallId: "toolu_1" }),
        tool("k1", "t1", 1, {
          label: "Serve the app on port 3000",
          toolTitle: "Serve the app on port 3000",
          tone: "info",
          command: undefined as never,
          sourceActivityKind: "task.started",
          toolLifecycleStatus: "inProgress",
          taskId: "bk1",
          taskToolUseId: "toolu_1",
        } as never),
        assistant("a1", "t1", 2, "The server is up."),
      ],
      live: "t1",
    });
    expect(recordOf(list)?.items[0]).toMatchObject({
      kind: "step",
      step: { words: "Serve the app on port 3000", code: "npm run dev", state: "running" },
    });
  });

  // Answered, the question and the person's answer stand on the page where
  // the answer arrived; the record marks where it reached the Mate and goes
  // on from there.
  it("marks the person's answer in the record, the question and answer on the page", () => {
    const before = [user("m0", 0), assistant("a1", "t1", 1, "One question first."), asked("q1", 2)];
    const waiting = framed({ entries: before, live: "t1" });
    const after = framed({
      entries: [
        ...before,
        answeredWith("rs", 3, "Green"),
        assistant("a2", "t1", 4, "Green it is."),
        tool("w9", "t1", 5),
      ],
      live: "t1",
    });
    expect(shape(after).slice(-5)).toEqual([
      "answer:answer:rs",
      "work-line:work-line:msg:m0",
      "record:record:msg:m0",
      "working:working:msg:m0",
      "card-end:card-end:msg:m0",
    ]);
    expect(lines(after)).toEqual(["One question first.", "> Green", "Green it is.", "· pnpm test"]);
    // Everything above the live card is drawn as it was: the answer lands
    // over it, and the card goes on under the answer.
    const cardAt = waiting.findIndex((row) => row.kind === "work-line" && row.live);
    expect(frame(after).slice(0, cardAt)).toEqual(frame(waiting).slice(0, cardAt));
  });

  it("sets no earlier words between a question's answer and the person's next message", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "One question first."),
        asked("q1", 2),
        answeredWith("rs", 3, "Green"),
        user("m1", 4, "and make it bold"),
        tool("w9", "t1", 5),
      ],
      live: "t1",
    });
    expect(shape(list).slice(1, 4)).toEqual(["message:m0", "answer:answer:rs", "message:m1"]);
  });

  it("draws a run a finished background task woke, before its first words", () => {
    const list = rows({
      entries: [user("m0", 0), assistant("a1", "t1", 1, "Started it."), background("b1", 5)],
      live: "t2",
    });
    expect(shape(list).slice(-4)).toEqual([
      "background:background:b1",
      "work-line:work-line:turn:t2",
      "record:record:turn:t2",
      "working:working:turn:t2",
    ]);
    expect(recordOf(list)).toMatchObject({ items: [], now: { kind: "thinking", messages: [] } });
  });

  // The question and the person's answer stand on the page; its tool call
  // said again as "Used AskUserQuestion" put an internal name over its own
  // question (Nova, 2026-09-26).
  it("says the Mate's question as the question alone, never as its tool", () => {
    const ask = tool("c1", "t1", 2, {
      itemType: "dynamic_tool_call",
      label: "Tool call",
      command: undefined as never,
      detail: 'AskUserQuestion: {"questions":[{"question":"Teal or amber?"}]}',
    });
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "One thing first."),
        ask,
        tool("w1", "t1", 3),
        assistant("a2", "t1", 4, "Done."),
      ],
      settled: "t1",
    });
    const logged = recordOf(list)?.items.flatMap((item) =>
      item.kind === "step" ? item.step.entries.map((entry) => entry.id) : [],
    );
    expect(logged).toEqual(["w1"]);
    const outcome = list.find((row) => row.kind === "outcome");
    expect(
      outcome?.kind === "outcome" ? outcome.outcome.activity.map((pill) => pill.words) : null,
    ).toEqual(["Ran 1 command"]);
  });

  // A run that only asked the person something asked: it worked, it did not
  // only think.
  it("says a run that only asked the person something worked", () => {
    const line = rows({
      entries: [
        user("m0", 0),
        asked("q1", 1),
        answeredWith("rs", 2, "Teal"),
        assistant("a2", "t1", 4, "Teal it is."),
      ],
      settled: "t1",
    }).find((row) => row.kind === "work-line");
    expect(line).toMatchObject({ worked: true });
  });

  // A result that woke the Mate and was answered in one breath flashed a
  // card for a frame: drawn live with the whole answer under it, gone as the
  // run settled 43 ms later, and the answer jumped up (Nova, 2026-09-26).
  it("draws a run with nothing in its record as its answer alone once the answer is known", () => {
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
      expect(kinds).toEqual(expect.arrayContaining(["work-line", "record", "working"]));
    }
  });

  // Words that cannot be placed yet stand nowhere: the face says the Mate is
  // writing, a note joins the record whole once it moves on, and an answer
  // streams under the card once it reads as one — never first in the record.
  it("holds the words the Mate is writing until they are known", () => {
    const before = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Reading the routes."),
      tool("w1", "t1", 2),
    ];
    const writing = rows({
      entries: [...before, assistant("a2", "t1", 3, "Checking /status next.", { streaming: true })],
      live: "t1",
    });
    expect(lines(writing)).toEqual(["Reading the routes.", "· pnpm test"]);
    expect(recordOf(writing)?.now).toEqual({ kind: "writing" });
    expect(writing.some((row) => row.id === "a2")).toBe(false);
    // Written out, a line is a note, whether or not a step follows yet.
    const written = rows({
      entries: [...before, assistant("a2", "t1", 3, "Checking /status next.")],
      live: "t1",
    });
    expect(lines(written)).toEqual([
      "Reading the routes.",
      "· pnpm test",
      "Checking /status next.",
    ]);
    const movedOn = rows({
      entries: [...before, assistant("a2", "t1", 3, "Checking /status next."), tool("w2", "t1", 4)],
      live: "t1",
    });
    expect(lines(movedOn)).toEqual([
      "Reading the routes.",
      "· pnpm test",
      "Checking /status next.",
      "· pnpm test",
    ]);
    const answering = rows({
      entries: [...before, assistant("a2", "t1", 3, "All three pass.\n\nThe routes:")],
      live: "t1",
    });
    expect(lines(answering)).toEqual(["Reading the routes.", "· pnpm test"]);
    expect(recordOf(answering)).toMatchObject({ answering: true, now: null });
    expect(answering.at(-1)?.id).toBe("a2");
  });

  // A background result wakes the Mate. A helper's review came back after the
  // run that started it ended, and the run it woke had no line saying why it
  // began (Nova, 2026-09-26). What finished while the run before still
  // worked is not what woke the next one: named by where it stood, a task
  // done ten minutes before was said to wake a run the harness started
  // (Juno). Work no turn owns, right before the run, draws its own line.
  // A helper's row stands where it was spawned and takes each report as it
  // comes: it finished at its last update.
  const helperDone = (id: string, turnId: string, spawned: number, done: number) =>
    tool(id, turnId, spawned, {
      label: `Review ${id}`,
      toolTitle: `Review ${id}`,
      taskId: `task-${id}`,
      agentRole: "general-purpose",
      sourceActivityKind: "task.completed",
      tone: "info",
      updatedAt: at(Math.floor(done), Math.round((done % 1) * 60)),
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
      name: "a helper that finished after the run before it ended",
      during: [helperDone("h1", "t1", 2, 5)],
      after: [],
      woke: { entries: [{ id: "h1" }], tasks: 1, failed: 0, helpers: true, title: "Review h1" },
    },
    {
      name: "a background task that finished after the run before it ended",
      during: [],
      after: [shellDone("s1", "t1", 5)],
      woke: {
        entries: [{ id: "s1" }],
        tasks: 1,
        failed: 0,
        helpers: false,
        title: "Smoke test s1",
      },
    },
    {
      name: "two helpers, in the order they finished",
      during: [helperDone("h1", "t1", 2, 5), helperDone("h2", "t1", 3, 4.5)],
      after: [],
      woke: { entries: [{ id: "h2" }, { id: "h1" }], tasks: 2, helpers: true, title: "Review h1" },
    },
    {
      name: "a helper that finished while the run before it still worked",
      during: [helperDone("h1", "t1", 2, 3)],
      after: [],
      woke: null,
    },
    {
      name: "a helper that finished after the run began",
      during: [helperDone("h1", "t1", 2, 7)],
      after: [],
      woke: null,
    },
    {
      name: "helpers gathered in one row, which of them finished unknown",
      during: [
        {
          ...helperDone("h1", "t1", 2, 5),
          entry: {
            ...(helperDone("h1", "t1", 2, 5) as Extract<TimelineEntry, { kind: "work" }>).entry,
            agentSpawn: { workflowId: null, agentTaskIds: ["task-h1", "task-h2"] },
          },
        } as TimelineEntry,
      ],
      after: [],
      woke: null,
    },
    {
      name: "work no turn owns, right before it",
      during: [],
      after: [background("b1", 5)],
      woke: null,
    },
    // Two shell tasks said in their own line did not wake Juno's run; the
    // research helper that finished after them did.
    {
      name: "a helper that finished after work no turn owns",
      during: [helperDone("h1", "t1", 2, 5.5)],
      after: [background("b1", 5)],
      woke: { entries: [{ id: "h1" }], tasks: 1, helpers: true, title: "Review h1" },
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
  });

  // A helper's row stands where it was spawned and takes each report as it
  // comes: its line lands where it finished — the record's end, while the
  // run goes on — and one that finished after its run is what woke the next,
  // never a line of the run that started it.
  it.each([
    { name: "during the run: at the record's end", live: true, done: 4, last: "✓ Review h1" },
    { name: "after the run: not in its record", live: false, done: 8, last: "· pnpm test" },
  ])("draws a helper's report where it finished, $name", ({ live, done, last }) => {
    const list = rows({
      entries: [
        user("m0", 0),
        helperDone("h1", "t1", 1, done),
        tool("w1", "t1", 2),
        assistant("a1", "t1", 3, live ? "Waiting on the review." : "Done."),
      ],
      ...(live ? { live: "t1" } : { settled: "t1" }),
    });
    expect(lines(list)?.at(-1)).toBe(last);
    expect(lines(list)?.filter((line) => line.includes("Review h1"))).toHaveLength(live ? 1 : 0);
  });

  // A run a finished task woke that did nothing to see is nothing to
  // announce (the owner, 2026-09-27, of a lone "Background task finished"
  // line: "why does it say here?").
  it("draws nothing of a woken run that showed nothing", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started it."),
        shellDone("s1", "t1", 2),
        assistant("a2", "t1", 3, "It reports back when done."),
        shellDone("s2", "t1", 5),
        tool("p9", "t2", 6, {
          label: "Watching the logs",
          tone: "info",
          command: undefined as never,
          taskId: "task-watch",
          sourceActivityKind: "task.progress",
        }),
      ],
      settled: "t2",
    });
    expect(list.some((row) => row.id.startsWith("woke:"))).toBe(false);
    expect(list.some((row) => row.id.endsWith("turn:t2"))).toBe(false);
  });

  it("names only what finished since the run before the woken one ended", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started it."),
        helperDone("h1", "t1", 2, 3),
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
      helperDone("h1", "t1", 2, 4),
      assistant("a2", "t1", 3, "It reports back when done."),
    ];
    const waking = framed({ entries: before, live: "t2", startedAt: 5 });
    const speaking = framed({
      entries: [...before, assistant("a3", "t2", 5, "It came back clean.")],
      live: "t2",
      startedAt: 5,
    });
    expect(shape(waking).slice(-5)).toEqual([
      "background:woke:turn:t2",
      "work-line:work-line:turn:t2",
      "record:record:turn:t2",
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
      name: "every word and step it took is in the record, oldest first",
      entries: [
        assistant("a1", "t1", 1, "One."),
        tool("w1", "t1", 2),
        assistant("a2", "t1", 3, "Two."),
        assistant("a3", "t1", 4, "Three."),
        tool("w2", "t1", 9),
      ],
      record: ["One.", "· pnpm test", "Two.", "Three.", "· pnpm test"],
    },
    {
      name: "what it thought is a line of it, in order with what it said and did",
      entries: [
        reasoning("r1", "t1", 1),
        tool("w1", "t1", 2),
        assistant("a1", "t1", 3, "Deploying."),
        reasoning("r2", "t1", 4),
      ],
      record: ["~ thinking about it", "· pnpm test", "Deploying."],
    },
    {
      name: "an operation still running is beside its face; its line comes once it settles",
      entries: [
        assistant("a1", "t1", 1, "Deploying."),
        operation("d1", "t1", 2, {
          kind: "deploy",
          phase: "running",
          settledAt: undefined as never,
        }),
      ],
      record: ["Deploying."],
    },
    {
      name: "a task that failed on the way is a line where it failed, and so is its retry",
      entries: [
        assistant("a1", "t1", 1, "Type checking."),
        typeCheck("t9", 2, true),
        assistant("a2", "t1", 3, "Fixing the types."),
        typeCheck("t10", 4, false),
      ],
      record: [
        "Type checking.",
        "✗ Run the type check",
        "Fixing the types.",
        "✓ Run the type check",
      ],
    },
    {
      name: "a settled operation is a line; a check is the browser's while it runs",
      entries: [
        operation("v1", "t1", 1, { kind: "verify", phase: "failed", statusWord: "Unhealthy" }),
        operation("d1", "t1", 2, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        operation("b1", "t1", 3, { kind: "browser", phase: "failed", statusWord: "Failed" }),
        operation("v2", "t1", 4, { kind: "verify", phase: "done", statusWord: "Healthy" }),
      ],
      record: ["✗ verify appdev", "✗ deploy appdev", "✓ verify appdev"],
    },
    {
      name: "words that are only space are no note; a step it took is a line",
      entries: [assistant("a1", "t1", 1, "  "), tool("w1", "t1", 2)],
      record: ["· pnpm test"],
    },
  ])("records a live run: $name", ({ entries, record }) => {
    expect(lines(rows({ entries: [user("m0", 0), ...entries], live: "t1" }))).toEqual(record);
  });

  // The Mate's words before a message the person sent into the run are the
  // record's: said on the page too, they were the same words twice.
  it("keeps the Mate's words before a message sent into the run in its record alone", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Found it: the build used the dev setup."),
        user("m1", 3, "revert it"),
      ],
      live: "t1",
    });
    expect(list.some((row) => row.id === "a1")).toBe(false);
    expect(lines(list)).toEqual([
      "· pnpm test",
      "Found it: the build used the dev setup.",
      "> revert it",
    ]);
  });

  // What runs alongside is the whole run's while it goes on: a message sent
  // into the run moved the checks before it into the record's middle as the
  // Mate went on (a real thread, replayed 2026-09-27). Settled, they are
  // lines where they happened.
  it("keeps a run's checks alongside while it goes on, however often the person wrote into it", () => {
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, { kind: "browser", subject: "https://shop.dev/" }),
      tool("w1", "t1", 2),
      user("m1", 3, "and the footer"),
      tool("w2", "t1", 4),
    ];
    const live = rows({ entries, live: "t1" });
    expect(lines(live)).toEqual(["· pnpm test", "> and the footer", "· pnpm test"]);
    expect(live.find((row) => row.kind === "working")).toMatchObject({
      strip: { checks: [expect.objectContaining({ kind: "browser" })] },
    });
    const settled = rows({
      entries: [...entries, assistant("a1", "t1", 5, "Done.")],
      settled: "t1",
    });
    expect(lines(settled)).toEqual(["strip", "· pnpm test", "> and the footer", "· pnpm test"]);
  });

  it("records a settled run: thinking, notes in full, each call a step", () => {
    const list = rows({
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
    });
    const items = recordOf(list)?.items ?? [];
    expect(items.map((item) => item.key)).toEqual([
      "thought:r1",
      "step:w1",
      "thought:r2",
      "step:w2",
      "note:a1",
      "step:w3",
    ]);
    // Thinking runs from where what came before it ended to where what came
    // next began: from the person's message to the first call here.
    expect(items[0]).toMatchObject({ kind: "thought", durationMs: 60_000 });
    expect(items[1]).toMatchObject({ step: { kind: "command", words: null, code: "pnpm test" } });
    expect(items[3]).toMatchObject({ step: { kind: "edit", words: "Edited app.ts" } });
  });

  // A "Thought" line between every two steps walled the steps in: thinking
  // shorter than THOUGHT_LINE_MIN_MS is the step it led to, opened with it.
  it.each([
    { name: "a short thought is the step it led to", seconds: 4, line: false },
    { name: "a long one is a line of its own", seconds: 25, line: true },
  ])("$name", ({ seconds, line }) => {
    const withSeconds = (entry: TimelineEntry, second: number): TimelineEntry =>
      entry.kind === "message"
        ? {
            ...entry,
            createdAt: at(1, second),
            message: { ...entry.message, createdAt: at(1, second), updatedAt: at(1, second) },
          }
        : entry.kind === "work"
          ? {
              ...entry,
              createdAt: at(1, second),
              entry: { ...entry.entry, createdAt: at(1, second) },
            }
          : entry;
    for (const scene of ["live", "settled"] as const) {
      const list = rows({
        entries: [
          user("m0", 0),
          withSeconds(tool("w1", "t1", 1), 0),
          withSeconds(reasoning("r1", "t1", 1), seconds - 1),
          withSeconds(tool("w2", "t1", 1), seconds),
          assistant("a1", "t1", 3, "Done."),
        ],
        ...(scene === "live" ? { live: "t1" } : { settled: "t1" }),
      });
      const items = recordOf(list)?.items ?? [];
      expect(items.some((item) => item.kind === "thought")).toBe(line);
      expect(items.find((item) => item.key === "step:w2")).toMatchObject({
        thought: line ? null : { durationMs: seconds * 1000 },
      });
    }
  });

  // A command Claude Code tracked as a task is one step, in the task's words;
  // the task is no line of its own (27 of 27 on one real run).
  it("says a tracked command in its task's words, and draws its task nowhere", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1, { command: "cd /tmp && ./capture.sh", toolCallId: "toolu_1" }),
        tool("k1", "t1", 1, {
          label: "Screenshot the home page",
          toolTitle: "Screenshot the home page",
          tone: "info",
          command: undefined as never,
          sourceActivityKind: "task.completed",
          taskId: "bk1",
          taskToolUseId: "toolu_1",
          isBackgroundTask: true,
        } as never),
        assistant("a1", "t1", 2, "Done."),
      ],
      settled: "t1",
    });
    expect(recordOf(list)?.items).toEqual([
      expect.objectContaining({
        kind: "step",
        step: expect.objectContaining({ words: "Screenshot the home page", code: "./capture.sh" }),
      }),
    ]);
  });

  // Starting a helper is work: its launch is a line of the record, and the
  // result counts it (the owner, 2026-09-27: "it never said that it started
  // the subagent at the start").
  it.each([
    {
      name: "only a helper started",
      spawned: ["task-h1"],
      commands: 0,
      pills: ["Started 1 helper"],
    },
    {
      name: "two helpers at once",
      spawned: ["task-h1", "task-h2"],
      commands: 0,
      pills: ["Started 2 helpers"],
    },
    {
      name: "after other work",
      spawned: ["task-h1"],
      commands: 2,
      pills: ["Ran 2 commands", "Started 1 helper"],
    },
  ])("records and counts what a run started: $name", ({ spawned, commands, pills }) => {
    const list = rows({
      entries: [
        user("m0", 0),
        ...Array.from({ length: commands }, (_, index) => tool(`w${index}`, "t1", 1)),
        tool("s1", "t1", 1, {
          label: "Review server/index.ts",
          agentSpawn: { workflowId: null, agentTaskIds: spawned },
        }),
        assistant("a1", "t1", 2, "It is running."),
      ],
      settled: "t1",
    });
    expect(lines(list)?.at(-1)).toBe(`helpers ${spawned.length}`);
    const outcome = list.find((row) => row.kind === "outcome");
    expect(
      outcome?.kind === "outcome" ? outcome.outcome.activity.map((pill) => pill.words) : null,
    ).toEqual(pills);
    expect(list.find((row) => row.kind === "work-line")).toMatchObject({ worked: true });
  });

  // A run whose only work was an operation — a page check, a deploy — did
  // work: "Nova thought for 8s" stood over its report of "1 page · 1 check"
  // (Nova, 2026-09-27).
  it.each([
    {
      name: "only a page checked",
      middle: [operation("b1", "t1", 1, { kind: "browser", subject: "https://shop.dev/" })],
      worked: true,
    },
    { name: "only thought", middle: [reasoning("r1", "t1", 1)], worked: false },
  ])("says a run that did something worked: $name", ({ middle, worked }) => {
    const list = rows({
      entries: [user("m0", 0), ...middle, assistant("a1", "t1", 2, "Done.")],
      settled: "t1",
    });
    expect(list.find((row) => row.kind === "work-line")).toMatchObject({ worked });
  });

  // Each line stands where it joined the record: the deploy that failed
  // after minutes in the bars is a line where it failed, after what the Mate
  // did while it ran — as the person watched it land.
  it("keeps everything a run met in its record, each where it joined", () => {
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
        tool("e1", "t1", 5, {
          tone: "error",
          label: "Claude API is overloaded (529)",
          command: undefined as never,
        }),
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
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "work-line:work-line:msg:m0",
      "record:record:msg:m0",
      "outcome:outcome:msg:m0",
      "message:a1",
    ]);
    expect(lines(list)).toEqual([
      "strip",
      "event landed",
      "event compaction",
      "error Claude API is overloaded (529)",
      "✗ Re-run type checks",
      "✗ deploy appdev",
      "✓ deploy appdev",
    ]);
    expect(list[2]).toMatchObject({ face: "produced" });
  });

  it("draws the person's answer to the Mate's question as their own words on the page", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("rq", "t1", 1, {
          tone: "info",
          command: undefined as never,
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          inputRequestId: "req-1",
          label: "User input requested",
          sourceActivityKind: "user-input.requested",
          inputQuestions: [
            { id: "accent", header: "Accent color", question: "Which accent colour?" },
          ],
        }),
        answeredWith("rs", 2, "Green"),
        tool("w1", "t1", 3),
        assistant("a1", "t1", 4, "Green it is."),
      ],
      settled: "t1",
    });
    expect(list.filter((row) => row.kind === "answer")).toEqual([
      expect.objectContaining({
        id: "answer:rs",
        pairs: [{ key: "accent", question: "Which accent colour?", answer: "Green" }],
      }),
    ]);
    // The request and the submission are no rows of their own.
    expect(shape(list).filter((id) => id.includes(":rq") || id === "work:rs")).toEqual([]);
    expect(lines(list)).toEqual(["> Green", "· pnpm test"]);
  });

  it("draws a settled stretch's browser checks in the record, where they happened", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        operation("b1", "t1", 2, { kind: "browser", subject: "https://shop.dev/cart" }),
        assistant("a1", "t1", 3, "Checked."),
      ],
      settled: "t1",
    });
    expect(lines(list)).toEqual(["· pnpm test", "strip"]);
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
      "record:record:msg:m0",
      "pause:pause:msg:m0",
      "outcome:outcome:msg:m0",
      "message:m1",
      "work-line:work-line:msg:m1",
    ]);
    expect(list[4]).toMatchObject({
      held: 3,
      resumedAt: null,
      resetsAt: new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    });
    expect(list[2]).toMatchObject({ face: "paused" });
    // A turn the limit refused before it did anything is its heading alone.
    expect(list[7]).toMatchObject({ face: "paused", worked: false });
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
      "record:record:msg:m0",
      "pause:pause:msg:m0",
      "outcome:outcome:msg:m0",
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

  it("tells a /compact in one line: no card, no second compaction line", () => {
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
      after: [
        "message:m1",
        "work-line:work-line:msg:m1",
        "record:record:msg:m1",
        "working:working:msg:m1",
      ],
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
      after: [
        "message:m1",
        "work-line:work-line:msg:m1",
        "record:record:msg:m1",
        "outcome:outcome:msg:m1",
        "message:a1",
      ],
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
      after: [
        "message:m1",
        "work-line:work-line:msg:m1",
        "record:record:msg:m1",
        "outcome:outcome:msg:m1",
        "message:a1",
      ],
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
      // The result is the turn's, and the turn is the /compact's.
      after: [
        "message:m1",
        "work-line:work-line:msg:m1",
        "record:record:msg:m1",
        "outcome:outcome:msg:m0",
        "message:a1",
      ],
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

  // What runs alongside names the card it stands in: a run a /compact opened
  // is drawn from the person's message after it, and its height is measured
  // against that card's line and edge.
  it("names the card what runs alongside stands in, the one a /compact's run is drawn as", () => {
    const list = rows({
      entries: [
        user("m0", 0, "/compact"),
        tool("c1", "t1", 1, {
          sourceActivityKind: "context-compaction",
          label: "Context compacted",
        }),
        user("m1", 2),
        tool("w1", "t1", 3),
      ],
      live: "t1",
    });
    const line = list.find((row) => row.kind === "work-line");
    expect(line?.id).toBe("work-line:msg:m1");
    expect(list.find((row) => row.kind === "working")).toMatchObject({ cardKey: "msg:m1" });
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

  it("keeps a run that only thought before its answer as its thinking, and says it thought", () => {
    const list = rows({
      entries: [user("m0", 0), reasoning("r1", "t1", 1), assistant("a1", "t1", 2, "Yes.")],
      settled: "t1",
    });
    expect(list[2]).toMatchObject({ kind: "work-line", worked: false });
    expect(lines(list)).toEqual(["~ thinking about it"]);
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
    const list = rows({
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started."),
        background("b1", 5),
        background("b2", 6),
        background("b3", 7),
        user("m1", 20),
      ],
      settled: "t1",
    });
    // The first stretch only answered — no card; the background work is one line.
    expect(shape(list).slice(1)).toEqual([
      "message:m0",
      "message:a1",
      "background:background:b1",
      "message:m1",
    ]);
    expect(list[3]).toMatchObject({
      entries: [{ id: "b1" }, { id: "b2" }, { id: "b3" }],
      tasks: 3,
      failed: 0,
      title: "Task b3",
    });
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

  // An answer to the Mate's question is marked where it reached the Mate, as
  // a message sent into the run is: the thinking it split stood as two lines
  // side by side with nothing between them (Nova, 2026-09-27).
  it("marks where the person's answer reached the Mate in its record", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        reasoning("r1", "t1", 1),
        asked("q1", 2),
        answeredWith("rs", 3, "Teal"),
        reasoning("r2", "t1", 4),
        tool("w1", "t1", 5),
        assistant("a1", "t1", 6, "Done."),
      ],
      settled: "t1",
    });
    expect(lines(list)).toEqual([
      "~ thinking about it",
      "> Teal",
      "~ thinking about it",
      "· pnpm test",
    ]);
  });

  // An image sent into the run is marked as the image it is, never the
  // client's placeholder text for a message without words.
  it.each([
    { text: "and the footer", imageOnly: false },
    { text: IMAGE_ONLY_BOOTSTRAP_PROMPT, imageOnly: true },
  ])(
    "marks a message sent into the run as its words or its image ($imageOnly)",
    ({ text, imageOnly }) => {
      const list = rows({
        entries: [user("m0", 0), tool("w1", "t1", 1), user("m1", 2, text), tool("w2", "t1", 3)],
        live: "t1",
      });
      expect(recordOf(list)?.items.find((item) => item.kind === "person")).toMatchObject({
        imageOnly,
      });
    },
  );

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

describe("thoughtPreview", () => {
  it.each([
    { texts: ["**Checking the menu**\n\nThe panel glides."], preview: "Checking the menu" },
    { texts: ["The route is renamed. Then the config."], preview: "The route is renamed." },
    { texts: ["No full stop here"], preview: "No full stop here" },
    { texts: ["The `status` route, _once_ more."], preview: "The status route, once more." },
    { texts: ["First part", " and the rest."], preview: "First part and the rest." },
    { texts: ["  "], preview: null },
  ])("$preview", ({ texts, preview }) => {
    expect(thoughtPreview(texts.map((text) => ({ text })))).toBe(preview);
  });
});

describe("a run's card", () => {
  // Every run with work is one card, from its heading to its edge: its
  // record, what runs alongside while it works, and its result inside; the
  // person's messages and the Mate's answer on the conversation's edge.
  const cards = (list: MessagesTimelineRow[]) =>
    list
      .filter((row) => row.kind !== "seam")
      .map((row) => `${row.kind}${row.card === undefined ? "" : `:${row.card}`}`);

  it.each([
    {
      case: "settled, with a deploy: its heading, its record, its result, its edge; the answer outside",
      scene: {
        entries: [
          user("m0", 0),
          operation("d1", "t1", 1, { kind: "deploy" }),
          assistant("a1", "t1", 2, "Done."),
        ],
        settled: "t1",
      } satisfies Scene,
      expected: [
        "message",
        "work-line:top",
        "record:middle",
        "outcome:middle",
        "card-end:bottom",
        "message",
      ],
    },
    {
      case: "settled, a command: what it ran counted in its result",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
        settled: "t1",
      } satisfies Scene,
      expected: [
        "message",
        "work-line:top",
        "record:middle",
        "outcome:middle",
        "card-end:bottom",
        "message",
      ],
    },
    {
      case: "live: the record, then what runs alongside",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Looking.")],
        live: "t1",
      } satisfies Scene,
      expected: ["message", "work-line:top", "record:middle", "working:middle", "card-end:bottom"],
    },
    {
      case: "written into: the person's message on the page, the card after it",
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
      expected: [
        "message",
        "message",
        "work-line:top",
        "record:middle",
        "working:middle",
        "card-end:bottom",
      ],
    },
    {
      case: "settled, a change landed: the record says where, the result names it",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), landed("l1", 2), assistant("a1", "t1", 3)],
        settled: "t1",
      } satisfies Scene,
      expected: [
        "message",
        "work-line:top",
        "record:middle",
        "outcome:middle",
        "card-end:bottom",
        "message",
      ],
    },
    {
      case: "live, a change landed: a line of the record until the result takes it",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), landed("l1", 2), tool("w2", "t1", 3)],
        live: "t1",
      } satisfies Scene,
      expected: ["message", "work-line:top", "record:middle", "working:middle", "card-end:bottom"],
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

  // A running turn's answer streams under its card while the card stays:
  // words that read as an answer mid-run become a note once the Mate goes on,
  // and a card folded early would come back at full height.
  it("streams a running turn's answer under its card, the card staying until the settle", () => {
    const list = framed({
      entries: [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy" }),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
      ],
      live: "t1",
    });
    expect(cards(list)).toEqual([
      "message",
      "work-line:top",
      "record:middle",
      "working:middle",
      "card-end:bottom",
      "message",
    ]);
    expect(list.at(-1)).toMatchObject({ kind: "message", id: "a1" });
    expect(recordOf(list)).toMatchObject({ answering: true, now: null });
  });

  // A run with nothing to report settles into its heading and record: the
  // answer under it eases up from where what ran alongside stood.
  it("eases the answer of a run with nothing to report up from what ran alongside", () => {
    const list = framed({
      entries: [user("m0", 0), reasoning("r1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
      settled: "t1",
    });
    expect(list.at(-1)).toMatchObject({
      kind: "message",
      id: "a1",
      foldsFrom: { turnKey: "msg:m0", cardClosed: false },
    });
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
  // cursor: what runs alongside, the card's edge, a live heading, a streaming
  // answer. A turn settling re-forms what is under its live heading (its last
  // note becomes the answer, a limit's notice becomes the pause). Queued
  // messages leave when they are sent, so they are not drawn.
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
  // The live card stays whole under the conversation's last word, as a
  // typing indicator stays under the last message: a message the person
  // sends into the run lands above it and the card moves down with it. So
  // the page above the live card only grows at its bottom, and the card
  // itself only grows at its bottom above what runs alongside.
  const holds = (sequence: Array<{ entry: TimelineEntry; live: boolean }>) => {
    let previous: MessagesTimelineRow[] = [];
    let wasLive = false;
    for (let count = 1; count <= sequence.length; count += 1) {
      const entries = sequence.slice(0, count).map((arrival) => arrival.entry);
      const live = sequence[count - 1]!.live;
      const current = framed({ entries, ...(live ? { live: "t1" } : { settled: "t1" }) });
      const settling = wasLive && !live;
      const tail = liveTailStart(previous, wasLive);
      const cardAt = previous.findIndex((row) => row.kind === "work-line" && row.live);
      if (cardAt === -1) {
        expect(frame(current).slice(0, tail)).toEqual(frame(previous).slice(0, tail));
      } else {
        expect(frame(current).slice(0, cardAt)).toEqual(frame(previous).slice(0, cardAt));
        const held = settling ? 0 : Math.max(1, tail - cardAt);
        // The card moves as one: the room above its heading is the room its
        // new neighbour keeps, so the heading is compared by what it draws.
        const movedTo = current.findIndex((row) => row.id === previous[cardAt]!.id);
        const unroomed = (list: MessagesTimelineRow[]) =>
          frame(list).map((drawn, index) =>
            index === 0 ? drawn.replace(/:(none|tight|line|block|turn):/, ":") : drawn,
          );
        expect(unroomed(current.slice(movedTo, movedTo + held))).toEqual(
          unroomed(previous.slice(cardAt, cardAt + held)),
        );
      }
      previous = current;
      wasLive = live;
    }
  };
  // The record itself only ever grows at its end while the run goes on: a
  // line drawn once is drawn again, in its place.
  const recordGrows = (sequence: Array<{ entry: TimelineEntry; live: boolean }>) => {
    let previous: string[] = [];
    for (let count = 1; count <= sequence.length; count += 1) {
      const entries = sequence.slice(0, count).map((arrival) => arrival.entry);
      if (!sequence[count - 1]!.live) return;
      const keys = recordOf(framed({ entries, live: "t1" }))?.items.map((item) => item.key) ?? [];
      expect(keys.slice(0, previous.length)).toEqual(previous);
      previous = keys;
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

  it("holds while a turn arrives", () => {
    holds(arrivals);
  });

  it("grows the record only at its end while a turn arrives", () => {
    recordGrows(arrivals);
  });

  it("holds while the answer streams under the card, and as the turn settles", () => {
    holds([
      { entry: user("m0", 0), live: true },
      { entry: reasoning("r1", "t1", 1), live: true },
      { entry: tool("w1", "t1", 2), live: true },
      { entry: assistant("a1", "t1", 3, "Deploying."), live: true },
      { entry: operation("d1", "t1", 4, { kind: "deploy" }), live: true },
      { entry: assistant("a2", "t1", 5, "It is live.\n\n**What changed**"), live: true },
      { entry: landed("l1", 6), live: false },
    ]);
  });

  it("holds when the person writes twice before the Mate did anything: the live card follows", () => {
    holds([
      { entry: user("m0", 0), live: true },
      { entry: user("m1", 1, "and the footer"), live: true },
      { entry: tool("w1", "t1", 2), live: true },
      { entry: assistant("a1", "t1", 3, "Looking at both."), live: true },
      { entry: user("m2", 4, "also the header"), live: true },
      { entry: tool("w2", "t1", 5), live: true },
      { entry: assistant("a2", "t1", 6, "All three are done."), live: false },
    ]);
  });
});

describe("computeStableMessagesTimelineRows", () => {
  it("keeps the rows that did not change, including rebuilt equal records and operations", () => {
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
    expect(changed.result.length).toBeGreaterThanOrEqual(first.result.length);
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
