import {
  RunId,
  RunRecord,
  type ConversationRow,
  type Item,
  type Request,
} from "@t3tools/contracts";
import {
  callItem,
  engineCardPagingOfRecords,
  engineRequest,
  engineRow,
  engineRun,
  engineRunCardsOfRecords,
  engineThreadOfRecords,
  noteItem,
  personItem,
  workItem,
} from "@t3tools/client-runtime/data/fixtures";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { backgroundLineOf, jobItems } from "./backgroundLine.logic";
import { deriveMessagesTimelineRows, helperFinishesOf } from "./MessagesTimeline.logic";
import { nowLineOf, nowLineWords, workedWords } from "./runCard.logic";
import { runEffortWords } from "./runResult.logic";

const key = { environmentId: "env", conversationId: "conversation" };
const run1 = "conversation/r/1";
const run2 = "conversation/r/2";
const decode = Schema.decodeUnknownSync(RunRecord);
const t0 = 1_760_000_000_000;

/** A Mate's call as the engine records it: what it ran, when, and what it showed. */
const call = (
  ordinal: number,
  at: number,
  patch: Partial<Extract<Item, { kind: "call" }>> & Record<string, unknown>,
): Item =>
  ({
    ...callItem(run1, ordinal, patch),
    at: t0 + at,
    endedAt: patch.state === "running" ? null : t0 + at + 500,
  }) as Item;

const bash = (ordinal: number, at: number, command: string, description: string) =>
  call(ordinal, at, {
    step: "command",
    tool: { name: "Bash" },
    words: "Command run",
    input: `Bash: ${command}`,
    shows: { toolName: "Bash", command, input: { description } },
  } as never);

/** The stress run: a plan, a Zerops look, a script written then edited, commands, a job, a fetch. */
function stressItems(job: "running" | "completed"): Item[] {
  return [
    personItem(run1, 1, "Run the stress checks", { at: t0 }),
    noteItem(run1, 2, "Here's the plan.", { answer: false, at: t0 + 32_600 }),
    bash(3, 39_000, "mkdir -p /tmp/s && node --version", "Create the scratch folder"),
    call(4, 39_100, {
      step: "edit",
      tool: { name: "Write" },
      words: "File change",
      input: 'Write: {"file_path":"/tmp/s/primes.js"}',
      shows: { toolName: "Write", input: { file_path: "/tmp/s/primes.js" }, wrote: true },
    } as never),
    bash(5, 42_600, "node /tmp/s/primes.js", "Run the primes script for 20 primes"),
    call(6, 43_800, {
      step: "edit",
      tool: { name: "Edit" },
      words: "File change",
      input: 'Edit: {"file_path":"/tmp/s/primes.js"}',
      shows: { toolName: "Edit", input: { file_path: "/tmp/s/primes.js" }, wrote: true },
    } as never),
    bash(7, 45_900, "node /tmp/s/primes.js", "Run the primes script for 30 primes"),
    {
      ...bash(8, 48_600, "ls /does-not-exist", "List a folder that doesn't exist, on purpose"),
      state: "failed",
    } as Item,
    call(9, 51_000, {
      step: "command",
      tool: { name: "Bash" },
      words: "Command run",
      input: "Bash: sleep 45 && echo done",
      shows: {
        toolName: "Bash",
        command: "sleep 45 && echo done",
        input: { description: "Wait 45 seconds in the background, then print done" },
        rawOutput: {
          content:
            "Command running in background with ID: b1job. Output is being written to: /tmp/…",
        },
      },
    } as never),
    {
      ...workItem(run1, 10, {
        work: "conversation/s/1.6.w2",
        workKind: "shell",
        status: job,
        title: "Wait 45 seconds in the background, then print done",
      }),
      at: t0 + 51_450,
    } as Item,
    call(11, 54_900, {
      step: "tool",
      tool: { name: "WebFetch" },
      words: "Tool call",
      input: 'WebFetch: {"url":"https://example.com"}',
      shows: { toolName: "WebFetch", input: { url: "https://example.com" } },
    } as never),
    noteItem(run1, 12, "The background wait hasn't printed yet.", {
      answer: false,
      at: t0 + 77_700,
    }),
  ];
}

