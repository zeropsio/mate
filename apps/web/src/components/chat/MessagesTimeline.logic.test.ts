import { projectMateLimit, type MateLimit } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import { MessageId } from "@t3tools/contracts";
import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import {
  computeStableMessagesTimelineRows,
  conversationSpeaker,
  deriveMessagesTimelineRows,
  earlierTurnsAnchor,
  rowGap,
  thoughtParagraphs,
  thoughtPreview,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
  type HelperFinish,
  type MessagesTimelineRow,
  type RecordItem,
} from "./MessagesTimeline.logic";
import {
  CREW_CARD_OPENER,
  IMAGE_ONLY_BOOTSTRAP_PROMPT,
  USAGE_LIMIT_RESUME_PROMPT,
} from "@t3tools/shared/userAsk";
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
import { runEffortWords } from "./runResult.logic";

const refusedLimit = projectMateLimit(
  { latestTurn: null, session: { lastError: "Codex usage limit reached" } },
  0,
);

type Scene = {
  limit?: MateLimit;
  entries: TimelineEntry[];
  live?: string;
  settled?: string;
  working?: boolean;
  /** The minute the latest turn started, when not the conversation's first. */
  startedAt?: number;
  /** When each helper finished, as the helpers panel knows it. */
  helperFinishes?: ReadonlyArray<HelperFinish>;
  /** Something runs alongside the live run: its panel draws a bar. */
  alongside?: boolean;
  /** The thread's provider driver; Codex unless given, whose batches go by timing. */
  provider?: string | null;
  /** The background jobs the server holds live. */
  liveJobs?: ReadonlyArray<string>;
  /** Turns whose work the account does not hold yet (an engine card not read whole). */
  unheldWork?: ReadonlyArray<string>;
};

/** A day, in the fixtures' minutes. */
const DAY = 24 * 60;

