import { projectLimitEntry } from "@t3tools/client-runtime/data";
import { CREW_CARD_OPENER } from "@t3tools/shared/userAsk";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import type { TurnDiffSummary } from "../../types";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  browserCheckCaption,
  browserCheckFailure,
  browserCheckShape,
  checksStrip,
  browserTakeState,
  deriveConversationStructure,
  deriveOutcome,
  formatWorkDuration,
  LAST_WORDS_GRACE_MS,
  latestFinishedWordsAt,
  messageReceipt,
  namedToolCall,
  incidentsStanding,
  operationLineWords,
  operationUnreturnedWords,
  standingIncidents,
  splitStandup,
  readCrewCard,
  readSlashCommand,
  readsAsAnswer,
  splitBatchDeploy,
  toolCallWords,
  stretchFace,
  stretchIncidents,
  stretchOperations,
  activityCounts,
} from "./conversation.logic";
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

function structure(
  entries: TimelineEntry[],
  options: {
    live?: string;
    latest?: { id: string; state: string; completed: boolean };
    working?: boolean;
    nowMs?: number;
    /** The task ids of the helpers still at work. */
    helpersAtWork?: ReadonlyArray<string>;
  } = {},
) {
  const latestTurn = options.latest
    ? {
        turnId: turn(options.latest.id),
        state: options.latest.state,
        startedAt: at(0),
        completedAt: options.latest.completed ? at(59) : null,
      }
    : null;
  return deriveConversationStructure({
    timelineEntries: entries,
    latestTurn,
    runningTurnId: options.live ? turn(options.live) : null,
    isWorking: options.working ?? options.live !== undefined,
    activeTurnStartedAt: options.live ? at(0) : null,
    ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    ...(options.helpersAtWork === undefined
      ? {}
      : { helperWorks: (taskId: string) => options.helpersAtWork!.includes(taskId) }),
  });
}

/** A day, in the fixtures' minutes. */
const DAY = 24 * 60;

/** What the server says outside any run: a start that failed, a Stop that found nothing to stop. */
function serverSaid(
  id: string,
  minute: number,
  kind: "provider.turn.start.failed" | "provider.turn.interrupt.failed",
): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: at(minute),
    entry: {
      id,
      createdAt: at(minute),
      turnId: null,
      label: kind === "provider.turn.start.failed" ? "Provider turn start failed" : "Stop failed",
      tone: "error",
      sourceActivityKind: kind,
    },
  };
}

/** The Mate looking at a picture — a screenshot it took of its own app — as its runtime reports it. */
function look(
  id: string,
  turnId: string,
  minute: number,
  path: string,
  overrides: Partial<WorkLogEntry> = {},
): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: at(minute),
    entry: {
      id,
      createdAt: at(minute),
      turnId: turn(turnId),
      label: "Image view",
      tone: "tool",
      itemType: "image_view",
      viewedImagePath: path,
      toolCallId: `call-${id}`,
      toolLifecycleStatus: "completed",
      sourceActivityKind: "tool.completed",
      ...overrides,
    },
  };
}

describe("formatWorkDuration", () => {
  it.each([
    [0, "1s"],
    [400, "1s"],
    [42_000, "42s"],
    [59_999, "59s"],
    [60_000, "1m"],
    [72_000, "1m 12s"],
    [9 * 60_000 + 59_000, "9m 59s"],
    [10 * 60_000 + 30_000, "10m"],
    [13 * 60_000, "13m"],
    [60 * 60_000, "1h"],
    [126 * 60_000, "2h 6m"],
    [25 * 60 * 60_000, "1d 1h"],
    [Number.NaN, "1s"],
  ])("%d ms reads %s", (ms, expected) => {
    expect(formatWorkDuration(ms)).toBe(expected);
  });
});

describe("readSlashCommand", () => {
  it.each([
    ["/compact", { name: "compact", args: "" }],
    ["  /model opus  ", { name: "model", args: "opus" }],
    ["/Review:pr 12", { name: "review:pr", args: "12" }],
    ["compact", null],
    ["/ not a command", null],
    ["see /etc/hosts", null],
    ["/usr/bin is a path?", null],
  ])("%j", (text, expected) => {
    expect(readSlashCommand(text)).toEqual(expected);
  });
});

describe("readCrewCard", () => {
  it.each([
    [
      "a card: its first line titles it, the rest is its text",
      `${CREW_CARD_OPENER}\n#12 Camera rig · from you\nDone when: the camera follows the player\n\`npm test\` passes`,
      {
        title: "#12 Camera rig · from you",
        text: "Done when: the camera follows the player\n`npm test` passes",
      },
    ],
    [
      "a card with only a title",
      `  ${CREW_CARD_OPENER}\n\n#13 Score board\n`,
      { title: "#13 Score board", text: "" },
    ],
    ["the person's words", "Add the camera rig", null],
    ["words that quote the opener", `see ${CREW_CARD_OPENER}`, null],
  ])("%s", (_, text, expected) => {
    expect(readCrewCard(text)).toEqual(expected);
  });
});

describe("readUsageLimitNotice", () => {
  it.each([
    [
      "You've hit your session limit · resets 9:20pm (UTC)",
      at(48),
      new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    ],
    [
      "You've hit your session limit · resets 12:30am (UTC)",
      at(48),
      new Date(Date.UTC(2026, 8, 25, 0, 30)).toISOString(),
    ],
    // A weekly refusal without a date cannot name its reset day.
    ["You’ve hit your weekly limit · resets 4:10pm (UTC)", at(48), null],
    [
      "You've hit your session limit · resets 11pm (Europe/Prague)",
      at(48),
      new Date(Date.UTC(2026, 8, 24, 21, 0)).toISOString(),
    ],
    [
      "Claude usage limit reached. This turn is paused until the 5-hour limit resets in 32m.",
      at(48),
      new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    ],
    [
      "Claude usage limit reached. This turn is paused until the limit resets in 1h 5m.",
      at(0),
      new Date(Date.UTC(2026, 8, 24, 21, 5)).toISOString(),
    ],
    ["Claude AI usage limit reached|1790283600", at(0), new Date(1790283600 * 1000).toISOString()],
    ["You've hit your session limit", at(0), null],
  ])("%j", (text, createdAt, resetsAt) => {
    expect(
      projectLimitEntry({
        kind: "message",
        createdAt,
        message: { role: "assistant", text, createdAt },
      }),
    ).toMatchObject({ resetsAt });
  });

  it("does not read a narration that mentions a limit", () => {
    expect(
      projectLimitEntry({
        kind: "message",
        createdAt: at(0),
        message: {
          role: "assistant",
          createdAt: at(0),
          text: "All three agents stopped on the session limit. I'm resuming each with its existing context, and checking what they'd already written so no work is lost — the rest of the plan stays as it was.",
        },
      }),
    ).toBeNull();
    expect(
      projectLimitEntry({
        kind: "message",
        createdAt: at(0),
        message: { role: "assistant", text: "Deployed to stage.", createdAt: at(0) },
      }),
    ).toBeNull();
  });
});

describe("readsAsAnswer", () => {
  // A note on the way is a sentence or three; an answer breaks into
  // paragraphs, lists, headings or tables early.
  it.each([
    { text: "Stage is built and PR #34 is open. Checking what changed.", answer: false },
    { text: "Yes, I know the one.\n\n**How it works** (desktop):", answer: true },
    { text: "Done:\n- the menu\n- the panel", answer: true },
    { text: "Done:\n1. the menu", answer: true },
    { text: "## What changed\nThe menu.", answer: true },
    { text: "| Page | Result |\n|---|---|", answer: true },
    { text: "x".repeat(481), answer: true },
    { text: "x".repeat(480), answer: false },
    { text: "  ", answer: false },
  ])("$text.length characters: $answer", ({ text, answer }) => {
    expect(readsAsAnswer(text)).toBe(answer);
  });
});