const stressSummary = {
  items: 30,
  calls: { command: 7, edit: 2, helper: 1, mcp: 1, tool: 3 },
  tools: { AskUserQuestion: 1, ToolSearch: 1, WebFetch: 1, zerops_discover: 1 },
  edited: 1,
  answerItemId: `${run1}/i/12`,
  lastItemSeq: 12,
};

function render(input: {
  runs: RunRecord[];
  items: Item[];
  requests?: Request[];
  row?: ConversationRow;
  paged?: boolean;
  isWorking?: boolean;
  /** The helpers' finishes, from their fold, as the conversation passes them. */
  helpers?: boolean;
}) {
  const records = {
    runs: input.runs.map((run) => decode(run)),
    items: input.items,
    ...(input.requests === undefined ? {} : { requests: input.requests }),
    ...(input.row === undefined ? {} : { row: input.row }),
    ...(input.paged ? { spans: [{ runId: run1, from: null, to: 0, reading: null }] } : {}),
  };
  const thread = engineThreadOfRecords(key, records)!;
  return deriveMessagesTimelineRows({
    runCards: engineRunCardsOfRecords(key, records)!,
    timelineEntries: deriveTimelineEntries(
      thread.messages as ReadonlyArray<ChatMessage>,
      [],
      deriveWorkLogEntries(thread.activities),
    ),
    latestTurn: thread.latestTurn,
    isWorking: input.isWorking ?? false,
    activeTurnStartedAt: null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    ...(input.paged ? { cardPaging: engineCardPagingOfRecords(key, records) } : {}),
    ...(input.helpers
      ? {
          helperFinishes: helperFinishesOf(
            deriveAgentPanelModel({
              agents: foldSubagentActivities(thread.activities, { sessionLive: true }),
            }),
          ),
        }
      : {}),
  });
}

const stressRun = (patch: Partial<RunRecord> = {}) =>
  engineRun(key.conversationId, 1, {
    queuedAt: t0,
    admittedAt: t0,
    startedAt: t0 + 22_900,
    endedAt: t0 + 77_800,
    summary: stressSummary,
    ...patch,
  } as never);

const cardOf = (rows: ReturnType<typeof render>) => {
  const card = rows.find((row) => row.kind === "record" && row.turnId === run1);
  if (card?.kind !== "record") throw new Error("no card");
  return card;
};