/** The conversation as the list draws it, its cards' frames included. */
function framed(scene: Scene): MessagesTimelineRow[] {
  const latestId = scene.live ?? scene.settled;
  return deriveMessagesTimelineRows({
    timelineEntries: scene.entries,
    ...(scene.limit === undefined ? {} : { limit: scene.limit }),
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
    ...(scene.helperFinishes === undefined ? {} : { helperFinishes: scene.helperFinishes }),
    ...(scene.alongside === undefined ? {} : { alongside: scene.alongside }),
    provider: scene.provider === undefined ? "codex" : scene.provider,
    ...(scene.liveJobs === undefined ? {} : { liveJobs: { ids: new Set(scene.liveJobs) } }),
    ...(scene.unheldWork === undefined
      ? {}
      : {
          cardPaging: Object.fromEntries(
            scene.unheldWork.map((id) => [
              turn(id),
              {
                pageRuns: { earlier: null, later: id },
                // Its summary counts what it did: a call, its work.
                counts: { calls: { command: 1 }, tools: {}, edited: 0 },
                hasWork: true,
                holdsLines: false,
                since: at(0),
                through: at(0),
                reading: null,
              },
            ]),
          ),
        }),
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

/** The run's record where it ends: its last part, the live one while the run goes on. */
const recordOf = (list: MessagesTimelineRow[]) => {
  const record = list.findLast((row) => row.kind === "record");
  return record?.kind === "record" ? record : null;
};

/** Where the live run's card starts: its first chat, or its line where it has none. */
const liveCardAt = (list: MessagesTimelineRow[]) => {
  const live = list.find((row) => row.kind === "record" && row.live);
  if (live?.kind !== "record") return list.findIndex((row) => row.kind === "work-line" && row.live);
  return list.findIndex((row) => row.kind === "record" && row.turnKey === live.turnKey);
};

/** A run's status: on its last chat, or on a line of its own where it has none. */
const statusOf = (list: MessagesTimelineRow[]) => {
  const record = list.findLast((row) => row.kind === "record" && row.status !== null);
  if (record?.kind === "record") return record.status;
  const line = list.find((row) => row.kind === "work-line");
  return line?.kind === "work-line" ? line : null;
};

/** Every line of a run's record, its parts in order. */
const allItems = (list: MessagesTimelineRow[]) =>
  list.flatMap((row) => (row.kind === "record" ? row.items : []));

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
    case "question":
      return `? ${item.questions.join(" / ")}`;
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
      return `strip ${item.strip.checks.map((check) => check.key).join(" ")}`;
    case "incident":
      return `incident ${item.incident.hostname}`;
    case "event":
      return `event ${item.event.type}`;
    case "crew-seam":
      return `seam ${item.words}`;
    case "error":
      return `error ${item.entry.label}`;
  }
};

/**
 * A run as it reads from its heading down: its record's lines, part by part,
 * and between the parts what the person said into the run, on the page.
 */
const lines = (list: MessagesTimelineRow[]) => {
  const start = list.findIndex((row) => row.kind === "work-line" || row.kind === "record");
  if (start === -1) return null;
  return list
    .slice(start)
    .flatMap((row) =>
      row.kind === "record"
        ? row.items.map(said)
        : row.kind === "message" && row.message.role === "user"
          ? [`> ${row.imageOnly ? "" : row.message.text}`]
          : [],
    );
};

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

/** An approval asked of the person, or given. */
const approvalOf = (
  id: string,
  minute: number,
  kind: "approval.requested" | "approval.resolved",
): TimelineEntry =>
  tool(id, "t1", minute, {
    tone: "info",
    label: kind === "approval.requested" ? "Approval requested" : "Approval resolved",
    command: undefined as never,
    toolCallId: undefined as never,
    toolLifecycleStatus: undefined as never,
    requestKind: "command",
    sourceActivityKind: kind,
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
      "record:record:msg:m0",
      "message:a2",
    ]);
    // Who worked and for how long is the chat's last line, never a heading.
    expect(recordOf(list)?.status).toMatchObject({
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
    // What its calls came to is said on its line (the owner, 2026-09-29): the
    // record carries it, and nothing is drawn under the line for it.
    expect(recordOf(list)).toMatchObject({
      outcome: { activity: [{ kind: "command", count: 2 }] },
    });
    expect(list.some((row) => row.kind === "outcome")).toBe(false);
    expect(list.at(-1)).toMatchObject({ showAssistantMeta: true, receipt: null });
  });

  // What the person sent into the run stands on the page above its card, once:
  // one card, one status (the owner, 2026-09-28, of the card breaking around
  // each: "these split working groups have no chance to stay like this when
  // the work is done"; Milo's third stress run drew a steer twice, above the
  // card and marked in its chat).
  it("keeps every message the person sent above the whole card, drawn once", () => {
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
      "record:record:msg:m0",
      "message:a3",
    ]);
    // One card, its status on the chat's last line.
    expect(list.filter((row) => row.kind === "work-line")).toHaveLength(0);
    expect(recordOf(list)?.status).toMatchObject({ live: false, worked: true });
    expect(list.filter((row) => row.kind === "message" && row.message.role === "user")).toEqual([
      expect.objectContaining({ aside: false, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
      expect.objectContaining({ aside: true, receipt: "seen" }),
    ]);
    expect(lines(list)).toEqual(["· pnpm test", "· pnpm test"]);
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
      "record:record:msg:m0",
      "working:working:msg:m0",
    ]);
    expect(recordOf(list)?.status).toMatchObject({ live: true, face: "working", endedAt: null });
    // The call it is making is beside its face, never a line of the record yet.
    expect(recordOf(list)).toMatchObject({
      live: true,
      answering: false,
      now: { kind: "step", step: { state: "running" } },
    });
    expect(lines(list)).toEqual(["Checking the build."]);
    expect(list[3]).toMatchObject({
      kind: "working",
      turnKey: "msg:m0",
      cardKey: "msg:m0",
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
    const line = statusOf(
      rows({
        entries: [
          user("m0", 0),
          assistant("a1", "t1", 1, "One thing first."),
          waitOn("q1", 2, kinds[0]),
          waitOn("q2", 7, kinds[1]),
          tool("w1", "t1", 8),
          assistant("a2", "t1", 9, "Done."),
        ],
        settled: "t1",
      }),
    );
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
    const line = statusOf(rows(live ? { entries, live: "t1" } : { entries, settled: "t1" }));
    expect(line).toMatchObject({
      waitedMs: waited * 60_000,
      waitingSince: since === null ? null : at(since),
    });
  });

  // Juno, 2026-09-30, the owner: "I triggered a message after I stopped
  // previous and it says thinking 17h". The message before had no run of its
  // own — Stop and a restart ended it before it said anything — and the next
  // message's run counted from it, the new message beside it "Not read yet".
  it.each([
    {
      name: "thinking",
      scene: {
        entries: [user("m0", 0), user("m1", DAY), reasoning("r1", "t2", DAY)],
        live: "t2",
        startedAt: DAY,
      } satisfies Scene,
      receipt: "seen",
    },
    {
      name: "named, silent",
      scene: { entries: [user("m0", 0), user("m1", DAY)], live: "t2", startedAt: DAY },
      receipt: "seen",
    },
    {
      name: "before the server names it",
      scene: { entries: [user("m0", 0), user("m1", DAY)], working: true } satisfies Scene,
      receipt: "sent",
    },
    {
      name: "settled",
      scene: {
        entries: [
          user("m0", 0),
          user("m1", DAY),
          reasoning("r1", "t2", DAY),
          assistant("a1", "t2", DAY + 1, "Both have it."),
        ],
        settled: "t2",
        startedAt: DAY,
      } satisfies Scene,
      receipt: "seen",
    },
  ])(
    "runs a run's clock from the message that started it, never from one whose run never came: $name",
    ({ scene, receipt }) => {
      const list = rows(scene);
      expect(statusOf(list)).toMatchObject({ startedAt: at(DAY) });
      expect(
        list.flatMap((row) =>
          row.kind === "message" && row.message.role === "user" ? [[row.id, row.receipt]] : [],
        ),
      ).toEqual([
        ["m0", null],
        ["m1", receipt],
      ]);
    },
  );

  it.each([
    {
      name: "nothing yet: it thinks",
      entries: [],
      now: { kind: "thinking", key: null, messages: [] },
    },
    {
      name: "thinking after its words: the thought it is thinking, keyed as the record will key it",
      entries: [assistant("a1", "t1", 1, "Looking."), reasoning("r1", "t1", 2)],
      now: {
        kind: "thinking",
        key: "thought:r1",
        messages: [expect.objectContaining({ id: "r1" })],
      },
    },
    {
      name: "a call returned after its thought: between steps",
      entries: [reasoning("r1", "t1", 1), tool("w1", "t1", 2)],
      now: { kind: "thinking", key: null, messages: [] },
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
      now: { kind: "waiting", on: "answer" },
    },
    {
      // The clock stands still while an approval waits on the person, so the
      // line must say it waits too — not the command it may not run yet.
      name: "an approval asked for a running command: it waits for the person",
      entries: [
        tool("w1", "t1", 1, {
          command: "pnpm build",
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.updated",
        }),
        approvalOf("p1", 2, "approval.requested"),
      ],
      // What it asks to run stands in the slot; the controls are the composer's.
      now: { kind: "waiting", on: "approval", asked: [{ kind: "step", step: { key: "w1" } }] },
    },
    {
      name: "an approval asked for a command not started yet: the approval says what it asks",
      entries: [
        tool("p1", "t1", 2, {
          tone: "info",
          label: "Command approval requested",
          command: "rm -rf dist",
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          requestKind: "command",
          sourceActivityKind: "approval.requested",
        }),
      ],
      now: {
        kind: "waiting",
        on: "approval",
        asked: [{ kind: "step", step: { key: "p1", code: "rm -rf dist" } }],
      },
    },
    {
      name: "an approval given: back to the step",
      entries: [
        tool("w1", "t1", 1, {
          command: "pnpm build",
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.updated",
        }),
        approvalOf("p1", 2, "approval.requested"),
        approvalOf("p2", 3, "approval.resolved"),
      ],
      now: { kind: "step" },
    },
  ])("says beside its face what the Mate is on: $name", ({ entries, now }) => {
    expect(recordOf(rows({ entries: [user("m0", 0), ...entries], live: "t1" }))).toMatchObject({
      now,
    });
  });

  // The live field reads the newest batch only: Claude makes its calls, then
  // waits for every result, so a call started after another returned belongs
  // to a newer batch, and one still marked open from an older batch is stale
  // (pass 35, the owner: "sometimes it shows something that failed 4
  // iterations ago").
  const open = (id: string, minute: number, second = 0, responseId?: string) =>
    tool(id, "t1", minute, {
      createdAt: at(minute, second),
      startedAt: at(minute, second),
      toolLifecycleStatus: "inProgress",
      sourceActivityKind: "tool.started",
      ...(responseId === undefined ? {} : { responseId }),
    });
  const returned = (
    id: string,
    minute: number,
    second: number,
    back: number,
    backSecond = 0,
    responseId?: string,
  ) => ({
    ...tool(id, "t1", minute, {
      createdAt: at(minute, second),
      startedAt: at(minute, second),
      updatedAt: at(back, backSecond),
      ...(responseId === undefined ? {} : { responseId }),
    }),
    createdAt: at(minute, second),
  });
  it.each([
    {
      // Run 12: a note and the command's start stamped 14:40:20.255Z; the
      // scan stopped at the note and the open command never showed as live.
      name: "a note at the instant an open call started: the call",
      entries: [open("w1", 1), assistant("a1", "t1", 1, "Running the build.")],
      now: { kind: "step", step: { key: "w1" } },
    },
    {
      name: "a note at the instant a call started that has returned: it thinks",
      entries: [returned("w1", 1, 0, 1, 5), assistant("a1", "t1", 1, "Ran the build.")],
      now: { kind: "thinking", key: null, messages: [] },
    },
    {
      name: "a call whose completion never came is behind the batch after it",
      entries: [open("w1", 1), returned("w2", 2, 0, 2, 5), open("w3", 3)],
      now: { kind: "step", step: { key: "w3" } },
    },
    {
      name: "a dropped completion between later steps: it thinks, never the old call",
      entries: [open("w1", 1), returned("w2", 2, 0, 2, 5), returned("w3", 3, 0, 3, 5)],
      now: { kind: "thinking", key: null, messages: [] },
    },
    {
      // Claude files a result as an update and a completion; filed under
      // another turn, it never merged with its start.
      name: "a completion filed under another turn closes its start",
      entries: [
        open("w1", 1, 0, "r1"),
        tool("w1-done", "t2", 1, {
          createdAt: at(1, 30),
          startedAt: at(1, 30),
          updatedAt: at(1, 31),
          toolCallId: "call-w1",
        }),
      ],
      now: { kind: "thinking", key: null, messages: [] },
    },
    {
      name: "a completion filed under another turn opens no newer batch for the calls beside it",
      entries: [
        open("w1", 1, 0, "r1"),
        open("w2", 1, 10, "r1"),
        tool("w1-done", "t2", 1, {
          createdAt: at(1, 30),
          startedAt: at(1, 30),
          updatedAt: at(1, 31),
          toolCallId: "call-w1",
        }),
      ],
      now: { kind: "step", step: { key: "w2" } },
    },
    {
      name: "two batches with no thought between: the newer batch only",
      entries: [open("w1", 1), returned("w2", 1, 10, 2), open("w3", 3), open("w4", 3, 5)],
      now: { kind: "step", step: { key: "w4" }, others: [{ kind: "step", step: { key: "w3" } }] },
    },
    {
      name: "parallel calls in one batch: the open ones, oldest first under the newest",
      entries: [open("w1", 1), open("w2", 1, 5), open("w3", 1, 10)],
      now: {
        kind: "step",
        step: { key: "w3" },
        others: [
          { kind: "step", step: { key: "w1" } },
          { kind: "step", step: { key: "w2" } },
        ],
      },
    },
    {
      name: "a call of the batch returned first: the one still open",
      entries: [open("w1", 1), returned("w2", 1, 5, 1, 20)],
      now: { kind: "step", step: { key: "w1" } },
    },
    {
      name: "an operation whose call returned runs on in the band: it thinks",
      entries: [
        operation("s1", "t1", 1, {
          kind: "standup",
          phase: "running",
          hasResult: true,
          returnedAt: at(1, 5),
        }),
        returned("w2", 2, 0, 2, 5),
      ],
      now: { kind: "thinking", key: null, messages: [] },
    },
    {
      name: "an operation whose call is open is what it waits on",
      entries: [
        returned("w1", 1, 0, 1, 5),
        operation("d1", "t1", 2, { kind: "deploy", phase: "running", hasResult: false }),
      ],
      now: { kind: "operation", operation: { key: "op:d1" } },
    },
    // A batch is one model response (C1): Claude Code runs a response's early
    // calls while the model still writes the later ones.
    {
      name: "a streamed response: a call returned before a later one of its response started",
      entries: [open("w1", 1, 0, "r1"), returned("w2", 1, 5, 1, 10, "r1"), open("w3", 1, 20, "r1")],
      now: { kind: "step", step: { key: "w3" }, others: [{ kind: "step", step: { key: "w1" } }] },
    },
    {
      name: "a call of a newer response puts the older response's open call behind it",
      entries: [open("w1", 1, 0, "r1"), returned("w2", 1, 5, 1, 10, "r1"), open("w3", 2, 0, "r2")],
      now: { kind: "step", step: { key: "w3" } },
    },
    {
      // Claude files a result as an update and a completion: merged, with no
      // start, it tells a return, never a newer batch.
      name: "a completion with no start of its own opens no newer batch",
      entries: [
        open("w1", 1, 0, "r1"),
        tool("w2", "t1", 1, { createdAt: at(1, 30), startedAt: at(1, 30), updatedAt: at(1, 31) }),
        open("w3", 1, 40, "r1"),
      ],
      now: { kind: "step", step: { key: "w3" }, others: [{ kind: "step", step: { key: "w1" } }] },
    },
    {
      // A session's follow-up call: the Mate waits on it, and the session's
      // line stands where it first returned.
      name: "a bootstrap session's open follow-up is never stale, and its line stays",
      entries: [
        operation("bs1", "t1", 1, {
          kind: "bootstrap",
          phase: "running",
          hasResult: false,
          returnedAt: at(1, 30),
          openedAt: at(3, 0),
          responseId: "r3",
        }),
        returned("w2", 2, 0, 2, 5, "r2"),
        open("w4", 3, 5, "r3"),
      ],
      now: {
        kind: "step",
        step: { key: "w4" },
        others: [{ kind: "operation", operation: { key: "op:bs1" } }],
      },
    },
    {
      name: "a deploy and a command in one batch: both, the deploy under the command",
      entries: [
        operation("d1", "t1", 1, {
          kind: "deploy",
          phase: "running",
          hasResult: false,
          anchorAt: at(1, 0),
        }),
        open("w2", 1, 5),
      ],
      now: {
        kind: "step",
        step: { key: "w2" },
        others: [{ kind: "operation", operation: { key: "op:d1" } }],
      },
    },
    {
      name: "a command and a deploy in one batch: both, the command under the deploy",
      entries: [
        open("w0", 1),
        operation("d1", "t1", 1, {
          kind: "deploy",
          phase: "running",
          hasResult: false,
          anchorAt: at(1, 5),
        }),
      ],
      now: {
        kind: "operation",
        operation: { key: "op:d1" },
        others: [{ kind: "step", step: { key: "w0" } }],
      },
    },
    {
      name: "two deploys in one batch: both",
      entries: [
        operation("d1", "t1", 1, {
          kind: "deploy",
          phase: "running",
          hasResult: false,
          anchorAt: at(1, 0),
        }),
        operation("d2", "t1", 1, {
          kind: "deploy",
          subject: "apistage",
          phase: "running",
          hasResult: false,
          anchorAt: at(1, 5),
        }),
      ],
      now: {
        kind: "operation",
        operation: { key: "op:d2" },
        others: [{ kind: "operation", operation: { key: "op:d1" } }],
      },
    },
  ])("reads the live field from the newest batch: $name", ({ entries, now }) => {
    // The live run's record: a completion filed under another turn draws its own.
    const provider = entries.some((entry) =>
      entry.kind === "operation"
        ? entry.operation.responseId !== undefined
        : "entry" in entry && "responseId" in entry.entry && entry.entry.responseId !== undefined,
    )
      ? "claudeAgent"
      : "codex";
    const record = rows({ entries: [user("m0", 0), ...entries], live: "t1", provider }).find(
      (row): row is Extract<MessagesTimelineRow, { kind: "record" }> =>
        row.kind === "record" && row.live,
    );
    expect(record?.now).toMatchObject(now);
    if (!("others" in now)) {
      expect(record?.now).not.toHaveProperty("others");
    }
  });

  // An older Mate server names no response: a Claude thread's calls then go
  // stale by nothing, as before the batch rule (D1), and the timing rule is
  // Codex's alone.
  it.each([
    { provider: "claudeAgent", now: { key: "w3", others: [{ step: { key: "w1" } }] }, stale: [] },
    { provider: null, now: { key: "w3", others: [{ step: { key: "w1" } }] }, stale: [] },
    { provider: "codex", now: { key: "w3" }, stale: ["step:w1"] },
  ])("reads a thread whose calls name no response by its provider: $provider", (row) => {
    const entries = [user("m0", 0), open("w1", 1), returned("w2", 1, 5, 1, 10), open("w3", 1, 20)];
    const record = recordOf(rows({ entries, live: "t1", provider: row.provider }));
    expect(record?.now).toMatchObject({
      kind: "step",
      step: { key: row.now.key },
      ...("others" in row.now ? { others: row.now.others } : {}),
    });
    if (!("others" in row.now)) expect(record?.now).not.toHaveProperty("others");
    expect(
      record?.items.flatMap((item) =>
        item.kind === "step" && item.step.noResult === "stale" ? [item.key] : [],
      ),
    ).toEqual(row.stale);
  });

  // Two edits in a row fold into one line; while the run goes on, the line
  // carries each edit as its own, so the slot draws the second as it ended
  // and the history folds it in once it lands (E6).
  it("carries each edit a live folded line holds as a line of its own", () => {
    const edit = (id: string, minute: number) =>
      tool(id, "t1", minute, {
        itemType: "file_change" as never,
        label: "File change",
        command: undefined as never,
        detail: `Edit: {"file_path":"/srv/app/${id}.ts"}`,
        createdAt: at(minute),
        startedAt: at(minute),
        updatedAt: at(minute, 5),
      });
    const entries = [user("m0", 0), edit("e1", 1), edit("e2", 2)];
    const live = recordOf(rows({ entries, live: "t1" }));
    const folded = live?.items.find((item) => item.key === "step:e1");
    expect(folded?.kind).toBe("step");
    if (folded?.kind !== "step") return;
    expect(folded.step.entries).toHaveLength(2);
    expect(folded.parts?.map((part) => [part.key, part.step.words, part.step.state])).toEqual([
      ["step:e1", "Edited e1.ts", "done"],
      ["step:e2", "Edited e2.ts", "done"],
    ]);
  });

  it("keeps a bootstrap session's line where it first returned while its follow-up runs", () => {
    const entries = [
      user("m0", 0),
      operation("bs1", "t1", 1, {
        kind: "bootstrap",
        phase: "running",
        hasResult: false,
        returnedAt: at(1, 30),
        openedAt: at(3, 0),
        responseId: "r3",
      }),
      returned("w2", 2, 0, 2, 5, "r2"),
    ];
    const live = recordOf(rows({ entries, live: "t1" }));
    expect(live?.items.map((item) => item.key)).toEqual(["operation:op:bs1", "step:w2"]);
    // The follow-up it waits on stands in the slot, never "Thinking" (D2).
    expect(live?.now).toMatchObject({ kind: "operation", operation: { key: "op:bs1" } });
  });

  it("lands a stale operation in the record where it went stale", () => {
    const entries = [
      user("m0", 0),
      operation("d1", "t1", 1, {
        kind: "deploy",
        phase: "running",
        hasResult: false,
        anchorAt: at(1, 0),
        responseId: "r1",
      }),
      returned("w2", 1, 10, 1, 20, "r1"),
      open("w3", 2, 0, "r2"),
    ];
    const live = recordOf(rows({ entries, live: "t1" }));
    expect(live?.now).toMatchObject({ kind: "step", step: { key: "w3" } });
    expect(live?.items.map((item) => [item.key, item.at])).toEqual([
      ["step:w2", at(1, 20)],
      ["operation:op:d1", at(2, 0)],
    ]);
    // Stale, it no longer runs (D3); settled, it closes as no result.
    expect(live?.items.find((item) => item.key === "operation:op:d1")).toMatchObject({
      noResult: "stale",
    });
    const settled = recordOf(
      rows({
        entries: entries.map((entry) =>
          entry.kind === "operation"
            ? { ...entry, operation: { ...entry.operation, phase: "interrupted" as const } }
            : entry,
        ),
        settled: "t1",
      }),
    );
    expect(settled?.items.find((item) => item.key === "operation:op:d1")).toMatchObject({
      noResult: "closed",
    });
    // It stays where it went stale.
    expect(settled?.items.map((item) => [item.key, item.at]).slice(0, 2)).toEqual([
      ["step:w2", at(1, 20)],
      ["operation:op:d1", at(2, 0)],
    ]);
  });

  it("says a stale step in the past tense", () => {
    const read = (id: string, minute: number, responseId: string) =>
      tool(id, "t1", minute, {
        label: "Read file",
        itemType: "file_read" as never,
        command: undefined as never,
        detail: `Read: {"file_path":"/srv/app/${id}.ts"}`,
        createdAt: at(minute),
        startedAt: at(minute),
        toolLifecycleStatus: "inProgress",
        sourceActivityKind: "tool.started",
        responseId,
      });
    const entries = [user("m0", 0), read("w1", 1, "r1"), open("w2", 2, 0, "r2")];
    const stale = recordOf(rows({ entries, live: "t1" }))?.items.find(
      (item) => item.key === "step:w1",
    );
    expect(stale?.kind).toBe("step");
    if (stale?.kind !== "step") return;
    expect(stale.step.noResult).toBe("stale");
    expect(stale.step.words ?? "").not.toMatch(/^Reading/u);
  });

  it("puts a call left open before the person wrote into the run behind a newer batch", () => {
    const entries = [
      user("m0", 0),
      open("w1", 1, 0, "r1"),
      user("m1", 2, "and the footer"),
      open("w2", 3, 0, "r2"),
    ];
    const live = recordOf(rows({ entries, live: "t1" }));
    expect(live?.now).toMatchObject({ kind: "step", step: { key: "w2" } });
    expect(live?.items.find((item) => item.key === "step:w1")).toMatchObject({
      step: { noResult: "stale" },
    });
  });

  it("lands a stand-up in the record where its call returned, while its builds run on in the band", () => {
    const standup = (phase: "running" | "done") =>
      operation("s1", "t1", 1, {
        kind: "standup",
        subject: "development",
        phase,
        returnedAt: at(1, 30),
        ...(phase === "done" ? { settledAt: at(1, 30) } : {}),
      });
    const entries = [user("m0", 0), standup("running"), returned("w2", 2, 0, 2, 5)];
    const running = recordOf(rows({ entries, live: "t1" }));
    expect(running?.items.map((item) => item.key)).toEqual(["operation:op:s1", "step:w2"]);
    // Settled, it stands where it stood.
    const settled = recordOf(
      rows({ entries: [user("m0", 0), standup("done"), returned("w2", 2, 0, 2, 5)], live: "t1" }),
    );
    expect(settled?.items.map((item) => item.key)).toEqual(["operation:op:s1", "step:w2"]);
  });

  it("lands a stale call in the record once the newer batch starts, and closes it as no result", () => {
    const entries = [user("m0", 0), open("w1", 1), returned("w2", 2, 0, 2, 5), open("w3", 3)];
    const live = recordOf(rows({ entries, live: "t1" }));
    const stale = live?.items.find((item) => item.key === "step:w1");
    expect(stale).toMatchObject({ kind: "step", step: { noResult: "stale" } });
    // Where it became stale: when the newer batch started, after the call that returned.
    expect(live?.items.map((item) => item.key)).toEqual(["step:w2", "step:w1"]);
    const settled = recordOf(rows({ entries, settled: "t1" }));
    expect(settled?.items.find((item) => item.key === "step:w1")).toMatchObject({
      step: { noResult: "closed" },
    });
    // The turn's end closes it as unreturned (D4): it stays where it went stale.
    expect(settled?.items.map((item) => [item.key, item.at])).toEqual([
      ["step:w2", at(2, 5)],
      ["step:w1", at(3)],
      ["step:w3", at(3)],
    ]);
    expect(settled?.items.find((item) => item.key === "step:w3")).toMatchObject({
      step: { noResult: "closed" },
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
    // The same bubble, live and after: the key it wore beside the face is the one it keeps.
    const key = recordOf(thinking)?.now;
    expect(key?.kind === "thinking" ? key.key : null).toBe("thought:r1");
    expect(allItems(moved).map((item) => item.key)).toContain("thought:r1");
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
    expect(lines(running)).toEqual(["· pnpm test", "· pnpm test"]);
    expect(allItems(running)[0]).toMatchObject({ step: { state: "running" } });
    const returned = scene("completed");
    expect(allItems(returned).map((item) => item.key)).toEqual(
      allItems(running).map((item) => item.key),
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

  // The question stands in the run's card as the Mate asked it, and the
  // person's answer under it (K14); the card only grows at its end.
  it("keeps the question and the person's answer in the run's card, where they happened", () => {
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
    expect(shape(after).slice(-3)).toEqual([
      "record:record:msg:m0",
      "working:working:msg:m0",
      "card-end:card-end:msg:m0",
    ]);
    // Asked, it waits in the card; answered, the answer stands under it.
    expect(lines(waiting)).toEqual(["One question first.", "? Which accent colour do you prefer?"]);
    expect(lines(after)).toEqual([
      "One question first.",
      "? Which accent colour do you prefer?",
      "> Green",
      "Green it is.",
      "· pnpm test",
    ]);
    // Everything above the live card is drawn as it was.
    const cardAt = liveCardAt(waiting);
    expect(frame(after).slice(0, cardAt + 1)).toEqual(frame(waiting).slice(0, cardAt + 1));
  });

  it("keeps the person's next message above the card, the answer in it", () => {
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
    expect(list.some((row) => row.id === "answer:rs")).toBe(false);
    expect(lines(list)).toEqual([
      "One question first.",
      "? Which accent colour do you prefer?",
      "> Green",
      "· pnpm test",
    ]);
  });

  it("draws a run a finished background task woke, before its first words", () => {
    const list = rows({
      entries: [user("m0", 0), assistant("a1", "t1", 1, "Started it."), background("b1", 5)],
      live: "t2",
    });
    expect(shape(list).slice(-3)).toEqual([
      "background:background:b1",
      "record:record:turn:t2",
      "working:working:turn:t2",
    ]);
    expect(recordOf(list)).toMatchObject({ items: [], now: { kind: "thinking", messages: [] } });
  });

  // Review of pass 42: a run's clock is the Mate's own time — a 20-minute
  // helper between two short turns read "worked 21m".
  it("counts no wait on its helpers into a run's worked time", () => {
    const helper = tool("h1", "t1", 1, {
      label: "Review h1",
      taskId: "task-h1",
      agentRole: "general-purpose",
      sourceActivityKind: "task.completed",
      tone: "info",
      updatedAt: at(20),
    });
    const list = rows({
      entries: [
        user("m0", 0),
        helper,
        assistant("a1", "t1", 1, "Started it."),
        tool("w2", "t2", 21),
        assistant("a2", "t2", 22, "Done."),
      ],
      settled: "t2",
    });
    const status = recordOf(list)?.status;
    const span = Date.parse(status?.endedAt ?? "") - Date.parse(status?.startedAt ?? "");
    // Twenty-two minutes from the person's message to the answer, two of them the Mate's.
    expect(span - (status?.waitedMs ?? 0)).toBeLessThan(3 * 60_000);
  });

  // Nobody wrote to start it, after a run that launched a helper: that run
  // goes on in its own card, what woke it said where it took it in (run 11).
  it("goes on with the run its helper's finish woke, before its first words", () => {
    const helper = tool("h1", "t1", 2, {
      label: "Review h1",
      toolTitle: "Review h1",
      taskId: "task-h1",
      agentRole: "general-purpose",
      sourceActivityKind: "task.completed",
      tone: "info",
      updatedAt: at(5),
    });
    const list = rows({
      entries: [user("m0", 0), assistant("a1", "t1", 1, "Started it."), helper],
      live: "t2",
    });
    expect(shape(list).slice(-3)).toEqual([
      "message:m0",
      "record:record:msg:m0",
      "working:working:msg:m0",
    ]);
    expect(recordOf(list)?.items.at(-1)?.key).toBe("woke:turn:t2");
    expect(recordOf(list)).toMatchObject({ now: { kind: "thinking", messages: [] } });
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
    // What it ran is said on its line: the record carries it.
    const outcome = recordOf(list)?.outcome;
    expect(outcome ? runEffortWords(outcome) : null).toBe("1 command");
  });

  // A run that thought and asked the person something worked, it did not
  // only think.
  it("says a run that thought and asked the person something worked", () => {
    const line = statusOf(
      rows({
        entries: [
          user("m0", 0),
          reasoning("r0", "t1", 1),
          asked("q1", 1),
          answeredWith("rs", 2, "Teal"),
          assistant("a2", "t1", 4, "Teal it is."),
        ],
        settled: "t1",
      }),
    );
    expect(line).toMatchObject({ worked: true });
  });

  // D4: live, a run's words are its card's; over, they are its answer under it.
  it("draws a run's only words in its card while it runs, and as its answer once over", () => {
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "The review is done.\n\nFour issues stood out."),
    ];
    const live = rows({ entries, live: "t1" });
    expect(live.some((row) => row.id === "a1")).toBe(false);
    expect(live.some((row) => row.kind === "record")).toBe(true);
    const settled = rows({ entries, settled: "t1" });
    expect(settled.at(-1)?.id).toBe("a1");
  });

  it("keeps the card while the Mate composes, before its answer is known", () => {
    for (const entries of [
      [user("m0", 0)],
      [user("m0", 0), assistant("a1", "t1", 1, "The review is done.")],
    ]) {
      const kinds = rows({ entries, live: "t1" }).map((row) => row.kind);
      expect(kinds).toEqual(expect.arrayContaining(["record", "working"]));
    }
  });

  // D4 (run 11): the words the Mate is writing stream in the working row as
  // the note they become, and the answer is decided as the run ends — an
  // answer streamed under a live card read "pasted below while still
  // writing", then turned back into a note.
  it("streams the words the Mate is writing in the working row, the answer decided at the end", () => {
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
    expect(recordOf(writing)?.now).toMatchObject({
      kind: "writing",
      note: { key: "note:a2", message: { id: "a2" } },
    });
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
    // However much it reads as an answer, live it is the run's.
    const answering = rows({
      entries: [...before, assistant("a2", "t1", 3, "All three pass.\n\nThe routes:")],
      live: "t1",
    });
    expect(answering.some((row) => row.id === "a2")).toBe(false);
    expect(recordOf(answering)).toMatchObject({ answering: false });
    // Over, it is the answer under the card.
    const answered = rows({
      entries: [...before, assistant("a2", "t1", 3, "All three pass.\n\nThe routes:")],
      settled: "t1",
    });
    expect(answered.at(-1)?.id).toBe("a2");
  });

  // The thought it had before it began to write ended there: it stays in the
  // chat while the words are on their way — a thought that vanished under
  // the writing dots and came back above the note once it was known flickered
  // (Nova, 2026-09-27) — and the same while an answer streams under the card.
  it("keeps the thought that led to the words it is writing", () => {
    const before = [user("m0", 0), tool("w1", "t1", 1), reasoning("r1", "t1", 2)];
    const writing = rows({
      entries: [...before, assistant("a2", "t1", 3, "Checking /status next.", { streaming: true })],
      live: "t1",
    });
    expect(lines(writing)).toEqual(["· pnpm test", "~ thinking about it"]);
    expect(recordOf(writing)?.now).toMatchObject({ kind: "writing", note: { key: "note:a2" } });
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
      // Bodhi: its word landed a moment after the run it woke began.
      name: "a helper whose finish landed a moment after the run it woke began",
      during: [helperDone("h1", "t1", 2, 6.05)],
      after: [],
      woke: { entries: [{ id: "h1" }], tasks: 1, failed: 0, helpers: true, title: "Review h1" },
    },
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
    // Work no turn owns between two runs says itself in its own line.
    {
      name: "a task no turn owns, between two runs",
      during: [],
      after: [background("b1", 5)],
      woke: null,
    },
    {
      name: "a helper that finished after a task reported",
      during: [helperDone("h1", "t1", 2, 5.5)],
      after: [background("b1", 5)],
      woke: { entries: [{ id: "b1" }, { id: "h1" }], tasks: 2, helpers: false, title: "Review h1" },
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
    // Nobody wrote to start it: after a run that launched helpers, it is that
    // run going on, one card (run 11), and what woke it is said inside it,
    // where the run took it in; after any other, it is a run of its own, and
    // what woke it is said over it (review of pass 42).
    const goesOn = during.length > 0;
    const records = list.filter((row) => row.kind === "record");
    if (goesOn) expect(records).toHaveLength(1);
    const items = records.flatMap((row) => (row.kind === "record" ? row.items : []));
    const line = list.find((row) => row.id === "woke:turn:t2");
    const caption = goesOn ? items.find((item) => item.key === "woke:turn:t2") : line;
    if (woke === null) {
      expect(caption).toBeUndefined();
      return;
    }
    const { entries: _said, ...told } = woke;
    if (goesOn) {
      expect(line).toBeUndefined();
      expect(caption).toMatchObject({ kind: "event", event: { type: "woke", ...told } });
    } else {
      // It stands where the person's message would: first in the run.
      expect(line).toMatchObject({ kind: "background", ...woke });
      expect(list[list.indexOf(line!) + 1]?.id).toBe("a3");
    }
    // Said once: never again as a line of the run.
    const reported = new Set(woke.entries.map((entry) => entry.id));
    expect(items.filter((item) => item.kind === "task" && reported.has(item.entry.id))).toEqual([]);
  });

  // One launch that starts helpers together is one row, so which of them
  // finished is the helpers panel's to say. Each finish wakes the Mate once:
  // the runs nothing else woke take them in the order they finished — Nova's
  // two helpers each woke a run, the second finishing before the first run it
  // woke was done, and neither run said why it began (2026-09-28).
  // A command's start can arrive before the session names its run: turnless,
  // it was drawn as background work that "finished in the background" over
  // the run it began (Nova, 2026-09-28). The same call, reported with its
  // run, says whose it is: one step of that run, and no line of its own.
  it("gives a call seen before its run was named to the run its own report names", () => {
    const started = tool("c1", "t2", 5, {
      label: "Command run",
      sourceActivityKind: "tool.updated",
      toolLifecycleStatus: "inProgress",
      toolCallId: "call-shared",
    }) as Extract<TimelineEntry, { kind: "work" }>;
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 4, "Done."),
      { ...started, entry: { ...started.entry, turnId: null } } as TimelineEntry,
      tool("c2", "t2", 6, { label: "Command run", toolCallId: "call-shared" }),
      assistant("a2", "t2", 7, "And the rest."),
    ];
    const list = rows({ entries, settled: "t2" });
    expect(list.some((row) => row.kind === "background")).toBe(false);
    const second = list.findLast((row) => row.kind === "record");
    expect(second?.kind === "record" ? second.items.map((item) => item.kind) : null).toEqual([
      "step",
    ]);
  });

  // Run 9: a helper that finished during the run that launched it was taken
  // in by that run, yet woke a run twenty minutes later, as a line of its own.
  it("never says a helper woke a run when it finished while the run before still worked", () => {
    const launch = tool("l1", "t1", 2, {
      label: "List routes",
      toolTitle: "List routes",
      taskId: "task-routes",
      agentRole: "Explore",
      sourceActivityKind: "task.completed",
      tone: "info",
      agentSpawn: { workflowId: null, agentTaskIds: ["task-routes", "task-components"] },
    });
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Started them."),
      launch,
      assistant("a2", "t1", 4, "Both are back."),
      assistant("a3", "t2", 20, "Something else came in."),
    ];
    const helperFinishes: ReadonlyArray<HelperFinish> = [
      { id: "task-routes", title: "List routes", finishedAt: at(3), failed: false },
      { id: "task-components", title: "Count components", finishedAt: at(3, 30), failed: false },
    ];
    const list = rows({ entries, settled: "t2", helperFinishes });
    expect(list.some((row) => row.id.startsWith("woke:"))).toBe(false);
  });

  // Bodhi woke into "thought 5s" cards with nothing above them: the
  // platform's word that a helper finished can land a moment after the run
  // it woke began.
  it("says a helper woke a run when its finish lands a moment after the run began", () => {
    const launch = tool("l1", "t1", 2, {
      label: "List routes",
      toolTitle: "List routes",
      taskId: "task-routes",
      agentRole: "Explore",
      sourceActivityKind: "task.completed",
      tone: "info",
      agentSpawn: { workflowId: null, agentTaskIds: ["task-routes", "task-components"] },
    });
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Started them."),
      launch,
      assistant("a2", "t1", 4, "They report back when done."),
      assistant("a3", "t2", 6, "One is back."),
    ];
    const helperFinishes: ReadonlyArray<HelperFinish> = [
      { id: "task-routes", title: "List routes", finishedAt: at(6, 4), failed: false },
    ];
    expect(
      recordOf(rows({ entries, settled: "t2", helperFinishes }))?.items.find(
        (item) => item.key === "woke:turn:t2",
      ),
    ).toMatchObject({ kind: "event", event: { type: "woke", title: "List routes" } });
  });

  // Review of pass 39: a helper landing in a woken run's first moments was
  // later said to wake another run, and a task reporting then took the
  // place of the helper that did wake it.
  describe("what woke a run, when two finish close together", () => {
    const launch = tool("l1", "t1", 2, {
      label: "Fan out",
      toolTitle: "Fan out",
      taskId: "task-a",
      agentRole: "Explore",
      sourceActivityKind: "task.completed",
      tone: "info",
      agentSpawn: { workflowId: null, agentTaskIds: ["task-a", "task-b", "task-c"] },
    });
    const finish = (id: string, minute: number, second: number): HelperFinish => ({
      id: `task-${id}`,
      title: `Helper ${id}`,
      finishedAt: at(minute, second),
      failed: false,
    });
    // What woke each turn of the run, as its card says it (run 11).
    const wakers = (list: MessagesTimelineRow[]) =>
      Object.fromEntries(
        list.flatMap((row) =>
          row.kind === "record"
            ? row.items.flatMap((item) =>
                item.kind === "event" && item.event.type === "woke"
                  ? [[item.key, item.event.title]]
                  : [],
              )
            : [],
        ),
      );

    it("a helper landing in a woken run's first moments wakes no later run", () => {
      const entries = [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started them."),
        launch,
        assistant("a2", "t1", 4, "They report back."),
        // t2 works from 6:00 to 7:00: B lands in it.
        tool("x2", "t2", 6),
        assistant("a3", "t2", 7, "A is back."),
        assistant("a4", "t3", 20, "C is back."),
      ];
      const helperFinishes = [finish("a", 5, 59), finish("b", 6, 4), finish("c", 19, 59)];
      expect(wakers(rows({ entries, settled: "t3", helperFinishes }))).toEqual({
        "woke:turn:t2": "Helper a",
        "woke:turn:t3": "Helper c",
      });
    });

    it("a task reporting in a woken run's first moments never stands for the helper that woke it", () => {
      const watch = background("w1", 6, {
        label: "Watch the logs",
        toolTitle: "Watch the logs",
        updatedAt: at(6, 5),
      });
      const entries = [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started them."),
        launch,
        assistant("a2", "t1", 4, "They report back."),
        { ...watch, entry: { ...watch.entry, turnId: turn("t2") } } as TimelineEntry,
        assistant("a3", "t2", 7, "A is back."),
        assistant("a4", "t3", 20, "Nothing else."),
      ];
      const list = rows({ entries, settled: "t3", helperFinishes: [finish("a", 5, 59)] });
      expect(wakers(list)).toEqual({ "woke:turn:t2": "Helper a" });
      // The watch stays where it reported: in the turn it reported in.
      expect(recordOf(list)?.items.map((item) => item.key)).toContain("task:w1");
    });
  });

  // Run 9: commands sent to the background reported after their turn ended,
  // as a loose line whose count fell from 5 to 4 as the run they woke began,
  // and again above that run. A job is its own turn's: told once, on its
  // card, its count only rising.
  describe("a command sent to the background", () => {
    const launch = (id: string, title: string, minute: number) =>
      tool(id, "t1", minute, {
        label: "Command run",
        command: `./${id}.sh`,
        callInput: { description: title },
        updatedAt: at(minute, 1),
        // Its call's own notice, as production reads it: the task's start
        // never reaches the work log.
        sentToBackground: `job-${id}`,
      });
    const reported = (id: string, title: string, minute: number, failed = false) =>
      background(`${id}-done`, minute, {
        label: title,
        toolTitle: title,
        taskId: `job-${id}`,
        taskToolUseId: `call-${id}`,
        command: undefined as never,
        tone: failed ? "error" : "info",
        detail: `Background command "${title}" ${failed ? "failed with exit code 3" : "completed (exit code 0)"}`,
      });
    const turnOne = [
      user("m0", 0),
      launch("soak", "Run the soak test", 1),
      launch("fails", "Run the failing job", 1),
      assistant("a1", "t1", 2, "Both are running."),
    ];

    const jobsOf = (list: MessagesTimelineRow[]) => {
      const line = list.find((row) => row.id === "jobs:msg:m0");
      return line?.kind === "background"
        ? (line.jobs ?? []).map((job) => [job.title, job.state, job.report])
        : null;
    };

    // Its session gone — idle, and the server says nothing lives in the
    // background — a job that never reported says so, once.
    it.each([
      { name: "the server holds both", held: ["job-soak", "job-fails"], state: "running" },
      { name: "the server holds neither any more", held: [], state: "lost" },
    ])("a job that never reported back: $name", ({ held, state }) => {
      const list = rows({ entries: turnOne, settled: "t1", liveJobs: held });
      const line = list.find((row) => row.id === "jobs:msg:m0");
      expect(line?.kind === "background" ? line.jobs?.map((job) => job.state) : null).toEqual([
        state,
        state,
      ]);
    });

    it.each([
      {
        name: "both still running",
        later: [] as TimelineEntry[],
        settled: "t1",
        jobs: [
          ["Run the soak test", "running", null],
          ["Run the failing job", "running", null],
        ],
      },
      {
        name: "one failed after the turn, waking a run of its own",
        later: [
          reported("fails", "Run the failing job", 3, true),
          assistant("a2", "t2", 4, "The failing job failed."),
        ],
        settled: "t2",
        jobs: [
          ["Run the soak test", "running", null],
          ["Run the failing job", "failed", "Exit code 3"],
        ],
      },
      {
        name: "both reported",
        later: [
          reported("fails", "Run the failing job", 3, true),
          assistant("a2", "t2", 4, "The failing job failed."),
          reported("soak", "Run the soak test", 6),
          assistant("a3", "t3", 7, "The soak passed."),
        ],
        settled: "t3",
        jobs: [
          ["Run the soak test", "done", null],
          ["Run the failing job", "failed", "Exit code 3"],
        ],
      },
    ])("tells its job on its own card, once: $name", ({ later, settled, jobs }) => {
      const list = framed({ entries: [...turnOne, ...later], settled });
      expect(jobsOf(list)).toEqual(jobs);
      // On the card of the turn that sent them, under its record.
      const line = list.findIndex((row) => row.id === "jobs:msg:m0");
      const cardEnd = list.findIndex((row) => row.kind === "card-end");
      expect(line).toBeGreaterThan(list.findIndex((row) => row.id === "record:msg:m0"));
      expect(line).toBeLessThan(cardEnd);
      // Nowhere else: no loose line, no line over the run it woke.
      expect(
        list.filter(
          (row) => (row.kind === "background" && row.id !== "jobs:msg:m0") || row.kind === "work",
        ),
      ).toEqual([]);
    });
  });

  it("says which of the helpers one launch started woke each run, in the order they finished", () => {
    const launch = tool("l1", "t1", 2, {
      label: "List routes",
      toolTitle: "List routes",
      taskId: "task-routes",
      agentRole: "Explore",
      sourceActivityKind: "task.completed",
      tone: "info",
      agentSpawn: { workflowId: null, agentTaskIds: ["task-routes", "task-components"] },
    });
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 1, "Started them."),
      launch,
      assistant("a2", "t1", 4, "They report back when done."),
      assistant("a3", "t2", 6, "One is back."),
      assistant("a4", "t3", 8, "Both are back."),
    ];
    const helperFinishes: ReadonlyArray<HelperFinish> = [
      { id: "task-routes", title: "List routes", finishedAt: at(5, 40), failed: false },
      { id: "task-components", title: "Count components", finishedAt: at(5), failed: false },
    ];
    // Each turn of the run says what woke it, where the run took it in (run 11).
    const items = recordOf(rows({ entries, settled: "t3", helperFinishes }))?.items ?? [];
    expect(items.find((item) => item.key === "woke:turn:t2")).toMatchObject({
      event: { type: "woke", tasks: 1, helpers: true, title: "Count components" },
    });
    expect(items.find((item) => item.key === "woke:turn:t3")).toMatchObject({
      event: { type: "woke", tasks: 1, helpers: true, title: "List routes" },
    });
    // Without the panel's word, which of them finished stays unknown: no line.
    expect(
      recordOf(rows({ entries, settled: "t3" }))?.items.some((item) =>
        item.key.startsWith("woke:"),
      ),
    ).toBe(false);
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
    // One card, going on (run 11): what woke it is said inside it from the
    // first frame, and it holds as the run speaks.
    const said = (list: MessagesTimelineRow[]) =>
      recordOf(list)?.items.map((item) => item.key) ?? [];
    expect(said(waking).at(-1)).toBe("woke:turn:t2");
    expect(said(speaking).slice(0, said(waking).length)).toEqual(said(waking));
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
      name: "a settled operation is a line; a check is its row where it happened",
      entries: [
        operation("v1", "t1", 1, { kind: "verify", phase: "failed", statusWord: "Unhealthy" }),
        operation("d1", "t1", 2, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        operation("b1", "t1", 3, { kind: "browser", phase: "failed", statusWord: "Failed" }),
        operation("v2", "t1", 4, { kind: "verify", phase: "done", statusWord: "Healthy" }),
      ],
      record: ["✗ verify appdev", "✗ deploy appdev", "strip op:b1", "✓ verify appdev"],
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
    expect(lines(list)).toEqual(["· pnpm test", "Found it: the build used the dev setup."]);
  });

  // A check is its row of the chat from its start, where it happened, live
  // as settled — however often the person wrote into the run. It stood in a
  // drawer under the chat until the run was over, a stale picture while the
  // Mate deployed (Nova, 2026-09-28).
  it("draws a check where it happened from its start, the same live and settled", () => {
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, { kind: "browser", subject: "https://shop.dev/" }),
      tool("w1", "t1", 2),
      user("m1", 3, "and the footer"),
      tool("w2", "t1", 4),
    ];
    const live = rows({ entries, live: "t1" });
    const drawn = ["strip op:b1", "· pnpm test", "· pnpm test"];
    expect(lines(live)).toEqual(drawn);
    expect(live.find((row) => row.kind === "working")).not.toHaveProperty("strip");
    const settled = rows({
      entries: [...entries, assistant("a1", "t1", 5, "Done.")],
      settled: "t1",
    });
    expect(lines(settled)).toEqual(drawn);
  });

  // Several calls at once are all the now line's (K10): "Running 3 commands",
  // one line each under it — none of them left out until it returns.
  it("carries every call it runs at once to the now line, oldest first", () => {
    const running = (id: string, minute: number, command: string) =>
      tool(id, "t1", minute, {
        command,
        toolLifecycleStatus: "inProgress",
        sourceActivityKind: "tool.started",
      });
    const live = rows({
      entries: [
        user("m0", 0),
        running("w1", 1, "pnpm build"),
        running("w2", 1, "pnpm test"),
        running("w3", 2, "pnpm lint"),
      ],
      live: "t1",
    });
    const now = recordOf(live)?.now;
    expect(now?.kind).toBe("step");
    if (now?.kind !== "step") return;
    expect(now.step.code).toBe("pnpm lint");
    expect(now.others?.map((call) => call.kind === "step" && call.step.code)).toEqual([
      "pnpm build",
      "pnpm test",
    ]);
    expect(recordOf(live)?.items).toEqual([]);
  });

  // A page checked on a desktop and then a phone is one row of takes; a check
  // after other work starts a row of its own, so no row above the newest
  // grows. The one being taken is the now line's until it ends (K10).
  it("gathers checks one after another into one row, and starts another after other work", () => {
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, { kind: "browser", subject: "https://shop.dev/" }),
      operation("b2", "t1", 2, {
        kind: "browser",
        subject: "https://shop.dev/",
        deviceName: "iPhone 16",
      }),
      tool("w1", "t1", 3),
      operation("b3", "t1", 4, {
        kind: "browser",
        subject: "https://shop.dev/cart",
        phase: "running",
      }),
    ];
    const live = rows({ entries, live: "t1" });
    expect(lines(live)).toEqual(["strip op:b1 op:b2", "· pnpm test"]);
    expect(recordOf(live)?.items.map((item) => item.key)).toEqual(["operation:op:b1", "step:w1"]);
    const now = recordOf(live)?.now;
    expect(now?.kind === "operation" ? now.operation.key : null).toBe("op:b3");
    // Once taken, it lands at the record's end, after what came before it.
    const taken = rows({
      entries: entries.map((entry) =>
        entry.kind === "operation" && entry.operation.key === "op:b3"
          ? operation("b3", "t1", 4, { kind: "browser", subject: "https://shop.dev/cart" })
          : entry,
      ),
      live: "t1",
    });
    expect(lines(taken)).toEqual(["strip op:b1 op:b2", "· pnpm test", "strip op:b3"]);
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

  // The run reads as a chat (the owner, 2026-09-27: "have the whole thing
  // look like a chat"): every thought is a bubble of its own, however short,
  // and no step hides the thinking that led to it.
  it.each([
    { name: "a short thought is a bubble of its own", seconds: 4 },
    { name: "and so is a long one", seconds: 25 },
  ])("$name", ({ seconds }) => {
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
      expect(
        items.flatMap((item) =>
          item.kind === "step" || item.kind === "thought" ? [item.key] : [],
        ),
      ).toEqual(["step:w1", "thought:r1", "step:w2"]);
      expect(items.find((item) => item.key === "step:w2")).not.toHaveProperty("thought");
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
      effort: "1 helper",
    },
    {
      name: "two helpers at once",
      spawned: ["task-h1", "task-h2"],
      commands: 0,
      effort: "2 helpers",
    },
    {
      name: "after other work",
      spawned: ["task-h1"],
      commands: 2,
      effort: "2 commands · 1 helper",
    },
  ])("records and counts what a run started: $name", ({ spawned, commands, effort }) => {
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
    const outcome = recordOf(list)?.outcome;
    expect(outcome ? runEffortWords(outcome) : null).toBe(effort);
    expect(statusOf(list)).toMatchObject({ worked: true });
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
    expect(statusOf(list)).toMatchObject({ worked });
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
      "record:record:msg:m0",
      "outcome:outcome:msg:m0",
      "message:a1",
    ]);
    expect(lines(list)).toEqual([
      "strip op:b1",
      "event landed",
      "event compaction",
      "error Claude API is overloaded (529)",
      "✗ Re-run type checks",
      "✗ deploy appdev",
      "✓ deploy appdev",
    ]);
    expect(statusOf(list)).toMatchObject({ face: "produced" });
  });

  it("draws the Mate's question and the person's answer in the card, in their own hands", () => {
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
    // The request and the submission are no rows of their own.
    expect(shape(list).filter((id) => id.includes(":rq") || id.includes(":rs"))).toEqual([]);
    expect(recordOf(list)?.items.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "question", questions: ["Which accent colour?"] }),
      expect.objectContaining({ kind: "person", words: "Green" }),
    ]);
    expect(lines(list)).toEqual(["? Which accent colour?", "> Green", "· pnpm test"]);
  });

  it("says a pick the Mate recommended in the person's words, without its mark", () => {
    const list = rows({
      entries: [
        user("m0", 0),
        asked("rq", 1),
        answeredWith("rs", 2, "Use the green accent (Recommended)"),
        tool("w1", "t1", 3),
        assistant("a1", "t1", 4, "Green it is."),
      ],
      settled: "t1",
    });
    expect(lines(list)?.[1]).toBe("> Use the green accent");
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
    expect(lines(list)).toEqual(["· pnpm test", "strip op:b1"]);
  });

  it("draws one pause for a usage limit, however many attempts ran into it", () => {
    const limit = "You've hit your session limit · resets 9:20pm (UTC)";
    const list = rows({
      limit: refusedLimit,
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
      "record:record:msg:m0",
      "pause:pause:msg:m0",
      "message:m1",
    ]);
    expect(list[3]).toMatchObject({
      held: 3,
      resumedAt: null,
      resetsAt: new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    });
    expect(recordOf(list)?.status).toMatchObject({ face: "paused" });
    // Refused admission did no work: the pause tells it once, without a fabricated work duration.
    expect(list.some((row) => row.kind === "work-line")).toBe(false);
  });

  it("tells a limit once when the server adds its own error row, and keeps a real answer", () => {
    const list = rows({
      limit: refusedLimit,
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
      "record:record:msg:m0",
      "pause:pause:msg:m0",
      "message:a1",
    ]);
    expect(statusOf(list)).toMatchObject({ face: "paused" });
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
      after: ["message:m1", "record:record:msg:m1", "working:working:msg:m1"],
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
      after: ["message:m1", "record:record:msg:m1", "message:a1"],
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
      after: ["message:m1", "record:record:msg:m1", "message:a1"],
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
      after: ["message:m1", "record:record:msg:m1", "message:a1"],
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
    expect(list.find((row) => row.kind === "record")?.id).toBe("record:msg:m1");
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

  it("draws the server's crew task card as its own row, never the person's bubble", () => {
    const list = rows({
      entries: [
        user("m0", 0, `${CREW_CARD_OPENER}\n#12 Camera rig · from you\nDone when: it follows`),
        tool("w1", "t1", 1),
      ],
      settled: "t1",
    });
    expect(list[1]).toMatchObject({
      kind: "crew-card",
      id: "m0",
      task: { title: "#12 Camera rig · from you", text: "Done when: it follows" },
    });
  });

  describe("crew seams", () => {
    const LANDED = {
      seam: "landed",
      taskId: "task-12",
      number: 12,
      commit: "a1b2c3d4e5f6",
    } as const;
    /** A line the crew engine drew across a crewmate's chat: no turn owns it. */
    const crewSeam = (id: string, minute: number, words = "Task #12 landed as a1b2c3d") => {
      const entry = tool(id, "t1", minute, {
        label: words,
        tone: "info",
        sourceActivityKind: "crew.seam",
        crewSeam: LANDED,
      }) as Extract<TimelineEntry, { kind: "work" }>;
      const {
        command: _command,
        toolCallId: _call,
        toolLifecycleStatus: _status,
        ...rest
      } = entry.entry;
      return { ...entry, entry: { ...rest, turnId: null } };
    };

    it("draws a seam between turns as its own line, never as background work", () => {
      const list = rows({
        entries: [user("m0", 0), assistant("a1", "t1", 1), crewSeam("s1", 10)],
        settled: "t1",
      });
      expect(list.at(-1)).toMatchObject({
        kind: "crew-seam",
        id: "s1",
        seam: LANDED,
        words: "Task #12 landed as a1b2c3d",
      });
      expect(list.some((row) => row.kind === "background")).toBe(false);
    });

    it("keeps a seam out of the background work around it", () => {
      const list = rows({
        entries: [
          user("m0", 0),
          assistant("a1", "t1", 1),
          background("b1", 9),
          crewSeam("s1", 10),
          background("b2", 11),
        ],
        settled: "t1",
      });
      expect(shape(list).slice(-3)).toEqual([
        "background:background:b1",
        "crew-seam:s1",
        "background:background:b2",
      ]);
    });

    it("stands apart from what is around it, as a day seam does", () => {
      const list = rows({
        entries: [user("m0", 0), assistant("a1", "t1", 1), crewSeam("s1", 10), user("m1", 11)],
        settled: "t1",
      });
      const seamAt = list.findIndex((row) => row.kind === "crew-seam");
      expect(list[seamAt]?.gap).toBe("turn-after-words");
      expect(list[seamAt + 1]?.gap).toBe("part");
    });

    it("draws a seam that lands while a turn runs as its line there, in the run's chat", () => {
      const list = rows({
        entries: [user("m0", 0), tool("w1", "t1", 1), crewSeam("s1", 2)],
        live: "t1",
      });
      const record = list.find((row) => row.kind === "record");
      expect(record?.kind === "record" ? record.items.map((item) => item.kind) : []).toEqual([
        "step",
        "crew-seam",
      ]);
      expect(record?.kind === "record" ? record.items.at(-1) : undefined).toMatchObject({
        key: "crew-seam:s1",
        seam: LANDED,
        words: "Task #12 landed as a1b2c3d",
      });
    });
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
    expect(statusOf(list)).toMatchObject({ worked: false });
    expect(lines(list)).toEqual(["~ thinking about it"]);
  });

  describe("draws a time line only where an hour or a day passed", () => {
    /** The reader's own clock: a day begins at their midnight. */
    const local = (day: number, hour: number, minute: number) =>
      new Date(2026, 8, day, hour, minute).toISOString();
    const saidAt = (entry: TimelineEntry, iso: string): TimelineEntry =>
      entry.kind === "message"
        ? {
            ...entry,
            createdAt: iso,
            message: { ...entry.message, createdAt: iso, updatedAt: iso },
          }
        : entry;
    /** Each turn as when the person asked and when the Mate answered. */
    const seams = (turns: ReadonlyArray<readonly [asked: string, answered: string]>) => {
      const last = turns.length - 1;
      return deriveMessagesTimelineRows({
        timelineEntries: turns.flatMap(([asked, answered], index) => [
          saidAt(user(`m${index}`, 0), asked),
          saidAt(assistant(`a${index}`, `t${index}`, 0, "Done."), answered),
        ]),
        latestTurn: {
          turnId: turn(`t${last}`),
          state: "completed",
          startedAt: turns[last]![0],
          completedAt: turns[last]![1],
        },
        isWorking: false,
        activeTurnStartedAt: null,
        turnDiffSummaries: [],
        supportsConversationRollback: false,
      }).flatMap((row) => (row.kind === "seam" ? [row.seam] : []));
    };
    it.each([
      [
        "minutes apart: one conversation, dated once at its top",
        [
          [local(24, 10, 0), local(24, 10, 1)],
          [local(24, 10, 4), local(24, 10, 5)],
        ],
        ["day"],
      ],
      [
        "most of an hour apart: still one conversation",
        [
          [local(24, 10, 0), local(24, 10, 1)],
          [local(24, 10, 59), local(24, 11, 0)],
        ],
        ["day"],
      ],
      [
        "an hour apart: the time",
        [
          [local(24, 10, 0), local(24, 10, 1)],
          [local(24, 11, 1), local(24, 11, 2)],
        ],
        ["day", "gap"],
      ],
      [
        "minutes apart across midnight: no line splits them",
        [
          [local(24, 23, 55), local(24, 23, 57)],
          [local(25, 0, 0), local(25, 0, 1)],
        ],
        ["day"],
      ],
      [
        "a day apart: the day",
        [
          [local(24, 10, 0), local(24, 10, 1)],
          [local(25, 10, 0), local(25, 10, 1)],
        ],
        ["day", "day"],
      ],
      [
        "a night apart: the new day",
        [
          [local(24, 22, 0), local(24, 22, 1)],
          [local(25, 8, 0), local(25, 8, 1)],
        ],
        ["day", "day"],
      ],
      [
        "past midnight without a line, then an hour's quiet: the new day",
        [
          [local(24, 23, 55), local(24, 23, 57)],
          [local(25, 0, 0), local(25, 0, 1)],
          [local(25, 2, 0), local(25, 2, 1)],
        ],
        ["day", "day"],
      ],
    ] as const)("%s", (_, turns, expected) => {
      expect(seams(turns)).toEqual(expected);
    });
  });

  // Catches an imported conversation that hides where its earlier turns stayed behind, or files
  // the line among the work of the run it was recorded in.
  it("opens a conversation the history import cut on a line saying what stayed behind", () => {
    const words =
      "12 earlier turns stayed with the previous engine: this conversation starts here.";
    const list = rows({
      entries: [
        tool("cut", "t1", 0, { sourceActivityKind: "history.cut", label: words }),
        user("m0", 1),
        assistant("a1", "t1", 2, "Hi."),
      ],
      settled: "t1",
    });
    expect(list[0]).toMatchObject({ kind: "seam", seam: "cut", words });
    expect(JSON.stringify(list.slice(1))).not.toContain(words);
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
  it("keeps the question and where the person's answer reached the Mate in its record", () => {
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
      "? Which accent colour do you prefer?",
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
      expect(list.find((row) => row.id === "m1")).toMatchObject({ kind: "message", imageOnly });
    },
  );

  it.each([
    {
      name: "its helper works",
      afterTurnWork: "working" as const,
      live: ["task-h1"],
      last: "card-end:card-end:msg:m0",
    },
    // Review of pass 42: a dev server or a watch runs for hours, and a
    // helper of another run is that run's: neither holds this one open.
    {
      name: "a watch works",
      afterTurnWork: "monitoring" as const,
      live: ["task-watch"],
      last: "after-work:after-work",
    },
    {
      name: "another run's helper works",
      afterTurnWork: "working" as const,
      live: ["task-other"],
      last: "after-work:after-work",
    },
    { name: "nothing works", afterTurnWork: null, live: [] as string[], last: "message:a1" },
  ])(
    // Run 11, "finished, but background running": the run's own card waits on
    // the helpers it launched, its last words no answer yet, nothing at the bottom.
    "keeps the run's card waiting while its helpers work on: $name",
    ({ afterTurnWork, live, last }) => {
      const helper = tool("h1", "t1", 1, {
        label: "Review h1",
        taskId: "task-h1",
        agentRole: "general-purpose",
        sourceActivityKind: "task.started",
        tone: "info",
      });
      const list = deriveMessagesTimelineRows({
        timelineEntries: [
          user("m0", 0),
          helper,
          tool("w1", "t1", 1),
          assistant("a1", "t1", 2, "Done."),
        ],
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
        liveJobs: { ids: new Set(live) },
      });
      expect(shape(list).at(-1)).toBe(last);
      if (live.includes("task-h1")) {
        expect(list.some((row) => row.kind === "after-work")).toBe(false);
        expect(recordOf(list)).toMatchObject({
          live: true,
          now: { kind: "after" },
          status: { live: true },
        });
        expect(list.some((row) => row.kind === "working")).toBe(true);
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
    // A blank line inside a code block is the block's, closed or still open.
    {
      text: "Like this:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nDone.",
      paragraphs: ["Like this:", "```ts\nconst a = 1;\n\nconst b = 2;\n```", "Done."],
    },
    {
      text: "Like this:\n\n```ts\nconst a = 1;\n\nconst b",
      paragraphs: ["Like this:", "```ts\nconst a = 1;\n\nconst b"],
    },
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

describe("a run that broke off", () => {
  // Its agent died under it (Sage, run 12: a SIGABRT an hour in): the card
  // ends on why, and the words it had written last stay in its record — they
  // were on the way, never its answer.
  it("ends its card on why, its last words kept in its record", () => {
    const words = "Codex stopped unexpectedly. Send a message to pick up where it left off.";
    const list = rows({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Restarting the dev server cleanly…"),
        tool("w2", "t1", 3),
        tool("e1", "t1", 5, {
          label: "Runtime error",
          tone: "error",
          detail: words,
          command: undefined as never,
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          sourceActivityKind: "runtime.error",
        }),
      ],
      settled: "t1",
    });
    expect(statusOf(list)).toMatchObject({
      live: false,
      face: "brokeOff",
      brokeOff: {
        reason: "Codex stopped unexpectedly.",
        next: "Send a message to pick up where it left off.",
      },
    });
    expect(list.filter((row) => row.kind === "message").map((row) => row.id)).toEqual(["m0"]);
    expect(allItems(list).some((item) => item.kind === "note")).toBe(true);
  });
});

describe("a run the usage limit stopped", () => {
  // Codex's limit in its own words, typed by the server: the run reads
  // "stopped at the usage limit", with the pause under it — never a break.
  it("pauses, whatever the driver's words", () => {
    const list = rows({
      limit: refusedLimit,
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        tool("e1", "t1", 12, {
          label: "Runtime error",
          tone: "error",
          detail: "Codex usage limit reached. Try again at 9:20 PM.",
          turnEnd: "usage-limit",
          command: undefined as never,
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          sourceActivityKind: "runtime.error",
        }),
      ],
      settled: "t1",
    });
    expect(statusOf(list)).toMatchObject({ face: "paused" });
    expect(statusOf(list)?.brokeOff).toBeUndefined();
    expect(list.some((row) => row.kind === "pause")).toBe(true);
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
      expected: ["message", "record:top", "outcome:middle", "card-end:bottom", "message"],
    },
    {
      case: "settled, a command: counted on its line, nothing under it",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
        settled: "t1",
      } satisfies Scene,
      expected: ["message", "record:top", "card-end:bottom", "message"],
    },
    {
      case: "live: the record, then what runs alongside",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Looking.")],
        live: "t1",
      } satisfies Scene,
      expected: ["message", "record:top", "working:middle", "card-end:bottom"],
    },
    {
      case: "written into: the person's message stands above the whole card",
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
      expected: ["message", "message", "record:top", "working:middle", "card-end:bottom"],
    },
    {
      case: "settled, a change landed: the record says where, the result names it",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), landed("l1", 2), assistant("a1", "t1", 3)],
        settled: "t1",
      } satisfies Scene,
      expected: ["message", "record:top", "outcome:middle", "card-end:bottom", "message"],
    },
    {
      case: "live, a change landed: a line of the record until the result takes it",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), landed("l1", 2), tool("w2", "t1", 3)],
        live: "t1",
      } satisfies Scene,
      expected: ["message", "record:top", "working:middle", "card-end:bottom"],
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

  // D4 (run 11): a running turn's words that read as an answer stay the
  // card's until the run ends — nothing streams under a live card.
  it("keeps a running turn's answer-like words in its card until the settle", () => {
    const list = framed({
      entries: [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy" }),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
      ],
      live: "t1",
    });
    expect(cards(list)).toEqual(["message", "record:top", "working:middle", "card-end:bottom"]);
    expect(list.some((row) => row.kind === "message" && row.id === "a1")).toBe(false);
    expect(recordOf(list)).toMatchObject({ answering: false });
  });

  // A card with nothing in it but its line's row is drawn whole by that row,
  // its corners its own (the owner, 2026-09-30, of a live card holding only
  // "Thinking": "the state of border radiuses in the initial thinking with no
  // other content around sucks"): settled with nothing to report, or live
  // with nothing running alongside it.
  it.each([
    {
      case: "settled, nothing under its line",
      scene: {
        entries: [user("m0", 0), reasoning("r1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
        settled: "t1",
      } satisfies Scene,
      whole: ["record", "card-end"],
    },
    {
      // "Cleo worked 13s · 1 command": what it ran is said on the line.
      case: "settled, a command counted on its line",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
        settled: "t1",
      } satisfies Scene,
      whole: ["record", "card-end"],
    },
    {
      case: "settled, its result under its line",
      scene: {
        entries: [
          user("m0", 0),
          operation("d1", "t1", 1, { kind: "deploy" }),
          assistant("a1", "t1", 2, "Done."),
        ],
        settled: "t1",
      } satisfies Scene,
      whole: [],
    },
    {
      case: "settled, its pause under its line",
      scene: {
        entries: [
          user("m0", 0),
          tool("w1", "t1", 1),
          assistant("a1", "t1", 48, "You've hit your session limit · resets 9:20pm (UTC)"),
        ],
        settled: "t1",
      } satisfies Scene,
      whole: ["record", "card-end"],
    },
    {
      case: "live, nothing running alongside",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1)],
        live: "t1",
      } satisfies Scene,
      whole: ["record", "working", "card-end"],
    },
    {
      case: "live, nothing done yet",
      scene: { entries: [user("m0", 0)], live: "t1" } satisfies Scene,
      whole: ["record", "working", "card-end"],
    },
    {
      case: "live, something running alongside",
      scene: {
        entries: [user("m0", 0), tool("w1", "t1", 1)],
        live: "t1",
        alongside: true,
      } satisfies Scene,
      whole: [],
    },
  ])("draws a card whole by its line's row: $case", ({ scene, whole }) => {
    const list = framed(scene);
    expect(list.filter((row) => row.cardWhole === true).map((row) => row.kind)).toEqual(whole);
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
      const cardAt = liveCardAt(previous);
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
      const keys = allItems(framed({ entries, live: "t1" })).map((item) => item.key);
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

  // The record carries the run's status (its now line's clock) and what the
  // run came to (its worked line's effort): a record whose only change is one
  // of them is a changed row, never the old one kept.
  it.each([
    {
      name: "what it came to",
      change: (row: Extract<MessagesTimelineRow, { kind: "record" }>) => ({
        ...row,
        outcome:
          row.outcome === null
            ? null
            : { ...row.outcome, activity: [{ kind: "command" as const, count: 9 }] },
      }),
    },
    {
      name: "its status",
      change: (row: Extract<MessagesTimelineRow, { kind: "record" }>) => ({
        ...row,
        status: row.status === null ? null : { ...row.status, waitedMs: 5000 },
      }),
    },
  ])("takes a record whose $name changed", ({ change }) => {
    const list = rows({
      entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
      settled: "t1",
    });
    const first = computeStableMessagesTimelineRows(list, { byId: new Map(), result: [] });
    const at = list.findIndex((row) => row.kind === "record");
    const record = list[at] as Extract<MessagesTimelineRow, { kind: "record" }>;
    expect(record.outcome).not.toBeNull();
    const next = list.map((row, index) => (index === at ? change(record) : row));
    const second = computeStableMessagesTimelineRows(next, first);
    expect(second.result[at]).not.toBe(first.result[at]);
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

// Loading earlier turns keeps the row the person was reading where it stood:
// the first row of the conversation in sight — a day's seam moves to the top
// of what loads, and keeping it in place threw the rest 3,300 px down.
describe("earlierTurnsAnchor", () => {
  const row = (id: string, kind: string, top: number, height = 40) => ({
    id,
    kind,
    top,
    bottom: top + height,
  });
  it("takes the first row of the conversation in sight, never a seam", () => {
    expect(
      earlierTurnsAnchor(
        [row("seam:day", "seam", 100, 30), row("m1", "message", 136), row("r1", "record", 190)],
        56,
      ),
    ).toEqual({ id: "m1", top: 136 });
  });
  it("takes a row still partly in sight over one below it, and none above it", () => {
    expect(
      earlierTurnsAnchor(
        [row("r0", "record", -60, 50), row("r1", "record", 20, 200), row("m2", "message", 230)],
        56,
      ),
    ).toEqual({ id: "r1", top: 20 });
  });
  it("takes nothing where nothing of the conversation is in sight", () => {
    expect(earlierTurnsAnchor([row("seam:day", "seam", 100, 30)], 56)).toBeNull();
  });
});

describe("rowGap: a turn is one group, 24 px inside and 64 px between turns", () => {
  const as = (row: object) => row as unknown as MessagesTimelineRow;
  const person = as({ kind: "message", message: { role: "user" } });
  const mate = as({ kind: "message", message: { role: "assistant" } });
  const queued = as({ kind: "queued-message" });
  const record = as({ kind: "record" });
  const workLine = as({ kind: "work-line" });
  const working = as({ kind: "working" });
  const outcome = as({ kind: "outcome" });
  const seam = as({ kind: "seam" });
  const crewSeam = as({ kind: "crew-seam" });
  const woke = as({ kind: "background", id: "woke:msg:m1" });
  const loose = as({ kind: "background", id: "background:b1" });
  const command = as({ kind: "event", event: { type: "command" } });
  const landed = as({ kind: "event", event: { type: "landed" } });
  const crewCard = as({ kind: "crew-card" });
  const afterWork = as({ kind: "after-work" });
  it.each([
    // A turn's parts: the person's words, the card of the work, the answer.
    ["the card under the person's words", person, record, "part"],
    ["a run's line under the person's words", person, workLine, "part"],
    ["the card under what woke the Mate", woke, record, "part"],
    ["the card under the person's command", command, record, "part"],
    ["a crewmate's card under its task", crewCard, record, "part"],
    ["the answer under a settled card", outcome, mate, "part-words"],
    ["the answer under a card still at work", working, mate, "part-words"],
    ["the answer under a card of chat alone", record, mate, "part-words"],
    ["the answer straight under the person's words", person, mate, "part-words"],
    ["a message waiting for the card at work", working, queued, "part"],
    // A new turn.
    ["the person's words after the Mate's answer", mate, person, "turn-after-words"],
    ["the person's words after a card with no answer", outcome, person, "turn"],
    ["the person's words after a run's lone line", workLine, person, "turn"],
    ["the person's command after the Mate's answer", mate, command, "turn-after-words"],
    ["a run nobody typed after the answer", mate, record, "turn-after-words"],
    ["a run nobody typed after a card", outcome, record, "turn"],
    ["what woke the Mate after the answer", mate, woke, "turn-after-words"],
    ["a crewmate's next task after its answer", mate, crewCard, "turn-after-words"],
    // A seam opens the turn under it.
    ["a seam after the answer", mate, seam, "turn-after-words"],
    ["a seam after a card", outcome, seam, "turn"],
    ["a crew's seam after the answer", mate, crewSeam, "turn-after-words"],
    ["the person's words under a seam", seam, person, "part"],
    ["the answer under a seam", seam, mate, "part-words"],
    // Close, by kind.
    ["the first row", undefined, person, "none"],
    ["two messages of the person's", person, person, "tight"],
    ["what runs alongside under the record", record, working, "tight"],
    ["the result under the record", record, outcome, "tight"],
    ["the result under what ran alongside", working, outcome, "line"],
    ["the work outliving the turn under the answer", mate, afterWork, "block"],
    ["background work no run owns under a card", record, loose, "line"],
    ["a change landing under the answer", mate, landed, "block"],
    ["two answers of the Mate's", mate, mate, "block"],
  ] as const)("%s", (_, previous, row, gap) => {
    expect(rowGap(previous, row)).toBe(gap);
  });

  it("spaces two turns as groups: the parts close, the turns apart", () => {
    const list = framed({
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Done."),
        user("m1", 3),
        tool("w2", "t2", 4),
        assistant("a2", "t2", 5, "Done again."),
      ],
      settled: "t2",
    });
    const gaps = list
      .filter((row) => row.kind !== "seam" && row.kind !== "card-end" && row.kind !== "outcome")
      .map((row) => `${row.kind}:${row.gap}`);
    expect(gaps).toEqual([
      "message:part",
      "record:part",
      "message:part-words",
      "message:turn-after-words",
      "record:part",
      "message:part-words",
    ]);
  });
});

describe("conversationSpeaker: who speaks in a conversation", () => {
  const ivy = { name: "Ivy", tint: "amber", shape: "squircle" } as const;
  it.each([
    [
      "a crewmate's conversation: the crewmate",
      { crewmate: { handle: "rex", profile: { displayName: "Rex", tint: "sky" } }, at: "mate" },
      { name: "Rex", tint: "sky" },
    ],
    ["a Mate named: the Mate", { crewmate: null, at: "mate" }, ivy],
    // Not named yet: a neutral speaker, never upstream's "Assistant" to flip from.
    [
      "who lives here not known yet",
      { crewmate: null, at: "unknown" },
      { name: "This Mate", tint: "slate" },
    ],
    [
      "nobody: upstream's assistant",
      { crewmate: null, at: "nobody" },
      { name: "Assistant", tint: "slate" },
    ],
  ] as const)("%s", (_case, input, speaker) => {
    expect(
      conversationSpeaker({
        crewmate: input.crewmate,
        mate: input.at === "mate" ? ivy : null,
        nobody: input.at === "nobody",
      }),
    ).toEqual(speaker);
  });
});

// The Mate asks the person for a value only they have (`zerops_env
// action=request`): the ask is theirs to answer, so it stands after the run
// and its answer — never folded away with the work.
describe("deriveMessagesTimelineRows — a request for a vault value", () => {
  const request = (
    id: string,
    minute: number,
    over: { phase?: "done" | "failed"; alreadySet?: boolean; action?: "request" | "set" } = {},
  ) =>
    operation(id, "t1", minute, {
      kind: "env",
      phase: over.phase ?? "done",
      subject: "the project",
      envChange:
        over.action === "set"
          ? { action: "set", scope: "project", count: 1 }
          : {
              action: "request",
              scope: "project",
              request: { key: "STRIPE_KEY", sensitive: true, alreadySet: over.alreadySet ?? false },
            },
    });

  it("settled: after the run's answer", () => {
    const list = rows({
      entries: [user("u1", 0), tool("w1", "t1", 1), request("e1", 2), assistant("a1", "t1", 3)],
      settled: "t1",
    });
    expect(shape(list).slice(-2)).toEqual(["message:a1", "vault-request:vault-request:op:e1"]);
  });

  it("live: after the run's card", () => {
    const list = rows({
      entries: [user("u1", 0), tool("w1", "t1", 1), request("e1", 2)],
      live: "t1",
    });
    expect(shape(list).at(-1)).toBe("vault-request:vault-request:op:e1");
  });

  it.each([
    { name: "a set", over: { action: "set" as const } },
    { name: "a key already in the vault", over: { alreadySet: true } },
    { name: "a request zcp refused", over: { phase: "failed" as const } },
  ])("asks nothing for $name", ({ over }) => {
    const list = rows({
      entries: [user("u1", 0), request("e1", 2, over), assistant("a1", "t1", 3)],
      settled: "t1",
    });
    expect(list.some((row) => row.kind === "vault-request")).toBe(false);
  });
});

describe("an engine run whose work the account does not hold yet", () => {
  const scene = (unheldWork?: ReadonlyArray<string>): Scene => ({
    entries: [user("u1", 0, "Bring it up"), assistant("a1", "t1", 30, "All up.")],
    settled: "t1",
    ...(unheldWork === undefined ? {} : { unheldWork }),
  });

  it("still draws its card: the worked line, its work behind Show work, its answer under it", () => {
    expect(recordOf(rows(scene(["t1"])))).toMatchObject({ kind: "record", items: [] });
    expect(statusOf(rows(scene(["t1"])))).toMatchObject({ worked: true });
    // An outcome its worked line's effort is counted onto from the run's summary.
    expect(recordOf(rows(scene(["t1"])))?.outcome).toMatchObject({
      activity: [{ kind: "command", count: 1 }],
    });
  });

  it("draws an answer alone when its run did nothing else", () => {
    expect(recordOf(rows(scene()))).toBeNull();
  });
});

it("accepted work cut before the first provider handshake has a recovery card, then a quiet continuation record", () => {
  const interruption = {
    turnId: null,
    messageId: MessageId.make("accepted"),
    restart: { cause: "restarted" as const, at: at(9) },
    continuation: "manual" as const,
  };
  const cut: TimelineEntry = {
    id: "restart",
    kind: "work",
    createdAt: at(9),
    entry: {
      id: "restart",
      createdAt: at(9),
      label: "Interrupted",
      tone: "info",
      sourceActivityKind: "runtime.interrupted",
      turnId: null,
      interruption,
    },
  };
  const entries = [user("accepted", 0, "Inspect the service"), cut];
  const pending = framed({ entries }).find((row) => row.kind === "record");
  expect(pending?.kind).toBe("record");
  if (pending?.kind !== "record") return;
  expect(pending.status?.interruption).toEqual(interruption);
  const accepted: TimelineEntry = {
    ...cut,
    entry: { ...cut.entry, interruption: { ...interruption, continuation: "requested" } },
  };
  const continued = framed({ entries: [entries[0]!, accepted, user("continue", 10)] }).find(
    (row) => row.kind === "record",
  );
  expect(continued?.kind).toBe("record");
  if (continued?.kind !== "record") return;
  expect(continued.status?.interruption?.continuation).toBe("requested");
});