describe("deriveConversationStructure", () => {
  // D4 (run 11): the answer is decided when the run ends. A running turn's
  // words are the working row's, however much they read as an answer: under
  // a live card an answer streamed "below while still writing", then turned
  // back into a note when a question followed.
  it.each([
    {
      case: "a note on the way",
      entries: [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, "Deploying now.")],
      answer: undefined,
    },
    {
      case: "words that read as the answer, nothing after them",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
      ],
      answer: undefined,
    },
    {
      case: "words that read as an answer, then more work: a note after all",
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 1, "Plan:\n- the menu\n- the panel"),
        tool("w1", "t1", 2),
      ],
      answer: undefined,
    },
    {
      case: "the answer while the Mate still thinks after it",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "It is live.\n\n**What changed**"),
        reasoning("r1", "t1", 3),
      ],
      answer: undefined,
    },
  ])("a running turn: $case", ({ entries, answer }) => {
    const [only] = structure(entries, { live: "t1" }).turns;
    expect(only!.live).toBe(true);
    expect(only!.answer?.id).toBe(answer);
  });

  it("reads a settled turn as one stretch, its last message the answer", () => {
    const entries = [
      user("m0", 0),
      reasoning("r1", "t1", 1),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2, "Building now."),
      tool("w2", "t1", 3),
      assistant("a2", "t1", 4, "Done: the shop is live."),
    ];
    const result = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    });
    expect(result.turns).toHaveLength(1);
    const [only] = result.turns;
    expect(only!.stretches).toHaveLength(1);
    expect(only!.answer?.id).toBe("a2");
    expect(only!.live).toBe(false);
    expect(only!.stretches[0]).toMatchObject({
      key: "msg:m0",
      aside: false,
      live: false,
      last: true,
      startedAt: at(0),
    });
  });

  it("starts a stretch at every message sent into the turn", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2),
      user("m1", 3, "btw make the missions interesting"),
      tool("w2", "t1", 4),
      user("m2", 5, "and the intro screen"),
      assistant("a2", "t1", 6),
      assistant("a3", "t1", 8, "Everything is in."),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(
      only!.stretches.map((stretch) => [
        stretch.key,
        stretch.aside,
        stretch.entries.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["msg:m0", false, ["w1", "a1"]],
      ["msg:m1", true, ["w2"]],
      ["msg:m2", true, ["a2", "a3"]],
    ]);
    // A stretch cut by a message ends where the message was sent.
    expect(only!.stretches[0]!.endedAt).toBe(at(3));
    expect(only!.stretches[1]!.endedAt).toBe(at(5));
    expect(only!.answer?.id).toBe("a3");
  });

  it("keeps the running turn's last stretch live and names no answer yet", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2, "Checking the build."),
      user("m1", 3),
      assistant("a2", "t1", 4, "Still going.", { streaming: true }),
    ];
    const [only] = structure(entries, { live: "t1" }).turns;
    expect(only!.live).toBe(true);
    expect(only!.answer).toBeNull();
    expect(only!.stretches.map((stretch) => stretch.live)).toEqual([false, true]);
    expect(only!.stretches[1]!.endedAt).toBeNull();
  });

  it("gives messages sent back to back a stretch each, the empty one included", () => {
    const entries = [user("m1", 0), user("m2", 1), tool("w1", "t1", 2), assistant("a1", "t1", 3)];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.stretches.map((stretch) => [stretch.key, stretch.entries.length])).toEqual([
      ["msg:m1", 0],
      ["msg:m2", 2],
    ]);
  });

  // Juno, 2026-09-30: a message stopped before its run began stood unclaimed
  // overnight; the run the person's next message started took it for its
  // opener, so its clock counted from the day before ("Thinking 17:42:08")
  // and the new message read as sent into that run, not read yet. A run is
  // opened by the message that started it: one sent before a silence, or
  // before the server said its start failed, had its own moment.
  it.each([
    {
      name: "a day later, the next message's run thinking",
      entries: [user("m0", 0), user("m1", DAY), reasoning("r1", "t2", DAY + 1)],
      options: { live: "t2" },
      expected: { turns: [["msg:m1", ["msg:m1"], at(DAY)]], loose: [0] },
    },
    {
      name: "a day later, the next message's run named but silent",
      entries: [user("m0", 0), user("m1", DAY)],
      options: { live: "t2" },
      expected: { turns: [["msg:m1", ["msg:m1"], at(DAY)]], loose: [0] },
    },
    {
      name: "a day later, before the server names the next message's run",
      entries: [user("m0", 0), user("m1", DAY)],
      options: { working: true },
      expected: { turns: [["msg:m1", ["msg:m1"], at(DAY)]], loose: [0] },
    },
    {
      name: "a day later, the next message's run settled",
      entries: [
        user("m0", 0),
        user("m1", DAY),
        reasoning("r1", "t2", DAY + 1),
        assistant("a1", "t2", DAY + 2, "Both have it."),
      ],
      options: { latest: { id: "t2", state: "completed", completed: true } },
      expected: { turns: [["msg:m1", ["msg:m1"], at(DAY)]], loose: [0] },
    },
    {
      name: "a start that failed, the message sent again at once",
      entries: [
        user("m0", 0),
        serverSaid("f1", 0, "provider.turn.start.failed"),
        user("m1", 1),
        reasoning("r1", "t2", 1),
      ],
      options: { live: "t2" },
      expected: { turns: [["msg:m1", ["msg:m1"], at(1)]], loose: [0, 1] },
    },
    {
      name: "a Stop that found nothing to stop, the message sent again at once",
      entries: [
        user("m0", 0),
        serverSaid("f1", 0, "provider.turn.interrupt.failed"),
        user("m1", 1),
        reasoning("r1", "t2", 1),
      ],
      options: { live: "t2" },
      expected: { turns: [["msg:m1", ["msg:m1"], at(1)]], loose: [0, 1] },
    },
    {
      // What the rule must keep: a message sent into a run that has not said
      // anything yet is the run's, whoever opened it.
      name: "a message sent a minute into a run that has not said anything yet",
      entries: [user("m0", 0), user("m1", 1), reasoning("r1", "t1", 2)],
      options: { live: "t1" },
      expected: { turns: [["msg:m0", ["msg:m0", "msg:m1"], at(0)]], loose: [] },
    },
  ])("a message whose run never came: $name", ({ entries, options, expected }) => {
    const result = structure(entries, options);
    expect({
      turns: result.turns.map((candidate) => [
        candidate.key,
        candidate.stretches.map((stretch) => stretch.key),
        candidate.stretches[0]!.startedAt,
      ]),
      loose: [...result.looseIndexes],
    }).toEqual(expected);
  });

  it("holds a live stretch for a message the server has not opened a turn for yet", () => {
    const entries = [user("m0", 0)];
    const result = structure(entries, { working: true });
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]!.stretches).toEqual([
      expect.objectContaining({ key: "msg:m0", live: true, turnId: null }),
    ]);
  });

  it("keeps a turn live whose words arrive before the session names it", () => {
    // A finished background task wakes the Mate: the thread works, the
    // session names no running turn yet and the latest turn is the one that
    // finished — but the new turn's first words already carry its id.
    const result = structure(
      [
        user("m0", 0),
        assistant("a1", "t1", 1, "Started it."),
        assistant("a2", "t2", 70, "It printed done."),
      ],
      { latest: { id: "t1", state: "completed", completed: true }, working: true },
    );
    // The run before it launched no helper: it is a run of its own.
    const last = result.turns.at(-1)!;
    expect(last).toMatchObject({ turnId: turn("t2"), live: true, answer: null });
    expect(result.turns[0]).toMatchObject({ live: false });

    // Working right after the person wrote is their message's turn, never the
    // one that finished before it.
    const sent = structure([user("m0", 0), assistant("a1", "t1", 1, "Done."), user("m1", 70)], {
      latest: { id: "t0", state: "completed", completed: true },
      working: true,
    });
    expect(sent.turns.find((candidate) => candidate.turnId === turn("t1"))).toMatchObject({
      live: false,
    });
  });

  it("reads a turn a usage limit refused as limit-only, with its reset", () => {
    const entries = [
      user("m0", 0),
      assistant("a1", "t1", 48, "You've hit your session limit · resets 9:20pm (UTC)"),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.limitOnly).toBe(true);
    expect(only!.limit).toMatchObject({
      resetsAt: new Date(Date.UTC(2026, 8, 24, 21, 20)).toISOString(),
    });
  });

  it("does not call a turn that worked and then hit the limit limit-only", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 48, "You've hit your session limit · resets 9:20pm (UTC)"),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.limitOnly).toBe(false);
    expect(only!.limit).not.toBeNull();
  });

  it("marks the latest turn the person stopped", () => {
    const entries = [user("m0", 0), tool("w1", "t1", 1)];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "interrupted", completed: true },
    }).turns;
    expect(only!.interrupted).toBe(true);
  });

  // Words that cannot be placed yet are drawn nowhere: a note if the Mate
  // moves on, the answer if the run ends. Streamed in the panel first, every
  // answer jumped under the card at its first paragraph break, a median 133
  // characters in on the recorded threads.
  it.each([
    {
      name: "a line it is still writing",
      tail: [assistant("a1", "t1", 1, "Checking the routes.", { streaming: true })],
      writing: "a1",
      answer: null,
    },
    // An engine Mate's note opens before its first word, which the live text
    // holds (`useEngineLiveMessage`): it is words on their way all the same.
    {
      name: "a line whose first words have not reached its record",
      tail: [assistant("thread-ada/r/1/i/2", "t1", 1, "", { streaming: true })],
      writing: "thread-ada/r/1/i/2",
      answer: null,
    },
    // V1 streams token by token: a first delta of only whitespace is no words yet, as it was
    // before the engine's rule (which holds for an engine Mate's item alone).
    {
      name: "a V1 line whose first delta is only whitespace",
      tail: [assistant("a1", "t1", 1, " ", { streaming: true })],
      writing: null,
      answer: null,
    },
    // Done streaming, a line is a note: Codex says nothing of a command until
    // it completes, so waiting for a step after the words hid them for the
    // whole command.
    {
      name: "a line it finished writing",
      tail: [assistant("a1", "t1", 1, "Running the build now; it takes a while.")],
      writing: null,
      answer: null,
    },
    // A background task reporting in is not the Mate moving on.
    {
      name: "a line it is writing as a task reports in",
      tail: [
        assistant("a1", "t1", 1, "Checking the routes.", { streaming: true }),
        tool("t9", "t1", 2, {
          tone: "info",
          sourceActivityKind: "task.progress",
          taskId: "task-9",
        }),
      ],
      writing: "a1",
      answer: null,
    },
    {
      name: "an answer streaming as a task reports in",
      tail: [
        assistant("a1", "t1", 1, "Done.\n\nThe routes are:", { streaming: true }),
        tool("t9", "t1", 2, {
          tone: "info",
          sourceActivityKind: "task.completed",
          taskId: "task-9",
        }),
      ],
      // D4: the working row's while the run goes on.
      writing: "a1",
      answer: null,
    },
    {
      name: "words that read as its answer",
      tail: [assistant("a1", "t1", 1, "Done.\n\nThe routes are:")],
      writing: null,
      answer: null,
    },
    {
      name: "a line it moved on from",
      tail: [assistant("a1", "t1", 1, "Checking the routes."), tool("w1", "t1", 2)],
      writing: null,
      answer: null,
    },
    {
      name: "a line it went on thinking after",
      tail: [assistant("a1", "t1", 1, "Checking the routes."), reasoning("r1", "t1", 2)],
      writing: null,
      answer: null,
    },
  ])("holds $name until it is known", ({ tail, writing, answer }) => {
    const [only] = structure([user("m0", 0), ...tail], { live: "t1" }).turns;
    expect(only!.writing?.id ?? null).toBe(writing);
    expect(only!.answer?.id ?? null).toBe(answer);
  });

  it("holds nothing once the run has ended", () => {
    const [only] = structure([user("m0", 0), assistant("a1", "t1", 1, "Checking the routes.")], {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(only!.writing).toBeNull();
    expect(only!.answer?.id).toBe("a1");
  });

  const plan = (id: string, turnId: string, minute: number): TimelineEntry => ({
    id,
    kind: "proposed-plan",
    createdAt: at(minute),
    proposedPlan: {
      id: id as Extract<TimelineEntry, { kind: "proposed-plan" }>["proposedPlan"]["id"],
      turnId: turn(turnId),
      planMarkdown: "1. Add the route.",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: at(minute),
      updatedAt: at(minute),
    },
  });
  // Only the latest turn carries the server's word on how it ended: a stopped
  // turn read "stopped after 40s" until the next one began, then "worked for
  // 40s" (Nova, 2026-09-26). A turn that ended on a step, not a word, was
  // cut off — whichever turn is the latest.
  it.each([
    { name: "on a step", tail: [tool("w1", "t1", 1)], interrupted: true },
    {
      name: "on a thought",
      tail: [tool("w1", "t1", 1), reasoning("r1", "t1", 2)],
      interrupted: true,
    },
    {
      name: "on a word after its last step",
      tail: [tool("w1", "t1", 1), assistant("a1", "t1", 2, "Done.")],
      interrupted: false,
    },
    {
      name: "on a step after its words",
      tail: [assistant("a1", "t1", 1, "Checking."), tool("w1", "t1", 2)],
      interrupted: true,
    },
    {
      name: "on an error",
      tail: [tool("w1", "t1", 1, { tone: "error", label: "Runtime error" })],
      interrupted: false,
    },
    // A plan the Mate proposes ends its turn by design; a compaction is the
    // harness condensing the context, a /compact's whole turn.
    {
      name: "on a plan it proposed",
      tail: [tool("w1", "t1", 1), plan("p1", "t1", 2)],
      interrupted: false,
    },
    // Codex's question to the person is an info row after its words; a
    // warning the runtime wrote after a stop is none of the Mate's steps.
    {
      name: "on a question it asked the person",
      tail: [
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Which accent: green or blue?"),
        tool("q1", "t1", 3, {
          tone: "info",
          label: "User input requested",
          command: undefined as never,
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          sourceActivityKind: "user-input.requested",
        }),
      ],
      interrupted: false,
    },
    {
      name: "on a step, then a warning",
      tail: [
        tool("w1", "t1", 1),
        tool("x1", "t1", 2, {
          tone: "info",
          label: "Turn interrupted",
          command: undefined as never,
          toolCallId: undefined as never,
          toolLifecycleStatus: undefined as never,
          sourceActivityKind: "runtime.warning",
        }),
      ],
      interrupted: true,
    },
    {
      name: "on a compaction",
      tail: [
        tool("c1", "t1", 1, {
          tone: "info",
          label: "Compacted context",
          sourceActivityKind: "context-compaction",
        }),
      ],
      interrupted: false,
    },
  ])(
    "tells a turn that ended $name as stopped or not, before the next one",
    ({ tail, interrupted }) => {
      const entries = [user("m0", 0), ...tail, user("m1", 10), assistant("a2", "t2", 11, "Hi.")];
      const [first] = structure(entries, {
        latest: { id: "t2", state: "completed", completed: true },
      }).turns;
      expect(first!.interrupted).toBe(interrupted);
    },
  );

  // Completion is a reported outcome, even before its answer arrives.
  // Clock position and missing words cannot turn it into live or stopped work.
  it.each([
    {
      name: "just settled, its words not yet in",
      now: Date.parse(at(59)) + 500,
      words: false,
      live: false,
    },
    { name: "its words in", now: Date.parse(at(59)) + 500, words: true, live: false },
    {
      name: "later, still no words",
      now: Date.parse(at(59)) + LAST_WORDS_GRACE_MS + 1,
      words: false,
      live: false,
    },
    // A plan it proposed ends its turn by design: nothing more is coming.
    {
      name: "ended on a plan it proposed",
      now: Date.parse(at(59)) + 500,
      words: "plan",
      live: false,
    },
  ] as const)(
    "shows a reported completion without inferring a stop: $name",
    ({ now, words, live }) => {
      const entries = [
        user("m0", 0),
        tool("w1", "t1", 1),
        reasoning("r1", "t1", 2),
        ...(words === true ? [assistant("a1", "t1", 58, "Done.")] : []),
        ...(words === "plan" ? [plan("p1", "t1", 58)] : []),
      ];
      const [first] = structure(entries, {
        latest: { id: "t1", state: "completed", completed: true },
        nowMs: now,
      }).turns;
      expect(first!.live).toBe(live);
      expect(first!.interrupted).toBe(false);
    },
  );

  // A turn's span ends where its entries did — the same while it is the
  // latest and once another followed; "worked for 1m 16s" read "1m 20s" once
  // the next turn began, "1m 13s" read "1m 12s".
  it("ends a settled turn where its entries did, the latest or not", () => {
    const first = [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 3, "Done.")];
    const alone = structure(first, { latest: { id: "t1", state: "completed", completed: true } });
    const followed = structure([...first, user("m1", 30), assistant("a2", "t2", 31, "Hi.")], {
      latest: { id: "t2", state: "completed", completed: true },
    });
    expect(alone.turns[0]!.stretches.at(-1)!.endedAt).toBe(
      followed.turns[0]!.stretches.at(-1)!.endedAt,
    );
  });

  // A helper the Mate left working reports in as its turn's entries: its
  // progress and its finish are the helper's time, not the Mate's. "Nova
  // worked for 21s" read "1m 44s", then "2m 19s", while only the helper
  // worked on (Nova, 2026-09-26).
  it("ends a settled turn at the Mate's own last entry, not at a helper's report", () => {
    const mine = [
      user("m0", 0),
      tool("w1", "t1", 1),
      assistant("a1", "t1", 2, "The review runs in the background."),
    ];
    const helper = [
      tool("h1", "t1", 9, { sourceActivityKind: "task.progress", taskId: "task-h", tone: "info" }),
      tool("h2", "t1", 12, {
        sourceActivityKind: "task.completed",
        taskId: "task-h",
        tone: "info",
      }),
    ];
    const settled = { latest: { id: "t1", state: "completed", completed: true } };
    const alone = structure(mine, settled).turns[0]!;
    const reported = structure([...mine, ...helper], settled).turns[0]!;
    expect(reported.stretches.at(-1)!.endedAt).toBe(alone.stretches.at(-1)!.endedAt);
  });

  it("leaves a message no turn took loose, and places a landing inside the turn it fell in", () => {
    const entries = [
      user("m0", 0),
      tool("w1", "t1", 1),
      landed("l1", 2),
      assistant("a1", "t1", 3),
      user("m1", 10),
    ];
    const result = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    });
    expect([...result.looseIndexes]).toEqual([4]);
    expect(result.stretchByIndex.get(2)?.key).toBe("msg:m0");
  });
});

// Words that just finished, with nothing after them, wait a moment before
// they are placed: the turn nearly always settles within it, so a short
// answer goes straight under the card instead of popping into the panel as a
// note and moving (13 of 56 recorded answers did).
describe("the live turn's last words", () => {
  const words = (streaming: boolean) => assistant("a1", "t1", 2, "Done.", { streaming });
  it.each([
    { name: "still streaming", tail: [words(true)], nowMs: undefined, held: true },
    { name: "just finished", tail: [words(false)], nowMs: Date.parse(at(2, 2)), held: true },
    {
      name: "finished a while ago",
      tail: [words(false)],
      nowMs: Date.parse(at(2, 5)),
      held: false,
    },
    {
      name: "a step after them",
      tail: [words(false), tool("w2", "t1", 2)],
      nowMs: Date.parse(at(2, 2)),
      held: false,
    },
    { name: "no clock to tell", tail: [words(false)], nowMs: undefined, held: false },
  ])("$name: held $held", ({ tail, nowMs, held }) => {
    const result = structure([user("m0", 0), tool("w1", "t1", 1), ...tail], {
      live: "t1",
      ...(nowMs === undefined ? {} : { nowMs }),
    });
    expect(result.turns.at(-1)?.writing?.id ?? null).toBe(held ? "a1" : null);
  });
});

describe("latestFinishedWordsAt", () => {
  // When the newest wait for a running turn's last words runs out: the page
  // derives again then.
  it.each([
    {
      name: "a finished last word while working",
      entries: [user("m0", 0), assistant("a1", "t1", 2, "Done.")],
      working: true,
      at: Date.parse(at(2, 1)),
    },
    {
      name: "still streaming",
      entries: [user("m0", 0), assistant("a1", "t1", 2, "Do", { streaming: true })],
      working: true,
      at: null,
    },
    {
      name: "a step after the words",
      entries: [user("m0", 0), assistant("a1", "t1", 2, "Done."), tool("w1", "t1", 3)],
      working: true,
      at: null,
    },
    {
      name: "not working",
      entries: [user("m0", 0), assistant("a1", "t1", 2, "Done.")],
      working: false,
      at: null,
    },
    // What the held words look past, this looks past too: a plan update, an
    // empty thought or the person's message after the words left the wait
    // with no clock to end it, and the words hidden until the next step.
    {
      name: "a plan update after the words",
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 2, "Done."),
        {
          id: "p1",
          kind: "turn-plan",
          createdAt: at(2, 2),
          turnPlan: { id: "p1", createdAt: at(2, 2), turnId: turn("t1"), plan: [] },
        } as unknown as TimelineEntry,
      ],
      working: true,
      at: Date.parse(at(2, 1)),
    },
    {
      name: "an empty thought after the words",
      entries: [
        user("m0", 0),
        assistant("a1", "t1", 2, "Done."),
        assistant("r9", "t1", 2, "  ", { second: 2 }),
      ],
      working: true,
      at: Date.parse(at(2, 1)),
    },
    {
      name: "the person's message after the words",
      entries: [user("m0", 0), assistant("a1", "t1", 2, "Done."), user("m1", 3)],
      working: true,
      at: Date.parse(at(2, 1)),
    },
  ])("$name", ({ entries, working, at: expected }) => {
    expect(latestFinishedWordsAt(entries, working)).toBe(expected);
  });
});

describe("messageReceipt", () => {
  it.each([
    {
      // Juno, 2026-09-27: minutes of thinking under the message that began
      // the run, and the message said "Not read yet".
      name: "the message that began a run the Mate is still thinking over",
      entries: [user("m0", 0)],
      options: { live: "t1" },
      expected: [["m0", "seen"]],
    },
    {
      name: "a message the server has not begun a run for",
      entries: [user("m0", 0)],
      options: { working: true },
      expected: [["m0", "sent"]],
    },
    {
      name: "a message sent into a run before its first step",
      entries: [user("m0", 0), user("m1", 1)],
      options: { live: "t1" },
      expected: [
        ["m0", "seen"],
        ["m1", "sent"],
      ],
    },
    {
      name: "a message sent into a run before its next step",
      entries: [user("m0", 0), tool("w1", "t1", 1), user("m1", 2)],
      options: { live: "t1" },
      expected: [
        ["m0", "seen"],
        ["m1", "sent"],
      ],
    },
    {
      name: "a message sent into a run after its next step",
      entries: [user("m0", 0), tool("w1", "t1", 1), user("m1", 2), tool("w2", "t1", 3)],
      options: { live: "t1" },
      expected: [
        ["m0", "seen"],
        ["m1", "seen"],
      ],
    },
    {
      name: "a message no run claimed",
      entries: [user("m0", 0)],
      options: {},
      expected: [["m0", "sent"]],
    },
    {
      // Juno, 2026-09-30: the clock stood beside the new message while its
      // own run thought over it, and "Not read yet" on the one before would
      // promise a next step that never comes.
      name: "a message whose run never came, once the next one's run thinks",
      entries: [user("m0", 0), user("m1", DAY), reasoning("r1", "t2", DAY + 1)],
      options: { live: "t2" },
      expected: [
        ["m0", null],
        ["m1", "seen"],
      ],
    },
    {
      name: "a message whose run never came, while the next one waits for its run",
      entries: [user("m0", 0), user("m1", DAY)],
      options: { working: true },
      expected: [
        ["m0", null],
        ["m1", "sent"],
      ],
    },
  ])("$name", ({ entries, options, expected }) => {
    const result = structure(entries, options);
    expect(
      entries.flatMap((entry, index) =>
        entry.kind === "message" && entry.message.role === "user"
          ? [[entry.message.id, messageReceipt(entry.message, result, index)]]
          : [],
      ),
    ).toEqual(expected);
  });
});