describe("an engine Mate's run card, from the engine's record", () => {
  it.each([
    { held: "every item, as it streamed in live", paged: false },
    { held: "only what a reload reads", paged: true },
  ])("its worked line counts what the engine recorded, holding $held", ({ paged }) => {
    const card = cardOf(
      render({
        runs: [stressRun()],
        items: paged ? stressItems("completed").slice(0, 1) : stressItems("completed"),
        paged,
      }),
    );
    expect(runEffortWords(card.outcome)).toBe(
      "1 file edited · 7 commands · 1 page fetched · 2 tools used · 1 helper",
    );
  });

  it("its worked time is the time its runs ran, less the person's answer: never its queue or its wait on a job", () => {
    // Queued 22.9 s before it started; asked at +61.4 s, answered at +70.0 s; ended at +77.8 s,
    // its job ran on to +96.7 s with no answer given, and the run the job's end woke went on in
    // its card from +101.4 s to +103.3 s.
    const question = engineRequest(
      run1,
      1,
      {
        kind: "question",
        questions: [
          {
            id: "format",
            header: "Format",
            question: "How should the final summary be laid out?",
            options: [{ label: "Table", description: "One row per step" }],
            multiSelect: false,
          },
        ],
      } as never,
      {
        at: t0 + 61_400,
        state: "answered",
        answer: {
          by: { kind: "person", subject: "user-ada" },
          at: t0 + 70_000,
          summary: "Table",
          answers: { format: "Table" },
        },
      } as never,
    );
    const rows = render({
      runs: [
        stressRun({ summary: { ...stressSummary, answerItemId: null } } as never),
        engineRun(key.conversationId, 2, {
          trigger: { kind: "wake", cause: "self", wakeId: null },
          joins: RunId.make(run1),
          queuedAt: t0 + 101_400,
          admittedAt: t0 + 101_400,
          startedAt: t0 + 101_400,
          endedAt: t0 + 103_300,
        } as never),
      ],
      items: [
        ...stressItems("completed").slice(0, -1),
        {
          ...noteItem(run1, 13, ""),
          kind: "request",
          by: { kind: "engine" },
          requestId: question.id,
          at: t0 + 61_400,
        } as unknown as Item,
        noteItem(run2, 20, "All nine steps finished.", { at: t0 + 101_500 }),
      ],
      requests: [question],
    });
    expect(workedWords("Milo", cardOf(rows).status!)).toBe("Milo worked 48s");
  });

  /** What the card's line says, live or settled. */
  const lineOf = (card: ReturnType<typeof cardOf>) =>
    nowLineWords(
      nowLineOf({
        status: card.status!,
        now: card.now,
        answering: card.answering,
        compacting: false,
        speaker: "Milo",
        effort: runEffortWords(card.outcome),
      }),
    );

  it.each([
    {
      when: "the change that ended its run",
      row: { kind: "working", since: t0 + 22_900, waitsOnHelpers: false } as const,
    },
    {
      when: "the row's word that it waits",
      row: { kind: "working", since: t0 + 77_800, waitsOnHelpers: true } as const,
    },
  ])(
    "its run over while its background command runs, it waits on that command from $when",
    ({ row }) => {
      const card = cardOf(
        render({
          runs: [stressRun()],
          items: stressItems("running"),
          row: engineRow(key.environmentId, key.conversationId, {
            state: row,
            latestRun: {
              id: RunId.make(run1),
              end: { kind: "completed" },
              endedAt: t0 + 77_800,
              turnState: "completed",
            },
          }),
        }),
      );
      expect(card.status?.live).toBe(true);
      expect(lineOf(card)).toBe("Waiting for its background command");
    },
  );

  it("its background command done, it settles though the row still says it waits", () => {
    const card = cardOf(
      render({
        runs: [stressRun()],
        items: stressItems("completed"),
        row: engineRow(key.environmentId, key.conversationId, {
          state: { kind: "working", since: t0 + 77_800, waitsOnHelpers: true },
          latestRun: {
            id: RunId.make(run1),
            end: { kind: "completed" },
            endedAt: t0 + 77_800,
            turnState: "completed",
          },
        }),
      }),
    );
    expect(card.status?.live).toBe(false);
    expect(lineOf(card)).toMatch(/^Milo worked /);
  });

  // Milo's stress run 4, A and C: the helper finished, the card folded to "Milo worked 22s", and
  // 1.9 s later the turn its end woke opened it again.
  it.each([
    { work: "helper" as const, due: true, live: true },
    { work: "shell" as const, due: true, live: true },
    { work: "helper" as const, due: false, live: false },
  ])(
    "a helper finishing never folds the card before the wake it causes: a $work, the turn due $due",
    ({ work, due, live }) => {
      const items = stressItems("completed").map((item) =>
        item.kind === "work" ? ({ ...item, workKind: work } as Item) : item,
      );
      const card = cardOf(
        render({
          runs: [stressRun()],
          items,
          row: engineRow(key.environmentId, key.conversationId, {
            state: due
              ? { kind: "working", since: t0 + 77_800, waitsOnHelpers: true, turnDue: true }
              : { kind: "idle" },
            latestRun: {
              id: RunId.make(run1),
              end: { kind: "completed" },
              endedAt: t0 + 77_800,
              turnState: "completed",
            },
          }),
        }),
      );
      expect(card.status?.live).toBe(live);
      if (!live) expect(lineOf(card)).toMatch(/^Milo worked /);
    },
  );

  it.each([
    { tool: "Bash", words: "Command run", line: "Running a command" },
    { tool: "WebFetch", words: "Tool call", line: "Reading a page" },
  ])(
    "a $tool call whose input has not arrived reads $line, never its empty input",
    ({ tool, words, line }) => {
      const rows = render({
        runs: [stressRun({ state: "running", endedAt: null, end: null } as never)],
        items: [
          personItem(run1, 1, "Run the stress checks", { at: t0 }),
          call(2, 45_900, {
            step: tool === "Bash" ? "command" : "tool",
            tool: { name: tool },
            words,
            state: "running",
            input: `${tool}: {}`,
            shows: { toolName: tool },
          } as never),
        ],
        isWorking: true,
      });
      expect(lineOf(cardOf(rows))).toBe(line);
    },
  );

  it.each([
    { state: "admitted", line: "Saving a snapshot of the workspace" },
    { state: "sending", line: "Starting its session" },
  ] as const)(
    "a run its engine holds $state before it starts says what it waits on: $line",
    ({ state, line }) => {
      const rows = render({
        runs: [
          stressRun({
            state,
            startedAt: null,
            endedAt: null,
            end: null,
          } as never),
        ],
        items: [personItem(run1, 1, "Run the stress checks", { at: t0 })],
        isWorking: true,
      });
      expect(lineOf(cardOf(rows))).toBe(line);
    },
  );

  it("its job's line says the job ended once the engine records it ended, whatever command ended near its start", () => {
    const rows = render({ runs: [stressRun()], items: stressItems("completed") });
    const jobs = rows.flatMap((row) => (row.kind === "background" ? (row.jobs ?? []) : []));
    expect(jobs.map(({ title, state }) => ({ title, state }))).toEqual([
      { title: "Wait 45 seconds in the background, then print done", state: "done" },
    ]);
  });

  // Milo's second stress run: the failure was painted on the 20-second job, the failing one read
  // "In the background", and a job Milo stopped counted as finished.
  it("each background job says what the engine recorded of it, a stopped one as stopped", () => {
    const sent = (ordinal: number, at: number, id: string, description: string) =>
      call(ordinal, at, {
        step: "command",
        tool: { name: "Bash" },
        words: "Command run",
        input: `Bash: ${description}`,
        shows: {
          toolName: "Bash",
          command: description,
          input: { description },
          rawOutput: {
            content: `Command running in background with ID: ${id}. Output is being written to: /tmp/x`,
          },
        },
      } as never);
    const job = (ordinal: number, at: number, description: string, status: string) =>
      ({
        ...workItem(run1, ordinal, {
          work: `conversation/s/1.w${ordinal}`,
          workKind: "shell",
          status: status as never,
          title: description,
        }),
        at: t0 + at,
      }) as Item;
    const rows = render({
      runs: [stressRun()],
      items: [
        personItem(run1, 1, "Start three jobs", { at: t0 }),
        sent(2, 56_000, "b1", "Wait 20 seconds, print short"),
        sent(3, 56_600, "b2", "Wait 120 seconds, print long"),
        sent(4, 57_200, "b3", "Exit with code 3"),
        job(5, 56_450, "Wait 20 seconds, print short", "completed"),
        job(6, 57_050, "Wait 120 seconds, print long", "stopped"),
        job(7, 57_650, "Exit with code 3", "failed"),
        noteItem(run1, 8, "All three are done.", { at: t0 + 77_700 }),
      ],
    });
    const jobs = rows.flatMap((row) => (row.kind === "background" ? (row.jobs ?? []) : []));
    expect(jobs.map(({ title, state }) => [title, state])).toEqual([
      ["Wait 20 seconds, print short", "done"],
      ["Wait 120 seconds, print long", "stopped"],
      ["Exit with code 3", "failed"],
    ]);
    expect(backgroundLineOf(jobItems(jobs), false).words).toBe(
      "3 background jobs: 1 finished, 1 failed, 1 stopped",
    );
  });

  // Milo's second stress run: a helper's own background sleep and poll read as Milo's rows,
  // "Sleep 40 seconds then print marker finished · in the background".
  it("a helper's own background job is the helper's, never a row of the Mate's card", () => {
    const description = "Sleep 40 seconds then print marker";
    const rows = render({
      runs: [stressRun()],
      items: [
        personItem(run1, 1, "Start two helpers", { at: t0 }),
        call(2, 40_000, {
          step: "helper",
          tool: { name: "Agent" },
          words: "Subagent task",
          input: "Helper A: background sleep",
          shows: { toolName: "Agent", input: { description: "Helper A: background sleep" } },
        } as never),
        {
          ...call(3, 42_000, {
            step: "command",
            tool: { name: "Bash" },
            words: "Command run",
            input: `Bash: sleep 40 && echo marker`,
            shows: {
              toolName: "Bash",
              command: "sleep 40 && echo marker",
              input: { description },
              rawOutput: {
                content:
                  "Command running in background with ID: bh1. Output is being written to: /tmp/x",
              },
            },
          } as never),
          by: { kind: "helper", helperId: "conversation/s/1.w2" },
        } as Item,
        {
          ...workItem(run1, 4, {
            work: "conversation/s/1.w3",
            workKind: "shell",
            status: "completed",
            title: description,
          }),
          // The engine records whose it is: the helper whose own command started it.
          by: { kind: "helper", helperId: "conversation/s/1.w2" },
          at: t0 + 42_400,
        } as Item,
        noteItem(run1, 5, "Both helpers are back.", { at: t0 + 77_700 }),
      ],
    });
    const card = cardOf(rows);
    const said = JSON.stringify([card.items, rows.filter((row) => row.kind === "background")]);
    expect(said).not.toContain(description);
  });

  // Milo's third stress run: the steer stood above the card and again inside it, live; a reload
  // drew it once. Engine #158 steers a waiting message into a turn Claude opened on its own: that
  // turn is the message's run, on the card it goes on in.
  const steer = "also tell me the page title";
  it.each([
    { into: "the running run", held: "every item", own: false, paged: false },
    { into: "the running run", held: "what a reload reads", own: false, paged: true },
    { into: "a turn Claude opened on its own", held: "every item", own: true, paged: false },
    {
      into: "a turn Claude opened on its own",
      held: "what a reload reads",
      own: true,
      paged: true,
    },
  ])(
    "a message steered into $into is drawn once, above its card, holding $held",
    ({ own, paged }) => {
      const into = own ? run2 : run1;
      const runs = [
        stressRun(),
        ...(own
          ? [
              engineRun(key.conversationId, 2, {
                trigger: { kind: "wake", cause: "self", wakeId: null },
                joins: RunId.make(run1),
                queuedAt: t0 + 80_000,
                admittedAt: t0 + 80_000,
                startedAt: t0 + 80_000,
                endedAt: t0 + 90_000,
              } as never),
            ]
          : []),
      ];
      const items = [
        personItem(run1, 1, "Run the stress checks", { at: t0 }),
        bash(2, 39_000, "node --version", "Check the node version"),
        personItem(into, own ? 20 : 3, steer, {
          at: t0 + (own ? 80_000 : 40_000),
          delivery: { state: "steered", at: t0 + (own ? 80_000 : 40_000) },
        }),
        noteItem(into, own ? 21 : 4, "Both titles read Shop.", { at: t0 + 85_000 }),
      ];
      // A reload holds every message the person sent, and none of a closed card's lines.
      const rows = render({
        runs,
        items: paged ? items.filter((item) => item.kind === "person") : items,
        paged,
      });
      const drawn = rows.filter(
        (row) =>
          row.kind === "message" && row.message.role === "user" && row.message.text === steer,
      );
      const marked = rows.flatMap((row) =>
        row.kind === "record" ? row.items.filter((item) => item.kind === "person") : [],
      );
      expect({ drawn: drawn.length, marked: marked.length }).toEqual({ drawn: 1, marked: 0 });
    },
  );
});
// Milo's third stress run: a job's end woke Milo, the reply under the folded card ("…hasn't
// printed yet") vanished into it, and the final answer landed 798 px below the view.
it.each([
  { wake: "still at work", answered: false },
  { wake: "answered", answered: true },
])(
  "a wake's answer appears under the reply the person was reading, which stays where it stood: the wake $wake",
  ({ answered }) => {
    const first = noteItem(run1, 12, "The background wait hasn't printed yet.", {
      at: t0 + 77_700,
      answer: true,
    } as never);
    const rows = render({
      runs: [
        stressRun({
          summary: { ...stressSummary, answerItemId: `${run1}/i/12` },
        } as never),
        engineRun(key.conversationId, 2, {
          trigger: { kind: "wake", cause: "self", wakeId: null },
          joins: RunId.make(run1),
          queuedAt: t0 + 101_400,
          admittedAt: t0 + 101_400,
          startedAt: t0 + 101_400,
          ...(answered
            ? {
                endedAt: t0 + 103_300,
                summary: {
                  items: 2,
                  calls: { command: 1 },
                  answerItemId: `${run2}/i/21`,
                  lastItemSeq: 21,
                },
              }
            : { state: "running", turnState: "running", endedAt: null, end: null }),
        } as never),
      ],
      items: [
        ...stressItems("completed").slice(0, -1),
        first,
        {
          ...bash(20, 101_500, "cat /tmp/s/out", "Read what the wait printed"),
          runId: run2,
          id: `${run2}/i/20`,
        } as Item,
        ...(answered
          ? [noteItem(run2, 21, "It printed done.", { at: t0 + 103_000, answer: true } as never)]
          : []),
      ],
      isWorking: !answered,
    });
    const said = rows.flatMap((row) =>
      row.kind === "message" && row.message.role === "assistant" ? [row.message.text] : [],
    );
    expect(said).toEqual([
      "The background wait hasn't printed yet.",
      ...(answered ? ["It printed done."] : []),
    ]);
    // The reply stands under its card, the wake's answer under it.
    const card = rows.findIndex((row) => row.kind === "record");
    const reply = rows.findIndex((row) => row.kind === "message" && row.id === first.id);
    expect(card).toBeLessThan(reply);
  },
);

