import { RunRecord, type ConversationRow, type Item } from "@t3tools/contracts";
import {
  callItem,
  engineCardPagingOfRecords,
  engineRun,
  engineRunCardsOfRecords,
  engineThreadOfRecords,
  noteItem,
  personItem,
  workItem,
} from "@t3tools/client-runtime/data/fixtures";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import { runEffortWords } from "./runResult.logic";

const key = { environmentId: "env", conversationId: "conversation" };
const run1 = "conversation/r/1";
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
    call(8, 51_000, {
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
      ...workItem(run1, 9, {
        work: "conversation/s/1.6.w2",
        workKind: "shell",
        status: job,
        title: "Wait 45 seconds in the background, then print done",
      }),
      at: t0 + 51_450,
    } as Item,
    call(10, 54_900, {
      step: "tool",
      tool: { name: "WebFetch" },
      words: "Tool call",
      input: 'WebFetch: {"url":"https://example.com"}',
      shows: { toolName: "WebFetch", input: { url: "https://example.com" } },
    } as never),
    noteItem(run1, 11, "The background wait hasn't printed yet.", {
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
  answerItemId: `${run1}/i/11`,
  lastItemSeq: 11,
};

function render(input: {
  runs: RunRecord[];
  items: Item[];
  requests?: Request[];
  row?: ConversationRow;
  paged?: boolean;
  isWorking?: boolean;
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
      "1 file edited · 7 commands · 1 page fetched · 1 tool used · 1 helper",
    );
  });
});