describe("activityCounts", () => {
  const entry = (overrides: Parameters<typeof tool>[3], noCommand = false) => {
    const { command: _command, ...rest } = (
      tool("x", "t1", 0, overrides) as Extract<TimelineEntry, { kind: "work" }>
    ).entry;
    return noCommand ? rest : { ...rest, command: "pnpm test" };
  };

  // What the calls came to, counted by kind in one fixed order: the effort
  // the worked line says ("2 commands · 1 file read"), never a result row.
  it.each([
    {
      name: "files edited count once each, then commands, reads and other tools",
      calls: [
        entry({ requestKind: "file-read" }, true),
        entry({}),
        entry({ changedFiles: ["a.ts", "b.ts"] }, true),
        entry({ changedFiles: ["a.ts"] }, true),
        entry({ itemType: "mcp_tool_call" }, true),
        entry({ requestKind: "file-read" }, true),
      ],
      counts: [
        { kind: "edit", count: 2 },
        { kind: "command", count: 1 },
        { kind: "read", count: 2 },
        { kind: "tool", count: 1 },
      ],
    },
    {
      name: "the code and the web searched",
      calls: [
        entry(
          { label: "Tool call", itemType: "dynamic_tool_call", detail: 'Grep: {"pattern":"x"}' },
          true,
        ),
        entry({ itemType: "web_search", toolTitle: "Web search" }, true),
        entry({ itemType: "web_search", toolTitle: "Web search" }, true),
      ],
      counts: [
        { kind: "code-search", count: 1 },
        { kind: "search", count: 2 },
      ],
    },
    {
      name: "a Zerops tool by what it did, any other tool as a tool",
      calls: [
        entry({ label: "zerops_workflow", toolTitle: "Workflow", itemType: "mcp_tool_call" }, true),
        entry({ label: "zerops_workflow", toolTitle: "Workflow", itemType: "mcp_tool_call" }, true),
        entry(
          { label: "zerops_knowledge", toolTitle: "Knowledge", itemType: "mcp_tool_call" },
          true,
        ),
        entry({ label: "figma_get", toolTitle: "Figma", itemType: "mcp_tool_call" }, true),
      ],
      counts: [
        { kind: "workflow", count: 2 },
        { kind: "guides", count: 1 },
        { kind: "tool", count: 1 },
      ],
    },
    {
      name: "an ACP agent's calls, named by their kind",
      calls: [
        entry({ label: "Read file", itemType: "dynamic_tool_call", toolName: "read" }, true),
        entry({ label: "Searched files", itemType: "web_search", toolName: "search" }, true),
        entry({ label: "Searched files", itemType: "web_search", toolName: "fetch" }, true),
        ...[1, 2, 3, 4, 5].map(() =>
          entry(
            {
              label: "Changed files",
              itemType: "file_change",
              toolName: "edit",
              changedFiles: ["/app/src/app.ts"],
            },
            true,
          ),
        ),
      ],
      counts: [
        { kind: "edit", count: 1 },
        { kind: "read", count: 1 },
        { kind: "code-search", count: 1 },
        { kind: "fetch", count: 1 },
      ],
    },
    {
      name: "OpenCode's calls, by their names",
      calls: [
        entry({ label: "src/app.ts", itemType: "dynamic_tool_call", toolName: "read" }, true),
        entry({ label: "TODO", itemType: "dynamic_tool_call", toolName: "grep" }, true),
        entry({ label: "**/*.ts", itemType: "dynamic_tool_call", toolName: "glob" }, true),
        entry({ label: "src", itemType: "dynamic_tool_call", toolName: "list" }, true),
        entry({ label: "https://x.dev", itemType: "web_search", toolName: "webfetch" }, true),
        entry(
          { label: "zerops_workflow", itemType: "dynamic_tool_call", toolName: "zerops_workflow" },
          true,
        ),
      ],
      counts: [
        { kind: "read", count: 1 },
        { kind: "code-search", count: 3 },
        { kind: "fetch", count: 1 },
        { kind: "workflow", count: 1 },
      ],
    },
    // A name the effort has no word for says nothing: the call counts by
    // what it is, as its step reads it.
    {
      name: "Claude's own shell tools, by what they are",
      calls: [
        entry({ label: "Command run", itemType: "command_execution", toolName: "BashOutput" }),
        entry({ label: "Command run", itemType: "command_execution", toolName: "KillShell" }),
        entry({
          label: "File change",
          itemType: "file_change",
          toolName: "mcp__zerops__zerops_delete",
          changedFiles: ["zerops.yaml"],
        }),
      ],
      counts: [
        { kind: "edit", count: 1 },
        { kind: "command", count: 2 },
      ],
    },
    {
      name: "an MCP tool named as a native one, and a search of the web",
      calls: [
        entry(
          { label: "db_execute", itemType: "dynamic_tool_call", toolName: "mcp__db__execute" },
          true,
        ),
        entry(
          { label: "docs_read", itemType: "dynamic_tool_call", toolName: "mcp__docs__read" },
          true,
        ),
        entry({ label: "Searched files", itemType: "web_search", toolName: "websearch" }, true),
      ],
      counts: [
        { kind: "search", count: 1 },
        { kind: "tool", count: 2 },
      ],
    },
    { name: "nothing", calls: [], counts: [] },
  ])("$name", ({ calls, counts }) => {
    expect(activityCounts(calls)).toEqual(counts);
  });

  it("counts the helpers a run started, a batch by its helpers", () => {
    const spawn = (ids: string[]) =>
      (
        tool("s", "t1", 0, {
          label: "Review",
          agentSpawn: { workflowId: null, agentTaskIds: ids },
        }) as Extract<TimelineEntry, { kind: "work" }>
      ).entry;
    expect(activityCounts([], [spawn(["a", "b", "c"]), spawn([])])).toEqual([
      { kind: "helpers", count: 4 },
    ]);
    expect(activityCounts([], [spawn(["a"])])).toEqual([{ kind: "helpers", count: 1 }]);
    expect(activityCounts([], [])).toEqual([]);
  });
});

/** What the server records where an agent's process died under its turn (`runtime.error`). */
function crashed(
  id: string,
  turnId: string,
  minute: number,
  words: string,
  turnEnd?: WorkLogEntry["turnEnd"],
): TimelineEntry {
  return tool(id, turnId, minute, {
    ...(turnEnd === undefined ? {} : { turnEnd }),
    label: "Runtime error",
    tone: "error",
    detail: words,
    command: undefined as never,
    toolCallId: undefined as never,
    toolLifecycleStatus: undefined as never,
    sourceActivityKind: "runtime.error",
  });
}

/** A background task the crash took down with it, reporting in. */
function taskStopped(id: string, turnId: string, minute: number): TimelineEntry {
  return tool(id, turnId, minute, {
    label: "Task stopped",
    tone: "info",
    command: undefined as never,
    toolCallId: undefined as never,
    toolLifecycleStatus: undefined as never,
    sourceActivityKind: "task.completed",
  });
}

/** A failure the server notes in a turn that is not the turn breaking off. */
function serverNoted(
  id: string,
  turnId: string,
  minute: number,
  kind:
    | "checkpoint.capture.failed"
    | "provider.turn.interrupt.failed"
    | "provider.approval.respond.failed",
): TimelineEntry {
  return tool(id, turnId, minute, {
    label: "Checkpoint failed",
    tone: "error",
    detail: "No checkpoint for this workspace: it has untracked files.",
    command: undefined as never,
    toolCallId: undefined as never,
    toolLifecycleStatus: undefined as never,
    sourceActivityKind: kind,
  });
}

describe("a run that broke off", () => {
  const STOPPED = "Codex stopped unexpectedly. Send a message to pick up where it left off.";
  it.each([
    {
      name: "its agent died after its last words, a task stopping with it",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Restarting the dev server cleanly…"),
        tool("w2", "t1", 3),
        crashed("e1", "t1", 5, STOPPED),
        taskStopped("k1", "t1", 5),
      ],
      latest: { id: "t1", state: "error", completed: true },
      brokeOff: {
        entryId: "e1",
        reason: "Codex stopped unexpectedly.",
        next: "Send a message to pick up where it left off.",
      },
      answer: null,
      face: "brokeOff",
    },
    {
      name: "the same run once the next one began",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Restarting the dev server cleanly…"),
        crashed("e1", "t1", 5, STOPPED),
        user("m1", 10),
        assistant("a2", "t2", 11, "Picked it up."),
      ],
      latest: { id: "t2", state: "completed", completed: true },
      // Only the latest run says what to do next.
      brokeOff: { entryId: "e1", reason: "Codex stopped unexpectedly.", next: null },
      answer: null,
      face: "brokeOff",
    },
    {
      name: "its turn failed without a crash, in the turn's own words",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        crashed("e1", "t1", 2, "API Error: 500 Internal server error"),
      ],
      latest: { id: "t1", state: "error", completed: true },
      brokeOff: { entryId: "e1", reason: "API Error: 500 Internal server error", next: null },
      answer: null,
      face: "brokeOff",
    },
    ...(
      [
        "checkpoint.capture.failed",
        "provider.turn.interrupt.failed",
        "provider.approval.respond.failed",
      ] as const
    ).map((kind) => ({
      name: `a finished run the server noted ${kind} after`,
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "Done."),
        serverNoted("x1", "t1", 3, kind),
      ],
      latest: { id: "t1", state: "completed", completed: true } as const,
      brokeOff: null,
      answer: "a1",
      // An error it did not work past still marks the run's face; its line says it worked.
      face: "failed",
    })),
    {
      name: "an error it worked past",
      entries: [
        user("m0", 0),
        crashed("e1", "t1", 1, STOPPED),
        tool("w1", "t1", 2),
        assistant("a1", "t1", 3, "Done."),
      ],
      latest: { id: "t1", state: "completed", completed: true },
      brokeOff: null,
      answer: "a1",
      face: "idle",
    },
    {
      name: "a run the person stopped",
      entries: [user("m0", 0), tool("w1", "t1", 1)],
      latest: { id: "t1", state: "interrupted", completed: true },
      brokeOff: null,
      answer: null,
      face: "stopped",
    },
    {
      name: "a run the usage limit ended",
      entries: [
        user("m0", 0),
        tool("w1", "t1", 1),
        assistant("a1", "t1", 2, "You've hit your session limit · resets 9:20pm (UTC)"),
      ],
      latest: { id: "t1", state: "error", completed: true },
      brokeOff: null,
      answer: "a1",
      face: "idle",
    },
  ] as const)("$name", ({ entries, latest, brokeOff, answer, face }) => {
    const [first] = structure([...entries], { latest }).turns;
    expect(first!.brokeOff).toEqual(brokeOff);
    expect(first!.answer?.id ?? null).toBe(answer);
    expect(
      stretchFace({ stretch: first!.stretches.at(-1)!, turn: first!, pausedHere: false }),
    ).toBe(face);
  });

  // Every driver's usage limit is typed by the server: a pause, never a
  // break, whatever its words — the client reads none of them for it.
  it.each([
    ["codex", "Codex usage limit reached. Try again at 9:20 PM."],
    ["claudeAgent", "Claude usage limit reached. Send the message again once the limit resets."],
    ["opencode", "Rate limit exceeded: 429"],
    ["grok", "Grok usage limit reached. Try again later."],
  ])("reads %s's usage limit as a pause", (_driver, words) => {
    const [only] = structure(
      [user("m0", 0), tool("w1", "t1", 1), crashed("e1", "t1", 12, words, "usage-limit")],
      { latest: { id: "t1", state: "error", completed: true } },
    ).turns;
    expect(only!.brokeOff).toBeNull();
    expect(only!.limit).not.toBeNull();
  });

  it("is not over while it runs", () => {
    const [only] = structure([user("m0", 0), crashed("e1", "t1", 1, STOPPED)], {
      live: "t1",
    }).turns;
    expect(only!.brokeOff).toBeNull();
  });
});

describe("stretchFace", () => {
  const settled = { latest: { id: "t1", state: "completed", completed: true } } as const;
  it.each([
    [
      "produced",
      [user("m0", 0), operation("d1", "t1", 1, { kind: "deploy" }), assistant("a1", "t1", 5)],
    ],
    [
      "failed",
      [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        assistant("a1", "t1", 5),
      ],
    ],
    [
      "produced",
      [
        user("m0", 0),
        operation("d1", "t1", 1, { kind: "deploy", phase: "failed", statusWord: "Failed" }),
        operation("d2", "t1", 3, { kind: "deploy" }),
        assistant("a1", "t1", 5),
      ],
    ],
    ["idle", [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 5)]],
  ] as const)("%s", (face, entries) => {
    const [only] = structure([...entries], settled).turns;
    expect(stretchFace({ stretch: only!.stretches[0]!, turn: only!, pausedHere: false })).toBe(
      face,
    );
  });
});