// Milo's stress run 4A: the job's end woke Milo, and the card holding the wake's work stood above
// the answer Milo gave before it ("…Now waiting for the jobs to end."): time read backwards.
it.each([
  { cause: "self", wake: "still at work", answered: false },
  { cause: "self", wake: "answered", answered: true },
  { cause: "lost-work", wake: "answered", answered: true },
])(
  "a turn the agent opens itself after a background job ends stands below the answer it gave before: a $cause wake $wake",
  ({ cause, answered }) => {
    const before = noteItem(run1, 12, "Now waiting for the jobs to end.", {
      at: t0 + 77_700,
      answer: true,
    } as never);
    const rows = render({
      runs: [
        stressRun({ summary: { ...stressSummary, answerItemId: `${run1}/i/12` } } as never),
        engineRun(key.conversationId, 2, {
          trigger: { kind: "wake", cause, wakeId: null },
          joins: RunId.make(run1),
          queuedAt: t0 + 101_400,
          admittedAt: t0 + 101_400,
          startedAt: t0 + 101_400,
          ...(answered
            ? {
                endedAt: t0 + 103_300,
                summary: {
                  items: 2,
                  calls: { command: 1 },
                  answerItemId: `${run2}/i/21`,
                  lastItemSeq: 21,
                },
              }
            : { state: "running", turnState: "running", endedAt: null, end: null }),
        } as never),
      ],
      items: [
        ...stressItems("completed").slice(0, -1),
        before,
        {
          ...bash(20, 101_500, "cat /tmp/s/out", "Read what the job printed"),
          runId: run2,
          id: `${run2}/i/20`,
        } as Item,
        ...(answered
          ? [noteItem(run2, 21, "Job B ended first.", { at: t0 + 103_000, answer: true } as never)]
          : []),
      ],
      isWorking: !answered,
    });
    const read = rows.flatMap((row) =>
      row.kind === "record"
        ? [`card of ${row.turnId}`]
        : row.kind === "message" && row.message.role === "assistant"
          ? [row.message.text]
          : [],
    );
    expect(read).toEqual([
      `card of ${run1}`,
      "Now waiting for the jobs to end.",
      `card of ${run2}`,
      ...(answered ? ["Job B ended first."] : []),
    ]);
  },
);