describe("browser checks", () => {
  // A check's picture holds its shape from its first frame (the owner,
  // 2026-09-29, of a phone's screenshot cut into a 16:10 tile: "why these
  // has different ration than the result?"): its own size where zcp sent
  // it, else the viewport the check set, else its device's frame.
  it.each([
    {
      name: "its own size",
      check: { screenshot: { src: "data:image/png;base64,A", width: 1179, height: 2556 } },
      shape: 1179 / 2556,
    },
    {
      name: "the viewport it set, where the picture came without a size",
      check: {
        screenshot: { src: "data:image/png;base64,A" },
        viewport: { width: 1440, height: 900 },
      },
      shape: 1.6,
    },
    {
      name: "a phone's frame, where only its device is named",
      check: { deviceName: "iPhone 16" },
      shape: 0.45,
    },
    { name: "a tablet's frame", check: { deviceName: "iPad Pro" }, shape: 0.75 },
    { name: "a desktop's, where nothing is known", check: {}, shape: 1.6 },
  ])("shapes a check's picture by $name", ({ check, shape }) => {
    const entry = operation("b1", "t1", 1, {
      kind: "browser",
      subject: "https://a.dev/",
      ...check,
    }) as Extract<TimelineEntry, { kind: "operation" }>;
    expect(browserCheckShape(entry.operation)).toBeCloseTo(shape, 4);
  });

  it.each([
    ["https://shop.example.com/cz/products/%C5%A1umava?q=1.5&res=.5", "/cz/products/šumava"],
    ["https://shop.example.com/", "/"],
    ["shop.example.com/cart", "/cart"],
    ["the checkout page", "the checkout page"],
  ])("captions %j as %j", (subject, caption) => {
    const entry = operation("b1", "t1", 1, { kind: "browser", subject }) as Extract<
      TimelineEntry,
      { kind: "operation" }
    >;
    expect(browserCheckCaption(entry.operation)).toBe(caption);
  });

  // "set device iPhone 13: Other" was the tool's step and its error class,
  // shown in red under a failed take (Nova, 2026-09-26).
  it.each([
    {
      name: "a step the tool gave only a class of error",
      step: { label: "set device iPhone 13", note: "Other" },
      words: "couldn't set device iPhone 13",
    },
    {
      name: "a step with the tool's reason",
      step: { label: "open https://a.dev/", note: "net::ERR_NAME_NOT_RESOLVED" },
      words: "couldn't open https://a.dev/: net::ERR_NAME_NOT_RESOLVED",
    },
    { name: "a step with no reason", step: { label: "click #buy" }, words: "couldn't click #buy" },
    {
      name: "a step that timed out",
      step: { label: "open https://a.dev/", note: "Timeout 30000ms exceeded" },
      words: "timed out, the page never loaded",
    },
  ])("says why a check failed at $name", ({ step, words }) => {
    const failed = operation("b1", "t1", 1, {
      kind: "browser",
      phase: "failed",
      browserSummary: { failedStep: step } as never,
    }) as Extract<TimelineEntry, { kind: "operation" }>;
    expect(browserCheckFailure(failed.operation)).toBe(words);
  });

  it("says why a check failed", () => {
    const timedOut = operation("b1", "t1", 1, {
      kind: "browser",
      phase: "failed",
      closing: "Navigation timeout of 30000 ms exceeded.",
    }) as Extract<TimelineEntry, { kind: "operation" }>;
    expect(browserCheckFailure(timedOut.operation)).toBe("timed out, the page never loaded");
  });

  it("counts a check that failed and then passed on the same page as passed", () => {
    // The Mate asked for a device agent-browser does not know, then took the
    // same page on one it does: the page never failed.
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, {
        kind: "browser",
        subject: "https://a.dev/",
        phase: "failed",
        deviceName: "iPhone 13",
      }),
      operation("b2", "t1", 2, {
        kind: "browser",
        subject: "https://a.dev/",
        deviceName: "iPhone 16",
      }),
      operation("b3", "t1", 3, { kind: "browser", subject: "https://b.dev/" }),
      assistant("a1", "t1", 4),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    // Two hosts' front pages are two pages, both captioned "/".
    const checks = stretchOperations(only!.stretches[0]!).filter(
      (operation) => operation.kind === "browser",
    );
    expect(checksStrip(checks, false)).toMatchObject({ views: 2, failures: 0 });
    expect(deriveOutcome({ turn: only!, landed: [], diffs: [] })?.checks).toMatchObject({
      count: 3,
      views: 2,
      failures: 0,
    });
  });

  // A take drawn red with a ✗ under a heading saying "all passed" said two
  // things at once (Nova, 2026-09-26: iPhone 13 refused, retaken on iPhone 16).
  it("tells each take how it ended: a failure the same page passed later is a retry", () => {
    const checks = [
      operation("b1", "t1", 1, {
        kind: "browser",
        subject: "https://a.dev/",
        phase: "failed",
        deviceName: "iPhone 13",
      }),
      operation("b2", "t1", 2, { kind: "browser", subject: "https://a.dev/" }),
      operation("b3", "t1", 3, { kind: "browser", subject: "https://a.dev/cart", phase: "failed" }),
      operation("b4", "t1", 4, {
        kind: "browser",
        subject: "https://a.dev/cart",
        phase: "running",
      }),
    ].map((entry) => (entry as Extract<TimelineEntry, { kind: "operation" }>).operation);
    expect(checks.map((check) => browserTakeState(check, checks))).toEqual([
      "retried",
      "passed",
      "failed",
      "running",
    ]);
  });

  it("counts a run of checks' pages, and the failures it did not come back from", () => {
    const checks = [
      operation("b1", "t1", 1, { kind: "browser", subject: "https://a.dev/" }),
      operation("b2", "t1", 3, { kind: "browser", subject: "https://a.dev/cart" }),
      operation("b3", "t1", 4, { kind: "browser", subject: "https://a.dev/cart", phase: "failed" }),
    ].map((entry) => (entry as Extract<TimelineEntry, { kind: "operation" }>).operation);
    expect(checksStrip(checks, false)).toMatchObject({
      key: "strip:op:b1",
      views: 2,
      failures: 1,
      live: false,
    });
  });
});

describe("stretchIncidents", () => {
  it("tells a service that stopped answering and came back as one line", () => {
    const entries = [
      user("m0", 0),
      operation("s0", "t1", 1, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Running",
        steps: [{ id: "dev-server", label: "Start", state: "done", stateLabel: "Done" }],
      }),
      operation("s1", "t1", 2, {
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
      operation("s2", "t1", 3, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Running",
        steps: [{ id: "dev-server", label: "Restart", state: "done", stateLabel: "Done" }],
      }),
      assistant("a1", "t1", 5),
    ];
    const [only] = structure(entries, {
      latest: { id: "t1", state: "completed", completed: true },
    }).turns;
    expect(stretchIncidents(only!.stretches[0]!)).toEqual([
      {
        key: "incident:op:s1",
        hostname: "nextstoredev",
        phases: ["stopped answering (502)", "restarted", "running again"],
        tone: "ok",
        appearedAt: at(2, 30),
      },
    ]);
  });

  it("is no incident when a dev server simply starts", () => {
    const entries = [
      user("m0", 0),
      operation("s0", "t1", 1, {
        kind: "devServer",
        subject: "nextstoredev",
        statusWord: "Running",
        steps: [{ id: "dev-server", label: "Start", state: "done", stateLabel: "Done" }],
      }),
    ];
    const [only] = structure(entries, { live: "t1" }).turns;
    expect(stretchIncidents(only!.stretches[0]!)).toEqual([]);
  });
});