// Milo's stress run 4A: the second wave a wake started joined the first wave's "Started 5 helpers".
it.each([
  { first: "left no answer", answered: false },
  { first: "answered", answered: true },
])(
  "helpers a wake starts stand where it started them, never in the first wave's group: the first run $first",
  ({ answered }) => {
    const helper = (runId: string, ordinal: number, at: number, title: string) =>
      ({
        ...workItem(runId, ordinal, { work: `w-${runId}-${ordinal}`, status: "completed", title }),
        at: t0 + at,
      }) as Item;
    const rows = render({
      runs: [
        stressRun({
          endedAt: t0 + 20_000,
          summary: {
            items: 3,
            calls: { helper: 2 },
            answerItemId: answered ? `${run1}/i/4` : null,
            lastItemSeq: 4,
          },
        } as never),
        engineRun(key.conversationId, 2, {
          trigger: { kind: "wake", cause: "self", wakeId: null },
          joins: RunId.make(run1),
          queuedAt: t0 + 30_000,
          admittedAt: t0 + 30_000,
          startedAt: t0 + 30_000,
          endedAt: t0 + 40_000,
          summary: { items: 2, calls: { helper: 1 }, answerItemId: null, lastItemSeq: 2 },
        } as never),
      ],
      items: [
        personItem(run1, 1, "Run the stress checks", { at: t0 }),
        helper(run1, 2, 1_000, "Helper A"),
        helper(run1, 3, 1_100, "Helper B"),
        ...(answered
          ? [noteItem(run1, 4, "Both helpers are off.", { at: t0 + 19_000, answer: true } as never)]
          : []),
        helper(run2, 1, 31_000, "Second wave 1"),
      ],
    });
    const groups = rows.flatMap((row) =>
      row.kind === "record"
        ? row.items.flatMap((item) =>
            item.kind === "helpers" ? [item.entry.agentSpawn?.agentTaskIds.length ?? 0] : [],
          )
        : [],
    );
    expect(groups).toEqual([2, 1]);
  },
);

// Milo's stress run 5 (A +1:37.6): wake 92 fired as a planned restart began and only spoke, so it
// drew no card of its own; the wake after the restart was headed by the helper it had itself started
// after a reload, and by nothing live: the engine dated a job's end at its start.
it.each([
  { held: "live, every line as it streamed in", reload: false },
  { held: "after a reload, the wake's first lines not paged in yet", reload: true },
])(
  "a wake that fires while the Mate restarts gets its card, the same live and after a reload: $held",
  ({ reload }) => {
    const run3 = "conversation/r/3";
    const ended = (at: number) => ({ endedAt: t0 + at });
    const work = (runId: string, n: number, at: number, patch: Record<string, unknown>) =>
      ({ ...workItem(runId, n, patch as never), at: t0 + at }) as Item;
    const rows = render({
      runs: [
        stressRun({
          endedAt: t0 + 20_000,
          summary: { items: 4, calls: { helper: 2 }, answerItemId: `${run1}/i/4`, lastItemSeq: 4 },
        } as never),
        engineRun(key.conversationId, 2, {
          trigger: { kind: "wake", cause: "self", wakeId: null },
          joins: RunId.make(run1),
          queuedAt: t0 + 30_000,
          admittedAt: t0 + 30_000,
          startedAt: t0 + 30_000,
          endedAt: t0 + 31_000,
          summary: { items: 1, calls: {}, answerItemId: `${run2}/i/1`, lastItemSeq: 1 },
        } as never),
        engineRun(key.conversationId, 3, {
          trigger: { kind: "wake", cause: "lost-work", wakeId: null },
          queuedAt: t0 + 50_000,
          admittedAt: t0 + 50_000,
          startedAt: t0 + 50_000,
          endedAt: t0 + 90_000,
          summary: {
            items: 4,
            calls: { command: 1, helper: 1 },
            answerItemId: `${run3}/i/4`,
            lastItemSeq: 4,
          },
        } as never),
      ],
      items: [
        personItem(run1, 1, "Run the stress checks", { at: t0 }),
        work(run1, 2, 1_000, {
          work: "w2",
          title: "Second wave 2",
          status: "completed",
          ...ended(29_000),
        }),
        work(run1, 3, 1_100, {
          work: "w3",
          title: "Second wave 3",
          status: "lost",
          ...ended(45_000),
        }),
        noteItem(run1, 4, "Two second-wave helpers are running.", {
          at: t0 + 19_000,
          answer: true,
        } as never),
        noteItem(run2, 1, "The second second-wave helper is back.", {
          at: t0 + 30_500,
          answer: true,
        } as never),
        ...(reload
          ? []
          : [
              {
                ...bash(1, 50_500, "cat /tmp/notes", "Read the notes"),
                runId: run3,
                id: `${run3}/i/1`,
              } as Item,
            ]),
        work(run3, 3, 77_000, {
          work: "w4",
          title: "Second wave 3, again",
          status: "completed",
          ...ended(85_000),
        }),
        noteItem(run3, 4, "The third second-wave helper ran again.", {
          at: t0 + 89_000,
          answer: true,
        } as never),
      ],
      helpers: true,
    });
    const read = rows.flatMap((row) =>
      row.kind === "record" || row.kind === "work-line"
        ? [`card of ${row.turnId}`]
        : row.kind === "background" && row.id.startsWith("woke:")
          ? [`woke by ${row.title}`]
          : row.kind === "message" && row.message.role === "assistant"
            ? [row.message.text]
            : [],
    );
    expect(read).toEqual([
      `card of ${run1}`,
      "Two second-wave helpers are running.",
      "woke by Second wave 2",
      `card of ${run2}`,
      "The second second-wave helper is back.",
      "woke by Second wave 3",
      `card of ${run3}`,
      "The third second-wave helper ran again.",
    ]);
  },
);