describe("standingIncidents — what the dock under the now line says of a service", () => {
  const dev = (id: string, minute: number, label: string, running: boolean, overrides = {}) =>
    operation(id, "t1", minute, {
      kind: "devServer",
      subject: "appdev",
      statusWord: running ? "Running" : "Not running",
      steps: [
        {
          id: "dev-server",
          label,
          state: running ? "done" : "failed",
          stateLabel: running ? "Done" : "Failed",
        },
      ],
      ...overrides,
    });
  const deploy = (id: string, minute: number, subject: string, overrides = {}) =>
    operation(id, "t1", minute, {
      kind: "deploy",
      subject,
      target: { hostname: subject },
      statusWord: "Deployed",
      ...overrides,
    });
  const moveOn = operation("v9", "t1", 9, {
    kind: "logs",
    subject: "appstage",
    target: { hostname: "appstage" },
    statusWord: "Read",
  });
  it.each([
    {
      name: "a dev server found not running, and nothing since: it says so",
      ops: [dev("s1", 1, "Status", false)],
      shows: [["appdev", "not running", "attention"]],
    },
    {
      name: "found no longer answering: why",
      ops: [
        dev("s1", 1, "Health check", false, {
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
      ],
      shows: [["appdev", "stopped answering (502)", "attention"]],
    },
    {
      name: "a routine start: nothing",
      ops: [dev("s1", 1, "Start", true)],
      shows: [],
    },
    {
      name: "a log read checks nothing: nothing",
      ops: [dev("s1", 1, "Health check", true), dev("s2", 2, "Logs", false)],
      shows: [],
    },
    {
      name: "found, then started and running: gone",
      ops: [dev("s1", 1, "Status", false), dev("s2", 2, "Start", true)],
      shows: [],
    },
    {
      name: "found, and the Mate restarting it this moment: nothing stale asserted",
      ops: [dev("s1", 1, "Status", false), dev("s2", 2, "Restart", false, { phase: "running" })],
      shows: [],
    },
    {
      name: "found, and the Mate deploying it this moment: nothing stale asserted",
      ops: [dev("s1", 1, "Status", false), deploy("d1", 2, "appdev", { phase: "running" })],
      shows: [],
    },
    {
      name: "found, then deployed: unknown until the Mate looks again",
      ops: [dev("s1", 1, "Status", false), deploy("d1", 2, "appdev")],
      shows: [],
    },
    {
      name: "a start that failed: red, and what failed",
      ops: [
        dev("s1", 1, "Status", false),
        dev("s2", 2, "Start", false, { phase: "failed", statusWord: "Failed" }),
      ],
      shows: [["appdev", "start failed", "failed"]],
    },
    {
      name: "another service's deploy leaves it standing",
      ops: [dev("s1", 1, "Status", false), deploy("d1", 2, "appstage")],
      shows: [["appdev", "not running", "attention"]],
    },
    {
      name: "a batch deploy that takes the service in acts on it",
      ops: [
        dev("s1", 1, "Status", false),
        deploy("d1", 2, "appstage, appdev", {
          batch: true,
          phase: "running",
          steps: [
            { id: "appstage", label: "appstage", state: "running", stateLabel: "Running" },
            { id: "appdev", label: "appdev", state: "queued", stateLabel: "Waiting" },
          ],
        }),
      ],
      shows: [],
    },
    {
      name: "a batch deploy of other services leaves it standing",
      ops: [
        dev("s1", 1, "Status", false),
        deploy("d1", 2, "apistage, webstage", {
          batch: true,
          steps: [
            { id: "apistage", label: "apistage", state: "done", stateLabel: "Done" },
            { id: "webstage", label: "webstage", state: "done", stateLabel: "Done" },
          ],
        }),
      ],
      shows: [["appdev", "not running", "attention"]],
    },
  ])("$name", ({ ops, shows }) => {
    // The Mate moved on: a step of its own after them.
    const [only] = structure([user("m0", 0), ...ops, moveOn], { live: "t1" }).turns;
    expect(
      standingIncidents(only!.stretches[0]!).map((incident) => [
        incident.hostname,
        incident.phases.join(" · "),
        incident.tone,
      ]),
    ).toEqual(shows);
  });

  it("waits while the finding is the record's latest line: it stands right above", () => {
    const [only] = structure([user("m0", 0), dev("s1", 1, "Status", false)], { live: "t1" }).turns;
    expect(standingIncidents(only!.stretches[0]!)).toEqual([]);
  });

  it("stands down while the platform works on the service", () => {
    const [only] = structure([user("m0", 0), dev("s1", 1, "Status", false), moveOn], {
      live: "t1",
    }).turns;
    const incidents = standingIncidents(only!.stretches[0]!);
    expect(incidentsStanding(incidents, new Set(["appdev"]))).toEqual([]);
    expect(incidentsStanding(incidents, new Set(["appstage"]))).toEqual(incidents);
  });
});

describe("deriveOutcome", () => {
  const settled = { latest: { id: "t1", state: "completed", completed: true } } as const;
  const diff = (files: number): TurnDiffSummary =>
    ({
      turnId: turn("t1"),
      checkpointTurnCount: 1,
      checkpointRef: "ref" as TurnDiffSummary["checkpointRef"],
      status: "ready",
      files: Array.from({ length: files }, (_, index) => ({
        path: `src/file${index}.ts`,
        kind: "modified",
        additions: 10,
        deletions: 2,
      })),
      assistantMessageId: null,
      completedAt: at(9),
    }) as TurnDiffSummary;

  // A failure the run came back from is the work's, never its result (the
  // owner, 2026-09-29: "it doesn't make sense to keep log of things that were
  // fixed later"), and what it removed is gone, not something it left.
  it("lists each service once in the state the run left it, nothing it came back from", () => {
    const entries = [
      user("m0", 0),
      operation("d1", "t1", 1, {
        kind: "deploy",
        subject: "medusastage",
        version: { name: "a687dbd1234567890" },
        links: [{ label: "Open", url: "https://medusastage.example.dev" }],
      }),
      operation("v1", "t1", 2, {
        kind: "verify",
        subject: "medusastage",
        phase: "failed",
        statusWord: "Checks failed",
        explanation: { reason: "HTTP internal 403" },
      }),
      operation("d2", "t1", 3, { kind: "deploy", subject: "medusastage" }),
      operation("v2", "t1", 4, { kind: "verify", subject: "medusastage", statusWord: "Healthy" }),
      landed("l1", 5),
      operation("b1", "t1", 6, { kind: "browser", subject: "https://medusastage.example.dev/" }),
      operation("x1", "t1", 7, { kind: "delete", subject: "oldtier", statusWord: "Deleted" }),
      assistant("a1", "t1", 8),
    ];
    const result = structure(entries, settled);
    const [only] = result.turns;
    const outcome = deriveOutcome({
      turn: only!,
      landed: [entries[5] as Extract<TimelineEntry, { kind: "change-landed" }>],
      diffs: [diff(3)],
    });
    expect(outcome).toEqual({
      key: "outcome:msg:m0",
      turnKey: "msg:m0",
      activity: [],
      live: [
        {
          hostname: "medusastage",
          tone: "ok",
          word: "Healthy",
          version: null,
          url: "https://medusastage.example.dev",
          at: at(4, 30),
          failure: null,
        },
      ],
      landed: [
        {
          key: "landed:l1",
          repository: "titandev",
          number: 17,
          line: "titandev #17",
          title: "Draw distance",
        },
      ],
      files: { count: 3, additions: 30, deletions: 6, turnId: turn("t1"), fromTurnId: null },
      checks: {
        count: 1,
        views: 1,
        failures: 0,
        takes: [expect.objectContaining({ kind: "browser" })],
      },
      pictures: [],
      created: [],
      notDone: [],
      planLeft: [],
      change: null,
      crewTask: null,
      later: {
        services: [],
        changes: [],
        tasks: [],
        pages: [],
        views: [],
        files: [],
        answered: false,
      },
    });
  });

  // A stand-up leaves each service it deployed running at its address, and a
  // failed one broken with its build's reason.
  it("lists each service a stand-up deployed, at its address, and one that failed", () => {
    const entries = [
      user("m0", 0),
      operation("s1", "t1", 1, {
        kind: "standup",
        subject: "stage",
        phase: "failed",
        statusWord: "Failed",
        steps: [
          { id: "apistage", label: "apistage", state: "done", stateLabel: "Deployed" },
          {
            id: "webstage",
            label: "webstage",
            state: "failed",
            stateLabel: "Failed",
            note: "the build ran out of memory",
          },
        ],
        links: [{ label: "apistage", url: "https://apistage.example.dev" }],
      }),
      assistant("a1", "t1", 2),
    ];
    const [only] = structure(entries, settled).turns;
    const outcome = deriveOutcome({ turn: only!, landed: [], diffs: [] });
    expect(
      outcome?.live.map(({ hostname, tone, word, url, failure }) => ({
        hostname,
        tone,
        word,
        url,
        reason: failure?.reason ?? null,
      })),
    ).toEqual([
      {
        hostname: "apistage",
        tone: "ok",
        word: "Deployed",
        url: "https://apistage.example.dev",
        reason: null,
      },
      {
        hostname: "webstage",
        tone: "failed",
        word: expect.any(String),
        url: null,
        reason: "the build ran out of memory",
      },
    ]);
    expect(outcome?.notDone).toEqual([]);
  });

  it.each([
    {
      name: "a pair that failed before its deploy stays in the result, with zcp's words",
      steps: [
        {
          id: "apidev",
          label: "apidev",
          state: "failed",
          stateLabel: "Failed",
          note: "checking main out into apidev failed",
        },
      ],
      live: [
        { hostname: "apidev", tone: "failed", reason: "checking main out into apidev failed" },
      ],
    },
    {
      name: "a build the call stopped waiting for is not deployed yet: no row, no address",
      steps: [
        { id: "apidev", label: "apidev", state: "done", stateLabel: "Deployed" },
        { id: "webdev", label: "webdev", state: "running", stateLabel: "Building" },
      ],
      live: [{ hostname: "apidev", tone: "ok", reason: null }],
    },
    {
      name: "a stage held back is neither running nor broken",
      steps: [
        {
          id: "apistage",
          label: "apistage",
          state: "failed",
          stateLabel: "Failed",
          note: "the build ran out of memory",
        },
        {
          id: "webstage",
          label: "webstage",
          state: "queued",
          stateLabel: "Waits",
          note: "apistage did not stand up",
        },
      ],
      live: [{ hostname: "apistage", tone: "failed", reason: "the build ran out of memory" }],
    },
  ] as const)("$name", ({ steps, live }) => {
    const entries = [
      user("m0", 0),
      operation("s1", "t1", 1, {
        kind: "standup",
        subject: "development",
        phase: steps.some((step) => step.state === "failed") ? "failed" : "done",
        steps,
        links: [
          { label: "apidev", url: "https://apidev.example.dev" },
          { label: "webdev", url: "https://webdev.example.dev" },
        ],
      }),
      assistant("a1", "t1", 2),
    ];
    const [only] = structure(entries, settled).turns;
    const outcome = deriveOutcome({ turn: only!, landed: [], diffs: [] });
    expect(
      outcome?.live.map(({ hostname, tone, failure }) => ({
        hostname,
        tone,
        reason: failure?.reason ?? null,
      })),
    ).toEqual(live);
  });

  it("keeps a failed stand-up with nothing to split as the failure it is", () => {
    const failedCall = (
      operation("s1", "t1", 1, {
        kind: "standup",
        subject: "development",
        phase: "failed",
        steps: [],
      }) as Extract<TimelineEntry, { kind: "operation" }>
    ).operation;
    expect(splitStandup(failedCall)).toEqual([failedCall]);
  });

  it("names no stage a development call queued: the next call builds it", () => {
    const entries = [
      user("m0", 0),
      operation("s1", "t1", 1, {
        kind: "standup",
        subject: "development",
        steps: [
          { id: "apidev", label: "apidev", state: "done", stateLabel: "Deployed" },
          { id: "apistage", label: "apistage", state: "queued", stateLabel: "Next" },
        ],
        links: [{ label: "apidev", url: "https://apidev.example.dev" }],
      }),
      assistant("a1", "t1", 2),
    ];
    const [only] = structure(entries, settled).turns;
    const outcome = deriveOutcome({ turn: only!, landed: [], diffs: [] });
    expect(outcome?.live.map(({ hostname, word, url }) => ({ hostname, word, url }))).toEqual([
      { hostname: "apidev", word: "Deployed", url: "https://apidev.example.dev" },
    ]);
  });

  // What is still broken says why, when, and what its log said last: the
  // row's words and the fix request's (S6).
  it.each([
    {
      name: "a build that failed",
      op: {
        kind: "deploy" as const,
        phase: "failed" as const,
        statusWord: "Failed",
        steps: [
          {
            id: "INIT_BUILD_CONTAINER",
            label: "Build container",
            state: "done" as const,
            stateLabel: "Done",
          },
          {
            id: "RUN_BUILD_COMMANDS",
            label: "Build",
            state: "failed" as const,
            stateLabel: "Failed",
          },
        ],
        explanation: {
          reason: "3 type errors in session.ts.",
          logTail: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
        },
      },
      word: "Build failing",
      failure: {
        reason: "3 type errors in session.ts",
        at: at(1, 30),
        logLines: ["src/session.ts(4,7): error TS2322", "Found 3 errors."],
      },
    },
    {
      name: "a deploy that failed after its build",
      op: {
        kind: "deploy" as const,
        phase: "failed" as const,
        statusWord: "Failed",
        steps: [{ id: "DEPLOY", label: "Deploy", state: "failed" as const, stateLabel: "Failed" }],
        closing: "The deploy failed.",
      },
      word: "Deploy failed",
      failure: { reason: "The deploy failed", at: at(1, 30), logLines: [] },
    },
    {
      name: "a health check that failed",
      op: {
        kind: "verify" as const,
        phase: "failed" as const,
        statusWord: "Checks failed",
        explanation: { reason: "HTTP 502" },
      },
      word: "Not healthy",
      failure: { reason: "HTTP 502", at: at(1, 30), logLines: [] },
    },
  ])("keeps what is still broken, with its failure: $name", ({ op, word, failure }) => {
    const outcome = deriveOutcome({
      turn: structure(
        [user("m0", 0), operation("x1", "t1", 1, op), assistant("a1", "t1", 2)],
        settled,
      ).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.live).toEqual([
      expect.objectContaining({ hostname: "appdev", tone: "failed", word, failure }),
    ]);
  });

  // How a service is reached is not how it runs (the owner, 2026-09-29: "fix
  // the state", of a titandev that ran with clean logs and read "Not healthy"
  // because its subdomain was off). A check that failed only on a subdomain
  // left off, or a domain whose DNS points elsewhere yet, leaves it healthy;
  // a public address that answers an error does not.
  it.each([
    {
      name: "its subdomain is off",
      failed: [
        {
          id: "http_public",
          note: "subdomain access not enabled — service is not reachable via HTTP",
        },
      ],
      tone: "ok",
      word: "Healthy",
    },
    {
      name: "a domain's DNS points elsewhere yet",
      failed: [
        {
          id: "public_domain",
          note: "shop.example.com: DNS not pointing at Zerops yet (dnsCheckStatus=PENDING)",
        },
      ],
      tone: "ok",
      word: "Healthy",
    },
    {
      name: "its public address answers an error",
      failed: [{ id: "http_public", note: "502 · Bad Gateway" }],
      tone: "failed",
      word: "Not healthy",
    },
    {
      name: "its subdomain is off, and its logs hold errors",
      failed: [
        {
          id: "http_public",
          note: "subdomain access not enabled — service is not reachable via HTTP",
        },
        { id: "error_logs", note: "3 errors in the last 5 minutes" },
      ],
      tone: "failed",
      word: "Not healthy",
    },
  ])("reads a service by how it runs, not how it is reached: $name", ({ failed, tone, word }) => {
    const steps = [
      {
        id: "service_running",
        label: "Service running",
        state: "done" as const,
        stateLabel: "Done",
      },
      ...failed.map((step) => ({
        id: step.id,
        label: step.id,
        state: "failed" as const,
        stateLabel: "Failed",
        note: step.note,
      })),
    ];
    const outcome = deriveOutcome({
      turn: structure(
        [
          user("m0", 0),
          operation("x1", "t1", 1, {
            kind: "verify",
            phase: "failed",
            statusWord: "Checks failed",
            closing: `${String(failed.length)} of ${String(steps.length)} checks failed.`,
            steps,
          }),
          assistant("a1", "t1", 2),
        ],
        settled,
      ).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.live).toEqual([expect.objectContaining({ hostname: "appdev", tone, word })]);
  });

  // A dev server the run stopped on purpose is no longer running because of
  // it; one it started, and nothing stopped, is.
  it.each([
    { name: "started", actions: ["start"], words: ["Dev server running"] },
    { name: "started, then stopped", actions: ["start", "stop"], words: [] },
  ])("follows a dev server to where the run left it: $name", ({ actions, words }) => {
    const ops = actions.map((action, index) =>
      operation(`s${index}`, "t1", index + 1, {
        kind: "devServer",
        statusWord: action === "stop" ? "Not running" : "Running",
        steps: [{ id: action, label: action, state: "done", stateLabel: "Done" }],
      }),
    );
    const outcome = deriveOutcome({
      turn: structure([user("m0", 0), ...ops, assistant("a1", "t1", 5)], settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.live.map((service) => service.word) ?? []).toEqual(words);
  });

  // A git push is no deploy: the build that follows it, if any, says what
  // came of the service, and a push that failed is something it could not do.
  const pushed = (id: string, minute: number, status: string, phase = "done") =>
    operation(id, "t1", minute, {
      kind: "deploy",
      strategy: "git-push",
      phase: phase as never,
      statusWord: phase === "failed" ? "Failed" : "Pushed",
      resultStatus: status,
      voice: "Pushing appdev.",
      steps: [
        {
          id: "push",
          label: "Push",
          state: phase === "failed" ? "failed" : "done",
          stateLabel: phase === "failed" ? "Failed" : "Done",
        },
      ],
    });
  it.each([
    { name: "a push alone", ops: [pushed("p1", 1, "PUSHED")], services: [], notDone: 0 },
    {
      name: "a push, then the deploy",
      ops: [pushed("p1", 1, "PUSHED"), operation("d1", "t1", 2, { kind: "deploy" })],
      services: ["Deployed"],
      notDone: 0,
    },
    {
      name: "a deploy, then a push",
      ops: [operation("d1", "t1", 1, { kind: "deploy" }), pushed("p1", 2, "PUSHED")],
      services: ["Deployed"],
      notDone: 0,
    },
    {
      name: "nothing to push",
      ops: [pushed("p1", 1, "NOTHING_TO_PUSH")],
      services: [],
      notDone: 0,
    },
    { name: "a push that failed", ops: [pushed("p1", 1, "", "failed")], services: [], notDone: 1 },
    {
      // A batch's split service has one step named by the service: one called
      // "push" is a deploy like any other.
      name: "a batch-deployed service named push",
      ops: [
        operation("b1", "t1", 1, {
          kind: "deploy",
          subject: "push",
          steps: [{ id: "push", label: "push", state: "done", stateLabel: "Done" }],
        }),
      ],
      services: ["Deployed"],
      notDone: 0,
    },
  ])("reads a git push as a push: $name", ({ ops, services, notDone }) => {
    const outcome = deriveOutcome({
      turn: structure([user("m0", 0), ...ops, assistant("a1", "t1", 5)], settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.live.map((service) => service.word) ?? []).toEqual(services);
    expect(outcome?.notDone.length ?? 0).toBe(notDone);
  });

  // What the runs after this one took over: a service deployed, started,
  // stopped, created or removed again; a change pushed to again; a crew task
  // worked again; a page checked again; a picture looked at again — and
  // whether the person wrote since. A health check takes nothing over, and
  // neither does a helper waking the Mate.
  const pushedTo = (id: string, turnId: string, minute: number, number: number) =>
    operation(id, turnId, minute, {
      kind: "deploy",
      strategy: "git-push",
      statusWord: "Pushed",
      pullRequest: { repository: "app", number },
      steps: [{ id: "push", label: "Push", state: "done", stateLabel: "Done" }],
    });
  const devServer = (id: string, turnId: string, minute: number, action: string) =>
    operation(id, turnId, minute, {
      kind: "devServer",
      statusWord: action === "stop" ? "Not running" : "Running",
      steps: [{ id: action, label: action, state: "done", stateLabel: "Done" }],
    });
  const crewCard = (id: string, minute: number, title: string) =>
    user(id, minute, `${CREW_CARD_OPENER}\n${title}\nDone when: it works`);
  it.each([
    {
      name: "a later run redeploys a service and checks a page again",
      after: [
        user("m1", 10),
        operation("d2", "t2", 11, { kind: "deploy" }),
        operation("b2", "t2", 12, { kind: "browser", subject: "https://a.dev/status" }),
        assistant("a2", "t2", 13),
      ],
      later: {
        services: ["appdev"],
        changes: [],
        tasks: [],
        pages: ["a.dev/status"],
        views: ["a.dev/status on a desktop"],
        files: [],
        answered: true,
      },
    },
    {
      name: "a later run looks at the same picture again: the file shows what it saw now",
      after: [
        user("m1", 10),
        look("v2", "t2", 11, "/var/www/shots/home.png"),
        look("v3", "t2", 12, "/var/www/shots/menu.png", { toolLifecycleStatus: "failed" }),
        assistant("a2", "t2", 13),
      ],
      later: {
        services: [],
        changes: [],
        tasks: [],
        pages: [],
        views: [],
        files: ["/var/www/shots/home.png"],
        answered: true,
      },
    },
    {
      name: "a later run starts, stops, creates and removes services",
      after: [
        user("m1", 10),
        devServer("s2", "t2", 11, "start"),
        devServer("s3", "t2", 12, "stop"),
        operation("i2", "t2", 13, { kind: "import", subject: "db, cache" }),
        operation("x2", "t2", 14, { kind: "delete", subject: "oldtier" }),
        assistant("a2", "t2", 15),
      ],
      later: {
        services: ["appdev", "db", "cache", "oldtier"],
        changes: [],
        tasks: [],
        pages: [],
        views: [],
        files: [],
        answered: true,
      },
    },
    {
      name: "a later run only checks a service's health: nothing taken over",
      after: [user("m1", 10), devServer("s2", "t2", 11, "health check"), assistant("a2", "t2", 12)],
      later: {
        services: [],
        changes: [],
        tasks: [],
        pages: [],
        views: [],
        files: [],
        answered: true,
      },
    },
    {
      name: "a later run pushes to the same change",
      after: [user("m1", 10), pushedTo("p2", "t2", 11, 2), assistant("a2", "t2", 12)],
      later: {
        services: [],
        changes: ["app#2"],
        tasks: [],
        pages: [],
        views: [],
        files: [],
        answered: true,
      },
    },
    {
      name: "a later run works the same crew task",
      after: [
        crewCard("m1", 10, "#12 Camera rig · rework"),
        tool("w2", "t2", 11),
        assistant("a2", "t2", 12),
      ],
      later: {
        services: [],
        changes: [],
        tasks: [12],
        pages: [],
        views: [],
        files: [],
        answered: true,
      },
    },
    {
      name: "a later run a command opened: the person did not answer",
      after: [user("m1", 10, "/compact"), tool("w2", "t2", 11), assistant("a2", "t2", 12)],
      later: {
        services: [],
        changes: [],
        tasks: [],
        pages: [],
        views: [],
        files: [],
        answered: false,
      },
    },
    {
      name: "no run after it",
      after: [],
      later: {
        services: [],
        changes: [],
        tasks: [],
        pages: [],
        views: [],
        files: [],
        answered: false,
      },
    },
  ])("knows what the runs after it took over: $name", ({ after, later }) => {
    const entries = [
      user("m0", 0),
      operation("d1", "t1", 1, { kind: "deploy" }),
      assistant("a1", "t1", 2),
      ...after,
    ];
    const turns = structure(entries, {
      latest: { id: after.length > 0 ? "t2" : "t1", state: "completed", completed: true },
    }).turns;
    const outcome = deriveOutcome({
      turn: turns[0]!,
      landed: [],
      diffs: [],
      later: turns.slice(1),
    });
    expect(outcome?.later).toEqual(later);
  });

  // The change a run leaves is the pull request its push landed through;
  // the crew task it worked is the one its card named.
  it("names the change its push went to, and the crew task its card named", () => {
    const entries = [
      user("m0", 0, `${CREW_CARD_OPENER}\n#12 Camera rig · from you\nDone when: it follows`),
      pushedTo("p1", "t1", 1, 1),
      pushedTo("p2", "t1", 2, 2),
      assistant("a1", "t1", 3),
    ];
    const outcome = deriveOutcome({
      turn: structure(entries, settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.change).toEqual({ repository: "app", number: 2 });
    expect(outcome?.crewTask).toEqual({ number: 12, title: "Camera rig" });
  });

  // A step of its plan it did not finish is something it could not do.
  it("keeps the steps of its plan it did not finish", () => {
    const plan: TimelineEntry = {
      id: "p1",
      kind: "turn-plan",
      createdAt: at(1),
      turnPlan: {
        id: "turn-plan:t1",
        createdAt: at(1),
        turnId: turn("t1"),
        plan: {
          createdAt: at(1),
          turnId: turn("t1"),
          steps: [
            { step: "Add the route", status: "completed" },
            { step: "Style the page", status: "inProgress" },
            { step: "Write the tests", status: "pending" },
          ],
        },
      },
    };
    const outcome = deriveOutcome({
      turn: structure([user("m0", 0), plan, tool("w1", "t1", 2), assistant("a1", "t1", 3)], settled)
        .turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.planLeft).toEqual(["Style the page", "Write the tests"]);
  });

  // The run's pictures, in the order they were taken (the owner, 2026-09-29,
  // of a result that had none: "if anything it should show the
  // screenshots"): each page's last screenshot its checks took, and each
  // picture the Mate looked at — most often a screenshot it took of its own
  // app — once, where it was taken last.
  const check = (
    id: string,
    minute: number,
    subject: string,
    picture: string | null,
    overrides: Partial<ZeropsOperation> = {},
  ) =>
    operation(id, "t1", minute, {
      kind: "browser",
      subject,
      ...(picture === null ? {} : { screenshot: { src: `data:image/png;base64,${picture}` } }),
      ...overrides,
    });
  const readPictures = (pictures: NonNullable<ReturnType<typeof deriveOutcome>>["pictures"]) =>
    pictures.map((picture) =>
      picture.kind === "check"
        ? [
            "check",
            picture.caption,
            picture.device === null ? null : `on ${picture.device}`,
            picture.src.split(",")[1],
            picture.failed ? "failed" : null,
          ]
            .filter((part) => part !== null)
            .join(" ")
        : `file ${picture.name} ${picture.path}`,
    );
  it.each([
    // "showing only one of the images" (the owner, 2026-09-30): a page taken
    // on a desktop and on a phone is two pictures.
    {
      name: "each page's picture on each device, in the order taken",
      pictures: [
        check("b1", 1, "https://a.dev/", "A"),
        check("b2", 2, "https://a.dev/", "B", { deviceName: "iPhone 16" }),
        check("b3", 3, "https://a.dev/status", null),
      ],
      read: ["check / A", "check / on iPhone 16 B"],
    },
    {
      name: "a page checked again on the same device stands in its latest",
      pictures: [
        check("b1", 1, "https://a.dev/", "A", { deviceName: "iPhone 16" }),
        check("b2", 2, "https://a.dev/", "B", { deviceName: "iPhone 16" }),
      ],
      read: ["check / on iPhone 16 B"],
    },
    {
      name: "each file it looked at, once, where it looked last",
      pictures: [
        look("v1", "t1", 1, "/var/www/shots/home.png"),
        look("v2", "t1", 2, "/var/www/shots/world.png"),
        look("v3", "t1", 3, "/var/www/shots/home.png"),
      ],
      read: ["file world.png /var/www/shots/world.png", "file home.png /var/www/shots/home.png"],
    },
    {
      name: "checks and looks together, in the order they were taken",
      pictures: [
        check("b1", 1, "https://a.dev/", "A"),
        look("v1", "t1", 2, "/var/www/shots/home.png"),
        check("b2", 3, "https://a.dev/status", "C"),
      ],
      read: ["check / A", "file home.png /var/www/shots/home.png", "check /status C"],
    },
    {
      name: "a check's picture stands where it came back, not where it began",
      pictures: [
        check("b1", 1, "https://a.dev/", "A", { settledAt: at(3) }),
        look("v1", "t1", 2, "/var/www/shots/home.png"),
      ],
      read: ["file home.png /var/www/shots/home.png", "check / A"],
    },
    {
      name: "the same picture twice is one, where it was taken last",
      pictures: [check("b1", 1, "https://a.dev/", "A"), check("b2", 2, "https://a.dev/cart", "A")],
      read: ["check /cart A"],
    },
    {
      name: "a check that stayed failed keeps its picture, and says so",
      pictures: [check("b1", 1, "https://a.dev/admin", "D", { phase: "failed" })],
      read: ["check /admin D failed"],
    },
    {
      name: "a check with no address is the page's",
      pictures: [check("b1", 1, "the page", "E")],
      read: ["check the page E"],
    },
    {
      name: "a look that failed is none, nor a command that only took the picture",
      pictures: [
        tool("w1", "t1", 1, { command: "agent-browser screenshot /var/www/shots/home.png" }),
        look("v1", "t1", 2, "/var/www/shots/gone.png", { toolLifecycleStatus: "failed" }),
        check("b1", 3, "https://a.dev/", null),
      ],
      read: [],
    },
  ])("keeps the run's pictures: $name", ({ pictures, read }) => {
    const outcome = deriveOutcome({
      turn: structure([user("m0", 0), ...pictures, assistant("a1", "t1", 9)], settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(readPictures(outcome?.pictures ?? [])).toEqual(read);
  });

  it("keeps a captured screenshot's filename and dimensions in its result card", () => {
    const outcome = deriveOutcome({
      turn: structure(
        [
          user("m0", 0),
          look("v1", "t1", 3, "mate-asset:shot", {
            viewedImageName: "home-mobile.png",
            viewedImageDimensions: { width: 1179, height: 2556 },
          }),
          assistant("a1", "t1", 9),
        ],
        settled,
      ).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.pictures[0]).toMatchObject({
      name: "home-mobile.png",
      dimensions: { width: 1179, height: 2556 },
    });
  });

  // A check's picture carries its shape, so its tile holds it before a byte
  // of the picture has come; a file's is read with its address.
  it("carries each check's picture's shape", () => {
    const outcome = deriveOutcome({
      turn: structure(
        [
          user("m0", 0),
          check("b1", 1, "https://a.dev/", "A", {
            screenshot: { src: "data:image/png;base64,A", width: 1179, height: 2556 },
          }),
          check("b2", 2, "https://a.dev/cart", "B", { viewport: { width: 1440, height: 900 } }),
          look("v1", "t1", 3, "/var/www/shots/home.png"),
          assistant("a1", "t1", 9),
        ],
        settled,
      ).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(
      outcome?.pictures.map((picture) =>
        picture.kind === "check" ? Number(picture.ratio.toFixed(3)) : picture.kind,
      ),
    ).toEqual([0.461, 1.6, "file"]);
  });

  // Each service says when the run last deployed or started it: a version
  // the platform made after that is someone else's since.
  it("says when the run last touched each service", () => {
    const outcome = deriveOutcome({
      turn: structure(
        [
          user("m0", 0),
          operation("d1", "t1", 1, { kind: "deploy" }),
          operation("d2", "t1", 4, { kind: "deploy" }),
          assistant("a1", "t1", 5),
        ],
        settled,
      ).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.live.map((service) => service.at)).toEqual([at(4, 30)]);
  });

  it("has nothing to say for a turn that produced nothing, or one a limit refused", () => {
    const quiet = structure(
      [user("m0", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2)],
      settled,
    );
    expect(deriveOutcome({ turn: quiet.turns[0]!, landed: [], diffs: [] })).toBeNull();
    const refused = structure(
      [
        user("m0", 0),
        assistant("a1", "t1", 1, "You've hit your session limit · resets 9:20pm (UTC)"),
      ],
      settled,
    );
    expect(deriveOutcome({ turn: refused.turns[0]!, landed: [], diffs: [diff(2)] })).toBeNull();
  });

  // What its calls came to is the run's effort: a run that only ran
  // commands still has an outcome, for its worked line to count them.
  const edited = { kind: "edit" as const, count: 1 };
  const ran = { kind: "command" as const, count: 2 };
  it.each([
    { name: "only commands ran", changed: null, activity: [ran], files: null },
    { name: "edits, no diff yet", changed: null, activity: [edited, ran], files: null },
    { name: "edits, the files changed known", changed: 2, activity: [edited, ran], files: 2 },
  ])("keeps what a run's calls came to: $name", ({ changed, activity, files }) => {
    const outcome = deriveOutcome({
      turn: structure(
        [user("m0", 0), tool("w1", "t1", 1), tool("w2", "t1", 2), assistant("a1", "t1", 3)],
        settled,
      ).turns[0]!,
      landed: [],
      diffs: changed === null ? [] : [diff(changed)],
      activity,
    });
    expect(outcome?.activity).toEqual(activity);
    expect(outcome?.files?.count ?? null).toBe(files);
  });

  it("reports checks alone, with every take: the report is where a settled turn's checks are seen", () => {
    const entries = [
      user("m0", 0),
      operation("b1", "t1", 1, { kind: "browser", subject: "https://shop.dev/" }),
      assistant("a1", "t1", 2),
    ];
    expect(
      deriveOutcome({ turn: structure(entries, settled).turns[0]!, landed: [], diffs: [] }),
    ).toMatchObject({
      checks: {
        count: 1,
        views: 1,
        failures: 0,
        takes: [expect.objectContaining({ kind: "browser" })],
      },
    });
  });

  it("reports each service a batch deployed, in its own state", () => {
    const entries = [
      user("m0", 0),
      operation("d1", "t1", 1, {
        kind: "deploy",
        batch: true,
        subject: "apistage, webstage",
        phase: "failed",
        statusWord: "Failed",
        steps: [
          { id: "apistage", label: "apistage", state: "done", stateLabel: "Done" },
          {
            id: "webstage",
            label: "webstage",
            state: "failed",
            stateLabel: "Failed",
            note: "Build failed",
          },
        ],
      }),
      assistant("a1", "t1", 2),
    ];
    const outcome = deriveOutcome({
      turn: structure(entries, settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.live).toEqual([
      expect.objectContaining({ hostname: "apistage", tone: "ok", word: "Deployed" }),
      expect.objectContaining({ hostname: "webstage", tone: "failed", word: "Deploy failed" }),
    ]);
  });

  it("names what could not be done", () => {
    const entries = [
      user("m0", 0),
      operation("i1", "t1", 1, {
        kind: "import",
        subject: "cache",
        phase: "failed",
        voice: "Importing cache",
        statusWord: "Import failed",
        explanation: { reason: "Zerops has no service type valkey@9." },
      }),
      assistant("a1", "t1", 2),
    ];
    const outcome = deriveOutcome({
      turn: structure(entries, settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.notDone).toEqual([
      {
        key: "op:i1",
        subject: "cache",
        word: "Import failed",
        reason: "Zerops has no service type valkey@9",
        at: at(1, 30),
      },
    ]);
  });

  // A call that failed on the way is a stumble the log keeps, never an
  // outcome: a run that went on past a workflow asked for a service that is
  // not there read "not done" in red under a finished deploy (Nova,
  // 2026-09-27). Its words were the voice's sentence with a colon after it.
  it("names no call that failed on the way, and never doubles a sentence's stop", () => {
    const entries = [
      user("m0", 0),
      operation("e1", "t1", 1, {
        kind: "error",
        subject: "Workflow",
        phase: "failed",
        voice: "Workflow failed.",
        statusWord: "Failed",
        explanation: { reason: "scope contains unknown hostnames" },
      }),
      operation("i1", "t1", 2, {
        kind: "import",
        subject: "cache",
        phase: "failed",
        voice: "Creating cache.",
        statusWord: "Import failed",
        explanation: { reason: "Zerops has no service type valkey@9." },
      }),
      assistant("a1", "t1", 3),
    ];
    const outcome = deriveOutcome({
      turn: structure(entries, settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(outcome?.notDone).toEqual([
      expect.objectContaining({ subject: "cache", reason: "Zerops has no service type valkey@9" }),
    ]);
  });
});

// A call that never returned says what was asked, never that it runs or how
// it came out (D3): "Deploy app", then "No result" once the run is over.
describe("operationUnreturnedWords", () => {
  it.each([
    { kind: "deploy", words: "Deploy app" },
    { kind: "verify", words: "Check app" },
    { kind: "browser", words: "Check app" },
    { kind: "import", words: "Create app" },
    { kind: "logs", words: "Read the app log" },
    { kind: "events", words: "Read the events of app" },
    { kind: "discover", words: "Look at app" },
    { kind: "process", words: "Follow app" },
    { kind: "bootstrap", words: "Set up app" },
    { kind: "standup", words: "Stand app up" },
    { kind: "subdomain", words: "Update the subdomain of app" },
  ] as const)("$kind: $words", ({ kind, words }) => {
    const entry = operation("x", "t1", 1, { kind, subject: "app", phase: "running" });
    if (entry.kind !== "operation") throw new Error("an operation");
    expect(operationUnreturnedWords(entry.operation)).toBe(words);
  });
});

describe("operationLineWords", () => {
  const op = (overrides: Partial<ZeropsOperation> & Pick<ZeropsOperation, "kind">) =>
    (operation("x", "t1", 1, overrides) as Extract<TimelineEntry, { kind: "operation" }>).operation;
  it.each([
    {
      kind: "deploy",
      phase: "running",
      voice: "Deploying app.",
      statusWord: "Deploying",
      words: "Deploying app",
    },
    {
      kind: "deploy",
      phase: "done",
      voice: "Deploying app.",
      statusWord: "Deployed",
      words: "Deployed app",
    },
    {
      kind: "deploy",
      phase: "failed",
      voice: "Deploying app.",
      statusWord: "Failed",
      words: "Deploy to app failed",
    },
    {
      kind: "verify",
      phase: "done",
      voice: "Checking app.",
      statusWord: "Healthy",
      words: "app is healthy",
    },
    // "Running app" read as work still going on, under a finished bar (Nova,
    // 2026-09-28): a dev server's line says what it came to, as its pill does.
    {
      kind: "devServer",
      phase: "done",
      voice: "Starting the dev server on app.",
      statusWord: "Running",
      words: "Dev server running on app",
    },
    {
      kind: "devServer",
      phase: "done",
      voice: "Stopping the dev server on app.",
      statusWord: "Not running",
      words: "Dev server not running on app",
    },
    {
      kind: "devServer",
      phase: "failed",
      voice: "Starting the dev server on app.",
      statusWord: "Failed",
      words: "Dev server on app failed",
    },
    {
      kind: "devServer",
      phase: "done",
      voice: "Checking the dev server on app.",
      statusWord: "Done",
      words: "Dev server on app",
    },
    {
      kind: "verify",
      phase: "failed",
      voice: "Checking app.",
      statusWord: "Checks failed",
      words: "app: checks failed",
    },
    {
      kind: "error",
      phase: "failed",
      voice: "Workflow failed.",
      statusWord: "Failed",
      words: "Workflow failed",
      subject: "Workflow",
    },
    {
      kind: "logs",
      phase: "done",
      voice: "Reading the app log.",
      statusWord: "Read",
      words: "Read the app log",
    },
    // "Done app" and "Complete app" read oddly (pass 35): a followed process
    // says it followed, a set-up session that it stood its services up.
    {
      kind: "process",
      phase: "done",
      voice: "Following app.",
      statusWord: "Done",
      words: "Followed app",
    },
    {
      kind: "process",
      phase: "done",
      voice: "Following app.",
      statusWord: "Cancelled",
      words: "Cancelled app",
    },
    {
      kind: "bootstrap",
      phase: "done",
      voice: "Setting up app.",
      statusWord: "Complete",
      words: "Stood app up",
    },
    // An adopt-route session took over what stood already.
    {
      kind: "bootstrap",
      phase: "done",
      voice: "Adopting app.",
      kicker: "Adopt · app",
      statusWord: "Complete",
      words: "Adopted app",
    },
  ] as const)("$kind $phase: $words", ({ words, ...fields }) => {
    expect(operationLineWords(op({ subject: "app", ...fields }))).toBe(words);
  });

  // "all services is healthy" (the owner, 2026-09-30): a check of every
  // service says how many, in English.
  const check = (id: string, state: "done" | "failed" | "queued") => ({
    id,
    label: id,
    state,
    stateLabel: state,
  });
  it.each([
    {
      name: "every service healthy",
      phase: "done",
      steps: [
        check("api", "done"),
        check("web", "done"),
        check("db", "done"),
        check("cache", "done"),
      ],
      words: "4 services healthy",
    },
    {
      name: "one service, healthy",
      phase: "done",
      steps: [check("api", "done")],
      words: "1 service healthy",
    },
    {
      name: "one of four unhealthy",
      phase: "failed",
      steps: [
        check("api", "failed"),
        check("web", "done"),
        check("db", "done"),
        check("cache", "done"),
      ],
      words: "1 of 4 services unhealthy",
    },
    { name: "no checks reported", phase: "done", steps: [], words: "All services healthy" },
    // Only a check that passed is healthy: a call that failed with no check
    // failed, or checks still unanswered, count none of theirs.
    {
      name: "a call that failed with no failed check",
      phase: "failed",
      steps: [check("api", "done"), check("web", "queued")],
      words: "1 of 2 services healthy",
    },
  ] as const)("a check of all services: $name", ({ phase, steps, words }) => {
    expect(
      operationLineWords(
        op({
          kind: "verify",
          subject: "all services",
          voice: "Checking all services.",
          statusWord: phase === "done" ? "Healthy" : "Checks failed",
          phase,
          steps,
        }),
      ),
    ).toBe(words);
  });
});

// An env call says what it changed and where — the project's variables or a
// service's, how many — never "Updated the service", never a value.
describe("operationLineWords — an env call, by what it changed and where", () => {
  const env = (phase: ZeropsOperation["phase"], noResult = false) => {
    const entry = operation("e", "t1", 1, {
      kind: "env",
      subject: "the project",
      voice: "Setting 6 of the project's variables.",
      statusWord: phase === "failed" ? "Failed" : phase === "declined" ? "Declined" : "Updated",
      phase,
      envChange: { action: "set", scope: "project", count: 6 },
    });
    if (entry.kind !== "operation") throw new Error("an operation");
    return noResult
      ? operationUnreturnedWords(entry.operation)
      : operationLineWords(entry.operation);
  };
  it.each([
    { name: "done", words: env("done"), expected: "Set 6 of the project's variables" },
    { name: "running", words: env("running"), expected: "Setting 6 of the project's variables" },
    {
      name: "failed",
      words: env("failed"),
      expected: "Setting 6 of the project's variables failed",
    },
    {
      name: "declined",
      words: env("declined"),
      expected: "Set 6 of the project's variables: declined",
    },
    {
      name: "never returned",
      words: env("running", true),
      expected: "Set 6 of the project's variables",
    },
  ])("$name: $expected", ({ words, expected }) => {
    expect(words).toBe(expected);
  });
});

describe("operationLineWords — a stand-up call, by what its report said", () => {
  const op = (overrides: Partial<ZeropsOperation>) =>
    (
      operation("s", "t1", 1, { kind: "standup", ...overrides }) as Extract<
        TimelineEntry,
        { kind: "operation" }
      >
    ).operation;
  const built = (label: string) =>
    ({ id: label, label, state: "done", stateLabel: "Deployed" }) as const;
  const next = (label: string) =>
    ({ id: label, label, state: "queued", stateLabel: "Next" }) as const;
  const failed = (label: string) =>
    ({ id: label, label, state: "failed", stateLabel: "Failed" }) as const;
  const building = (label: string) =>
    ({ id: label, label, state: "running", stateLabel: "Building" }) as const;
  const held = (label: string, note: string) =>
    ({ id: label, label, state: "queued", stateLabel: "Waits", note }) as const;
  it.each([
    {
      name: "the development call running",
      fields: { subject: "development", phase: "running", voice: "Standing development up." },
      words: "Standing development up",
    },
    // Its call returned while its builds run on (pass 35): the record's line
    // says what it stood up, the band runs the builds.
    {
      name: "the development call returned, its builds running on",
      fields: {
        subject: "development",
        phase: "done",
        voice: "Standing development up.",
        returnedAt: "2026-09-24T20:01:05.000Z",
        steps: [building("apidev"), building("db")],
      },
      words: "Stood development up · apidev and db still building",
    },
    {
      name: "the development call stood, its stages next",
      fields: {
        subject: "development",
        phase: "done",
        steps: [built("apidev"), next("apistage"), built("webdev"), next("webstage")],
      },
      words: "Stood development up · apistage and webstage next",
    },
    {
      name: "the development call stood, nothing queued",
      fields: { subject: "development", phase: "done", steps: [built("apidev")] },
      words: "Stood development up",
    },
    {
      name: "the development call with a dev half failed: its queued stage is no failure",
      fields: {
        subject: "development",
        phase: "failed",
        steps: [built("apidev"), next("apistage"), failed("webdev")],
      },
      words: "Stood up 1 of 2 · webdev failed",
    },
    {
      name: "the stage call running",
      fields: { subject: "stage", phase: "running", voice: "Standing stage up." },
      words: "Standing stage up",
    },
    {
      name: "the stage call stood",
      fields: { subject: "stage", phase: "done", steps: [built("apistage"), built("webstage")] },
      words: "Stood stage up",
    },
    {
      name: "the stage call with one failed",
      fields: { subject: "stage", phase: "failed", steps: [built("apistage"), failed("webstage")] },
      words: "Stood up 1 of 2 · webstage failed",
    },
    {
      name: "a refusal before anything was built",
      fields: { subject: "development", phase: "failed", steps: [] },
      words: "Standing development up failed",
    },
    {
      name: "a build the call stopped waiting for: still building, no failure",
      fields: {
        subject: "development",
        phase: "done",
        steps: [built("apidev"), next("apistage"), building("webdev")],
      },
      words: "Stood development up · webdev still building · apistage next",
    },
    {
      name: "a stage held by one that failed: the failed one is named, the held one is not counted",
      fields: {
        subject: "stage",
        phase: "failed",
        steps: [failed("apistage"), held("webstage", "apistage did not stand up")],
      },
      words: "Stood up 0 of 1 · apistage failed",
    },
  ] as const)("$name", ({ fields, words }) => {
    expect(operationLineWords(op(fields))).toBe(words);
  });
});

describe("splitBatchDeploy", () => {
  const step = (host: string, state: "queued" | "running" | "done" | "failed", note?: string) => ({
    id: host,
    label: host,
    state,
    stateLabel: state,
    ...(note === undefined ? {} : { note }),
  });
  const deploy = (overrides: Parameters<typeof operation>[3]) =>
    (operation("d1", "t1", 1, overrides) as Extract<TimelineEntry, { kind: "operation" }>)
      .operation;

  it.each([
    {
      name: "one deploy per service while the batch runs, each in its own state",
      batch: deploy({
        kind: "deploy",
        batch: true,
        subject: "apistage, webstage",
        phase: "running",
        statusWord: "Deploying",
        settledAt: undefined as never,
        steps: [step("apistage", "running"), step("webstage", "queued")],
      }),
      services: [
        ["op:d1:apistage", "apistage", "running", "Deploying"],
        ["op:d1:webstage", "webstage", "running", "Waiting"],
      ],
    },
    {
      name: "settled: the one that deployed, and the one that failed with its reason",
      batch: deploy({
        kind: "deploy",
        batch: true,
        subject: "apistage, webstage",
        phase: "failed",
        statusWord: "Failed",
        steps: [step("apistage", "done"), step("webstage", "failed", "Build failed")],
      }),
      services: [
        ["op:d1:apistage", "apistage", "done", "Deployed"],
        ["op:d1:webstage", "webstage", "failed", "Failed"],
      ],
    },
    {
      name: "a deploy of one service is itself",
      batch: deploy({ kind: "deploy", subject: "appdev" }),
      services: [["op:d1", "appdev", "done", "Deployed"]],
    },
  ])("$name", ({ batch, services }) => {
    const split = splitBatchDeploy(batch);
    expect(split.map((op) => [op.key, op.subject, op.phase, op.statusWord])).toEqual(services);
    // Each is a service's own deploy: named by it, observed by its hostname.
    for (const op of split) {
      expect(op.batch).toBeUndefined();
      expect(op.target).toEqual({ hostname: op.subject });
    }
    const failed = split.find((op) => op.phase === "failed");
    if (failed !== undefined) expect(failed.explanation).toEqual({ reason: "Build failed" });
  });
});

describe("tool calls in words", () => {
  it.each([
    [
      { itemType: "dynamic_tool_call", label: "Tool call", detail: 'AskUserQuestion: {"q":1}' },
      "AskUserQuestion",
    ],
    [{ itemType: "dynamic_tool_call", label: "Tool call", detail: "WebFetch: {}" }, "WebFetch"],
    [{ itemType: "dynamic_tool_call", label: "Tool call", detail: "no name here" }, null],
    [
      { itemType: "collab_agent_tool_call", label: "Subagent task", detail: "ListAgents: {}" },
      "ListAgents",
    ],
    [{ itemType: "command_execution", label: "Ran command", detail: "Foo: {}" }, null],
  ] as const)("names the tool a generic call ran: %j → %s", (entry, name) => {
    expect(namedToolCall(entry)).toBe(name);
  });

  it.each([
    ['Read: {"file_path":"/var/www/appdev/package.json"}', "Reading package.json"],
    ['Edit: {"file_path":"/var/www/appdev/src/status.ts","old_string":"a"', "Editing status.ts"],
    ['Write: {"file_path":"/var/www/appdev/README.md"}', "Writing README.md"],
    ['Grep: {"pattern":"TODO"}', "Searching the code"],
    ['Glob: {"pattern":"**/*.ts"}', "Looking for files"],
  ])("says a file call by its file: %s → %j", (detail, words) => {
    const name = namedToolCall({ itemType: "dynamic_tool_call", label: "Tool call", detail })!;
    expect(toolCallWords(name, detail)).toBe(words);
  });

  it("counts the calls a runtime names only in their details by what they did", () => {
    const call = (name: string, args: string) => ({
      id: name,
      createdAt: at(1),
      label: "Tool call",
      tone: "tool" as const,
      itemType: "dynamic_tool_call" as const,
      detail: `${name}: ${args}`,
    });
    expect(
      activityCounts([
        call("Read", '{"file_path":"/a/package.json"}'),
        call("Read", '{"file_path":"/a/README.md"}'),
        call("Grep", '{"pattern":"x"}'),
      ]),
    ).toEqual([
      { kind: "read", count: 2 },
      { kind: "code-search", count: 1 },
    ]);
  });

  it.each([
    ["AskUserQuestion", "Waiting for your answer"],
    ["WebFetch", "Reading a web page"],
    ["WebSearch", "Searching the web"],
    ["Task", "Starting a helper"],
    ["Agent", "Starting a helper"],
    ["Skill", "Using a skill"],
    ["ToolSearch", "Looking up a tool"],
    ["SomeNewTool", "Using some new tool"],
  ])("says %s as %j, never its arguments", (name, words) => {
    expect(toolCallWords(name)).toBe(words);
  });
});

describe("deriveOutcome: a service's standing is the latest word on it", () => {
  const settled = { latest: { id: "t1", state: "completed", completed: true } } as const;
  type Check = { readonly id: string; readonly note?: string };
  const standUp = (id: string, minute: number, half: "development" | "stage") =>
    operation(id, "t1", minute, {
      kind: "standup",
      subject: half,
      statusWord: "Stood up",
      steps:
        half === "development"
          ? [
              { id: "shopdev", label: "shopdev", state: "done", stateLabel: "Deployed" },
              { id: "webdev", label: "webdev", state: "done", stateLabel: "Deployed" },
              { id: "shopstage", label: "shopstage", state: "queued", stateLabel: "Next" },
              { id: "webstage", label: "webstage", state: "queued", stateLabel: "Next" },
            ]
          : [
              { id: "shopstage", label: "shopstage", state: "done", stateLabel: "Deployed" },
              { id: "webstage", label: "webstage", state: "done", stateLabel: "Deployed" },
            ],
    });
  const devServer = (id: string, minute: number, host: string, action = "Start") =>
    operation(id, "t1", minute, {
      kind: "devServer",
      subject: host,
      statusWord: "Running",
      steps: [
        { id: "dev-server", label: action, state: "done", stateLabel: "Done", note: "HTTP 200" },
      ],
    });
  const verify = (id: string, minute: number, host: string, failed: ReadonlyArray<Check> = []) => {
    const passed = ["service_running", "error_logs", "http_internal", "http_public"].filter(
      (check) => !failed.some((step) => step.id === check),
    );
    const steps = [
      ...passed.map((check) => ({
        id: check,
        label: check,
        state: "done" as const,
        stateLabel: "Done",
      })),
      ...failed.map((step) => ({
        id: step.id,
        label: step.id,
        state: "failed" as const,
        stateLabel: "Failed",
        ...(step.note === undefined ? {} : { note: step.note }),
      })),
    ];
    return operation(id, "t1", minute, {
      kind: "verify",
      subject: host,
      phase: failed.length > 0 ? "failed" : "done",
      statusWord: failed.length > 0 ? "Checks failed" : "Healthy",
      closing:
        failed.length > 0
          ? `${String(failed.length)} of 4 checks failed.`
          : "4 of 4 checks passed.",
      steps,
    });
  };
  const noProcess: ReadonlyArray<Check> = [{ id: "http_public", note: "502 · HTTP 502" }];
  // zcp's words for a probe that got no answer in its time (`probeHTTP`).
  const timedOut = (id: string, host: string): Check => ({
    id,
    note: `request failed: Get "http://${host}/": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`,
  });
  // The internal address answered, as the card writes zcp's note: a dev
  // server's host check turning the project's own hostname away.
  const hostCheck = (status: number): Check => ({
    id: "http_internal",
    note: `${String(status)} · HTTP ${String(status)}: Blocked request. This host ("shopdev") is not allowed.`,
  });

  it.each([
    {
      name: "checked before its dev server ran, then the dev server started",
      ops: [
        standUp("s1", 1, "development"),
        verify("v1", 2, "shopdev", noProcess),
        devServer("d1", 3, "shopdev"),
      ],
      standing: { shopdev: "ok", webdev: "ok" },
    },
    {
      name: "checked before its dev server ran, the dev server started, the stage stood up and checked",
      ops: [
        standUp("s1", 1, "development"),
        verify("v1", 2, "shopdev", noProcess),
        verify("v2", 3, "webdev", [
          ...noProcess,
          { id: "http_internal", note: "request failed: connection refused" },
        ]),
        devServer("d1", 4, "shopdev"),
        devServer("d2", 5, "webdev"),
        standUp("s2", 6, "stage"),
        verify("v3", 7, "shopstage"),
        verify("v4", 8, "webstage"),
      ],
      standing: { shopdev: "ok", webdev: "ok", shopstage: "ok", webstage: "ok" },
    },
    {
      name: "a failed check, then one that passed",
      ops: [verify("v1", 1, "shopdev", noProcess), verify("v2", 2, "shopdev")],
      standing: { shopdev: "ok" },
    },
    {
      name: "a failed check, then a deploy",
      ops: [
        verify("v1", 1, "shopdev", noProcess),
        operation("x1", "t1", 2, { kind: "deploy", subject: "shopdev" }),
      ],
      standing: { shopdev: "ok" },
    },
    {
      // As a stand-up ran (2026-10-02): the dev servers started and answered;
      // the check right after timed out on one's first compile and met the
      // other's host check on its internal address; both answered 200 later.
      name: "dev servers started, the checks right after timed out or met a host check, the stage stood up and checked",
      ops: [
        standUp("s1", 1, "development"),
        devServer("d1", 2, "shopdev"),
        devServer("d2", 3, "webdev"),
        verify("v1", 4, "webdev", [
          timedOut("http_internal", "webdev:3000"),
          timedOut("http_public", "webdev-1a2b-3000.example.app"),
        ]),
        verify("v2", 5, "shopdev", [hostCheck(403)]),
        standUp("s2", 6, "stage"),
        verify("v3", 7, "shopstage"),
        verify("v4", 8, "webstage"),
      ],
      standing: { shopdev: "ok", webdev: "ok", shopstage: "ok", webstage: "ok" },
    },
    {
      name: "a dev server running, then a check whose internal address answered 403 and public served",
      ops: [devServer("d1", 1, "shopdev"), verify("v1", 2, "shopdev", [hostCheck(403)])],
      standing: { shopdev: "ok" },
    },
    {
      name: "a dev server running, then a check whose internal address answered 502",
      ops: [devServer("d1", 1, "shopdev"), verify("v1", 2, "shopdev", [hostCheck(502)])],
      standing: { shopdev: "failed" },
    },
    {
      name: "a dev server running, then a check whose internal address answered 403 and public was refused",
      ops: [
        devServer("d1", 1, "shopdev"),
        verify("v1", 2, "shopdev", [
          hostCheck(403),
          { id: "http_public", note: "request failed: dial tcp: connection refused" },
        ]),
      ],
      standing: { shopdev: "failed" },
    },
    {
      name: "a check whose internal address answered 403 with no dev server found running before it",
      ops: [verify("v1", 1, "shopdev", [hostCheck(403)])],
      standing: { shopdev: "failed" },
    },
    {
      // A deploy replaces what ran: the dev server found before it is not this one.
      name: "a dev server running, a deploy, then a check that timed out",
      ops: [
        devServer("d1", 1, "shopdev"),
        operation("x1", "t1", 2, { kind: "deploy", subject: "shopdev" }),
        verify("v1", 3, "shopdev", [timedOut("http_public", "shopdev-1a2b-9000.example.app")]),
      ],
      standing: { shopdev: "failed" },
    },
    {
      name: "a check that timed out with no dev server found running before it",
      ops: [verify("v1", 1, "shopdev", [timedOut("http_public", "shopdev-1a2b-9000.example.app")])],
      standing: { shopdev: "failed" },
    },
    {
      name: "a dev server running, then a check that timed out and one that answered an error",
      ops: [
        devServer("d1", 1, "shopdev"),
        verify("v1", 2, "shopdev", [
          timedOut("http_internal", "shopdev:9000"),
          { id: "http_public", note: "500 · HTTP 500" },
        ]),
      ],
      standing: { shopdev: "failed" },
    },
    {
      name: "a dev server running, then a check that failed",
      ops: [
        devServer("d1", 1, "shopdev"),
        verify("v1", 2, "shopdev", [{ id: "http_public", note: "500 · HTTP 500" }]),
      ],
      standing: { shopdev: "failed" },
    },
  ])("$name", ({ ops, standing }) => {
    const outcome = deriveOutcome({
      turn: structure([user("m0", 0), ...ops, assistant("a1", "t1", 20)], settled).turns[0]!,
      landed: [],
      diffs: [],
    });
    expect(
      Object.fromEntries((outcome?.live ?? []).map((service) => [service.hostname, service.tone])),
    ).toEqual(standing);
  });
});

// Run 11 (2026-10-05): a run is what the Mate did for one message of the
// person's, the turns its helpers woke included — one card, open while its
// helpers work, its answer decided as it ends.
describe("a run, its woken turns and its work", () => {
  const ANSWER = "All four sites are live.\n\nEach one has its ten pages, and the switcher works.";
  // A helper's finish reaches the thread under no turn.
  const finished = (id: string, minute: number): TimelineEntry => {
    const base = tool(`done-${id}`, "unused", minute, {
      label: "Task completed",
      sourceActivityKind: "task.completed",
      taskId: `task-${id}`,
    });
    if (base.kind !== "work") return base;
    const { turnId: _turnId, command: _command, toolCallId: _call, ...entry } = base.entry;
    return { ...base, entry };
  };
  // A helper the run launched: its row stands where it was spawned.
  const launched = (id: string, minute: number): TimelineEntry =>
    tool(`launch-${id}`, "t1", minute, {
      label: `Review ${id}`,
      sourceActivityKind: "task.started",
      taskId: `task-${id}`,
      agentSpawn: { workflowId: null, agentTaskIds: [`task-${id}`] },
    });

  it("a typed provider refusal ends the attempt before a helper wakes a new turn", () => {
    const entries = [
      user("u1", 0),
      launched("h1", 1),
      tool("refused", "t1", 2, {
        label: "Claude usage limit reached.",
        tone: "info",
        sourceActivityKind: "runtime.warning",
        usageLimit: { resetsAt: at(60) },
      }),
      finished("h1", 4),
      tool("w2", "t2", 5),
      assistant("a2", "t2", 6, ANSWER),
    ];
    const built = structure(entries, { latest: { id: "t2", state: "completed", completed: true } });
    expect(built.turns.map((run) => run.turnId)).toEqual([turn("t1"), turn("t2")]);
    expect(built.turns[0]?.limit).toMatchObject({ resetsAt: at(60) });
    expect(built.turns[1]?.answer?.id).toBe("a2");
  });

  it("draws a turn nobody wrote to start as the run before it going on", () => {
    const entries = [
      user("u1", 0),
      tool("w1", "t1", 1),
      launched("h1", 1),
      assistant("a1", "t1", 2, "Fresh screenshots are being captured now."),
      finished("h1", 4),
      tool("w2", "t2", 5),
      assistant("a2", "t2", 6, ANSWER),
    ];
    const built = structure(entries, { latest: { id: "t2", state: "completed", completed: true } });
    expect(built.turns).toHaveLength(1);
    const [run] = built.turns;
    expect(run!.stretches.map((stretch) => stretch.lead?.id ?? null)).toEqual(["u1", null]);
    expect(run!.answer?.id).toBe("a2");
    // What woke it is the run's: never a loose line between two cards.
    expect([...built.looseIndexes]).toEqual([]);
    // A run that launched none settled with its answer: the turn after it is
    // a run of its own, never one that takes the settled card back.
    const alone = structure(
      entries.filter((entry) => entry.id !== "launch-h1"),
      { latest: { id: "t2", state: "completed", completed: true } },
    );
    expect(alone.turns.map((each) => each.answer?.id ?? null)).toEqual(["a1", "a2"]);
  });

  // Review of pass 42: the words a run said before the work its helpers woke
  // it to were on the way, never its answer.
  // Review of pass 42: the files the turns its helpers woke changed went
  // unsaid, and the diff opened the first turn's alone.
  it("counts the files every turn of a run changed, its diff the whole run's", () => {
    const entries = [
      user("u1", 0),
      launched("h1", 1),
      assistant("a1", "t1", 2, "Started it."),
      finished("h1", 4),
      tool("w2", "t2", 5),
      assistant("a2", "t2", 6, ANSWER),
    ];
    const [run] = structure(entries, {
      latest: { id: "t2", state: "completed", completed: true },
    }).turns;
    const diffOf = (turnId: string, paths: ReadonlyArray<string>) =>
      ({
        turnId: turn(turnId),
        checkpointTurnCount: 1,
        checkpointRef: "ref" as TurnDiffSummary["checkpointRef"],
        status: "ready",
        files: paths.map((path) => ({ path, kind: "modified", additions: 5, deletions: 1 })),
        assistantMessageId: null,
        completedAt: at(9),
      }) as TurnDiffSummary;
    const outcome = deriveOutcome({
      turn: run!,
      landed: [],
      diffs: [diffOf("t1", ["a.ts", "b.ts"]), diffOf("t2", ["b.ts", "c.ts"])],
    });
    expect(outcome?.files).toEqual({
      count: 3,
      additions: 20,
      deletions: 4,
      turnId: turn("t2"),
      fromTurnId: turn("t1"),
    });
  });

  it("answers a run its helpers woke with its last turn's words alone", () => {
    const entries = [
      user("u1", 0),
      launched("h1", 1),
      assistant("a1", "t1", 2, ANSWER),
      finished("h1", 4),
      tool("w2", "t2", 5),
    ];
    const [run] = structure(entries, {
      latest: { id: "t2", state: "completed", completed: true },
    }).turns;
    expect(run!.span.turnIds).toEqual([turn("t1"), turn("t2")]);
    expect(run!.answer).toBeNull();
  });

  it("keeps a run waiting on the helpers it launched, its last words no answer yet", () => {
    const entries = [
      user("u1", 0),
      tool("w1", "t1", 1),
      launched("h1", 1),
      assistant("a1", "t1", 2, ANSWER),
    ];
    const latest = { id: "t1", state: "completed", completed: true };
    const settled = structure(entries, { latest });
    expect(settled.turns[0]!.waiting).toBe(false);
    expect(settled.turns[0]!.answer?.id).toBe("a1");
    const waiting = structure(entries, { latest, helpersAtWork: ["task-h1"] });
    expect(waiting.turns[0]!.waiting).toBe(true);
    expect(waiting.turns[0]!.live).toBe(false);
    expect(waiting.turns[0]!.answer).toBeNull();
    // Review of pass 42: work it never launched — a helper of another run, a
    // dev server, a watch — holds no run open, nor hides its answer.
    const other = structure(entries, { latest, helpersAtWork: ["task-elsewhere"] });
    expect(other.turns[0]).toMatchObject({ waiting: false, answer: { id: "a1" } });
  });

  // D4: the answer is decided when the run ends. While it runs, its words
  // are the working row's, however much they read as an answer.
  it("decides no answer while the run goes on", () => {
    const entries = [user("u1", 0), tool("w1", "t1", 1), assistant("a1", "t1", 2, ANSWER)];
    expect(structure(entries, { live: "t1" }).turns[0]!.answer).toBeNull();
    expect(
      structure(entries, { latest: { id: "t1", state: "completed", completed: true } }).turns[0]!
        .answer?.id,
    ).toBe("a1");
  });

  // "Stopped" is said only after the person's Stop: a run their message
  // interrupted says so.
  it("tells a run the person's message interrupted from one they stopped", () => {
    const interrupted = structure(
      // Their message came while the step ran: the run stopped for it.
      [
        user("u1", 0),
        tool("w1", "t1", 1, { toolLifecycleStatus: "inProgress" }),
        user("u2", 1),
        tool("w2", "t2", 3),
        assistant("a2", "t2", 4),
      ],
      { latest: { id: "t2", state: "completed", completed: true } },
    );
    expect(interrupted.turns[0]!.interrupted).toBe(true);
    expect(interrupted.turns[0]!.byMessage).toBe(true);
    const stopped = structure([user("u1", 0), tool("w1", "t1", 1)], {
      latest: { id: "t1", state: "interrupted", completed: true },
    });
    expect(stopped.turns[0]!.interrupted).toBe(true);
    expect(stopped.turns[0]!.byMessage).toBe(false);
    // The Stop ends the tasks the run started; a message leaves them running
    // (Rhea, run 11: stopped, then "continue" a minute later).
    const stoppedThenWritten = structure(
      [
        user("u1", 0),
        tool("w1", "t1", 1, { toolLifecycleStatus: "inProgress" }),
        tool("h1", "t1", 1, {
          sourceActivityKind: "task.completed",
          taskId: "task-h1",
          toolLifecycleStatus: "stopped",
        }),
        user("u2", 2),
        tool("w2", "t2", 3),
        assistant("a2", "t2", 4),
      ],
      { latest: { id: "t2", state: "completed", completed: true } },
    );
    expect(stoppedThenWritten.turns[0]!.interrupted).toBe(true);
    expect(stoppedThenWritten.turns[0]!.byMessage).toBe(false);
  });

  // Review of pass 42: a completion of the run's call filed under the turn
  // the person's message started cleared that message, and the run took it in.
  it("keeps the person's interrupting message the opener of its own run", () => {
    const built = structure(
      [
        user("u1", 0),
        tool("w1", "t1", 1, { toolLifecycleStatus: "inProgress", toolCallId: "call-c1" }),
        user("u2", 2),
        tool("w1done", "t2", 2, { toolCallId: "call-c1" }),
        tool("w2", "t2", 3),
        assistant("a2", "t2", 4),
      ],
      { latest: { id: "t2", state: "completed", completed: true } },
    );
    expect(built.turns.map((turn) => turn.span.opener?.id ?? null)).toEqual(["u1", "u2"]);
    expect(built.turns[0]!.interrupted).toBe(true);
  });

  it("never takes a woken turn into a run that launched no helper", () => {
    const compacted = structure(
      [
        user("u1", 0),
        assistant("a1", "t1", 1),
        user("cmd", 2, "/compact"),
        tool("cmp", "t2", 3, { sourceActivityKind: "context-compaction", label: "Compacted" }),
        tool("w3", "t3", 4),
        assistant("a3", "t3", 5),
      ],
      { latest: { id: "t3", state: "completed", completed: true } },
    );
    expect(compacted.turns.map((turn) => turn.span.turnIds.length)).toEqual([1, 1, 1]);
    const late = structure(
      [
        user("u1", 0),
        assistant("a1", "t1", 1),
        tool("w2", "t2", 1 + 61),
        assistant("a2", "t2", 63),
      ],
      { latest: { id: "t2", state: "completed", completed: true } },
    );
    expect(late.turns).toHaveLength(2);
  });
});

describe("the provider's refusal record", () => {
  it("retains the supplied reset instead of a rounded wait or an undated CLI hour", () => {
    const warning = tool("warning", "t1", 48);
    if (warning.kind !== "work") throw new Error("Expected a work entry");
    warning.entry = {
      ...warning.entry,
      tone: "info",
      sourceActivityKind: "runtime.warning",
      label: "Claude usage limit reached. resets in 4h 7m",
      usageLimit: { resetsAt: "2026-10-07T02:00:00.000Z" },
    };
    const [only] = structure(
      [
        user("m0", 0),
        warning,
        assistant("a1", "t1", 48, "You've hit your weekly limit · resets 2am (UTC)"),
      ],
      { latest: { id: "t1", state: "error", completed: true } },
    ).turns;
    expect(only?.limit).toMatchObject({ resetsAt: "2026-10-07T02:00:00.000Z" });
    expect(only?.limitOnly).toBe(true);
  });
});

it("a normal response after a provider rejection is not replaced by a limit card", () => {
  const warning = tool("warning", "t1", 1);
  if (warning.kind !== "work") throw new Error("Expected a work entry");
  warning.entry = {
    ...warning.entry,
    tone: "info",
    label: "Claude usage limit reached.",
    usageLimit: { resetsAt: "2026-10-07T02:00:00Z" },
  };
  const [only] = structure(
    [user("m0", 0), warning, assistant("a1", "t1", 48, "The work is done.")],
    { latest: { id: "t1", state: "completed", completed: true } },
  ).turns;
  expect(only?.limit).toBeNull();
  expect(only?.answer?.message.text).toBe("The work is done.");
});

it("a restart remains the cause on its turn after a later message", () => {
  const interruption = {
    turnId: turn("t1"),
    restart: { cause: "replaced" as const, at: at(2) },
    continuation: "manual" as const,
  };
  const entries = [
    user("m1", 0),
    tool("cut", "t1", 2, {
      sourceActivityKind: "runtime.interrupted",
      interruption,
      command: undefined as never,
    }),
    user("m2", 3),
    tool("w2", "t2", 4),
  ];
  const read = structure(entries, { latest: { id: "t2", state: "completed", completed: true } });
  expect(read.turns[0]?.interruption).toEqual(interruption);
  expect(read.turns[0]?.byMessage).toBe(false);
});

it("a restart before the provider acknowledges its first turn stays with the accepted message", () => {
  const opener = user("accepted", 0, "Inspect the service");
  if (opener.kind !== "message") throw new Error("Expected accepted message");
  const interruption = {
    turnId: null,
    messageId: opener.message.id,
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
      interruption,
      turnId: null,
      sourceActivityKind: "runtime.interrupted",
    },
  };
  const read = structure([opener, cut, user("next", 10, "Continue")]);
  expect(read.turns).toHaveLength(1);
  expect(read.turns[0]?.span.opener?.message.id).toBe(opener.message.id);
  expect(read.turns[0]?.interruption).toEqual(interruption);
  expect(read.turns[0]?.byMessage).toBe(false);
});