// The oracle's deep seeds: a run that only wrote to the person read "thought" live and "worked"
// after a reload, its summary's notes counted as work. Run 4 (2026-10-10): a 32-line answer with no
// tools read "Milo thought 11s" — it wrote, and says so, live and after a reload alike.
it.each([
  { held: "every item, as it streamed in live", paged: false },
  { held: "only what a reload reads", paged: true },
])("a run that only wrote to the person says it wrote, holding $held", ({ paged }) => {
  const run = stressRun({
    summary: { items: 3, calls: {}, answerItemId: `${run1}/i/3`, lastItemSeq: 3 },
  } as never);
  const items = [
    personItem(run1, 1, "How does it look?", { at: t0 }),
    noteItem(run1, 2, "Reading the plan.", { answer: false, at: t0 + 30_000 }),
    noteItem(run1, 3, "It looks fine.", { at: t0 + 40_000, answer: true } as never),
  ];
  const card = cardOf(render({ runs: [run], items: paged ? items.slice(0, 1) : items, paged }));
  expect(workedWords("Milo", card.status!)).toMatch(/^Milo wrote /);
});

// Milo's stress run 4 (morning): the card read "paused at the limit · 36s · 1 command" live and
// "· 36s" after a reload. Every word of a settled card's summary is one function of the records,
// whatever a reload holds of its run.
it.each([
  { ended: "completed", end: { kind: "completed" } },
  {
    ended: "stopped by the person",
    end: { kind: "stopped", by: { kind: "person", subject: "user-ada" } },
  },
  { ended: "failed", end: { kind: "failed", reason: "The agent's process exited", next: null } },
  { ended: "crashed", end: { kind: "crashed", reason: "The agent's process exited" } },
  {
    ended: "cut by a restart",
    end: { kind: "cut-by-restart", continuedBy: null, notContinued: "restarted" },
  },
  { ended: "at the usage limit", end: { kind: "usage-limit", resetsAt: null } },
] as const)("a run card's summary is the same live and after a reload: $ended", ({ end }) => {
  // A reload holds the person's message and the run's last words, none of its work.
  const answer = noteItem(
    run1,
    12,
    end.kind === "usage-limit"
      ? "You've hit your weekly limit · resets Oct 11, 11am (UTC)"
      : "The background wait hasn't printed yet.",
    { answer: false, at: t0 + 77_700 },
  );
  const items = [...stressItems("completed").slice(0, -1), answer];
  const summaryOf = (paged: boolean) => {
    const card = cardOf(
      render({
        runs: [stressRun({ end } as never)],
        items: paged ? [items[0]!, answer] : items,
        paged,
      }),
    );
    return [workedWords("Milo", card.status!), runEffortWords(card.outcome)];
  };
  expect(summaryOf(true)).toEqual(summaryOf(false));
});
