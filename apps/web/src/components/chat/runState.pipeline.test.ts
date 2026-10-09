import { RunId, RunRecord, type ConversationRowState, type RunEnd } from "@t3tools/contracts";
import {
  engineRun,
  engineRow,
  engineThreadOfRecords,
  engineRunCardsOfRecords,
  engineCardPagingOfRecords,
  noteItem,
  personItem,
  callItem,
} from "@t3tools/client-runtime/data/fixtures";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";

const key = { environmentId: "env", conversationId: "conversation" };
const first = "conversation/r/1";
const decode = Schema.decodeUnknownSync(RunRecord);

function render(
  end: RunEnd,
  tail: "tool" | "answer" | "unheld" | "not-started",
  historical = true,
  joined = false,
  state?: ConversationRowState,
) {
  const firstRun = engineRun(key.conversationId, 1, {
    end,
    ...(tail === "not-started" ? { startedAt: null } : {}),
    summary: { items: 3, calls: { command: 1 }, answerItemId: null, lastItemSeq: 3 },
  });
  const rawRuns = [
    firstRun,
    ...(historical || joined
      ? [
          engineRun(key.conversationId, 2, {
            joins: joined ? RunId.make(first) : null,
          }),
        ]
      : []),
  ];
  // Server-projected records -> wire contract -> account facts -> real timeline consumer.
  // EngineWire.test proves the server emits these verdicts from the recorded ends.
  const runs = rawRuns.map((run) => decode(run));
  const records = {
    runs,
    ...(state === undefined
      ? {}
      : {
          row: engineRow(key.environmentId, key.conversationId, {
            state,
            latestRun: {
              id: runs.at(-1)!.id,
              end: runs.at(-1)!.end,
              endedAt: runs.at(-1)!.endedAt,
              turnState: runs.at(-1)!.turnState ?? null,
            },
          }),
        }),
    ...(tail === "unheld" ? { spans: [{ runId: first, from: null, to: 0, reading: null }] } : {}),
    items: [
      personItem(first, 1, "Start"),
      ...(tail === "unheld" || tail === "not-started" ? [] : [callItem(first, 2)]),
      ...(tail === "answer" ? [noteItem(first, 3, "Words before the end")] : []),
      ...(runs[1] === undefined
        ? []
        : [personItem(runs[1].id, 4, "Next"), noteItem(runs[1].id, 5, "Done")]),
    ],
  };
  const thread = engineThreadOfRecords(key, records)!;
  const rows = deriveMessagesTimelineRows({
    runCards: engineRunCardsOfRecords(key, records)!,
    timelineEntries: deriveTimelineEntries(
      thread.messages as ReadonlyArray<ChatMessage>,
      [],
      deriveWorkLogEntries(thread.activities),
    ),
    latestTurn: thread.latestTurn,
    isWorking: false,
    activeTurnStartedAt: null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    ...(tail === "unheld" ? { cardPaging: engineCardPagingOfRecords(key, records) } : {}),
  });
  const card = rows.find(
    (row) => (row.kind === "record" || row.kind === "work-line") && row.turnId === first,
  );
  return card?.kind === "record" ? card.status : card?.kind === "work-line" ? card : null;
}

describe("the engine's run verdict on a conversation card", () => {
  // Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).
  it.each([
    { end: { kind: "completed" }, tail: "tool", face: "idle" },
    {
      end: { kind: "stopped", by: { kind: "person", subject: "ana" } },
      tail: "answer",
      face: "stopped",
    },
    { end: { kind: "unknown", type: "new-ending" }, tail: "tool", face: "idle" },
  ] satisfies Array<{ end: RunEnd; tail: "tool" | "answer"; face: string }>)(
    "a historical $end.kind run keeps its verdict with a $tail tail",
    ({ end, tail, face }) => expect(render(end, tail)?.face).toBe(face),
  );

  it.each(["tool", "answer", "unheld"] as const)(
    "a stopped run remains stopped with $tail work, without guessing a message caused it",
    (tail) =>
      expect(render({ kind: "stopped", by: { kind: "person", subject: "ana" } }, tail)?.face).toBe(
        "stopped",
      ),
  );

  it.each(["tool", "answer", "unheld"] as const)(
    "a failed run retains its reason with $tail work and only its latest card offers the next action",
    (tail) => {
      const end = {
        kind: "failed",
        reason: "A reason with no sentence boundary",
        next: "Choose another model",
      } as const;
      expect(render(end, tail)).toMatchObject({
        face: "brokeOff",
        brokeOff: { reason: end.reason, next: null },
      });
      expect(render(end, tail, false)).toMatchObject({
        face: "brokeOff",
        brokeOff: { reason: end.reason, next: end.next },
      });
    },
  );

  it("a crashed run keeps the recorded reason rather than parsing its last words", () => {
    expect(
      render(
        { kind: "crashed", reason: "Worker exited; this whole string is the reason" },
        "answer",
      ),
    ).toMatchObject({
      face: "brokeOff",
      brokeOff: { reason: "Worker exited; this whole string is the reason", next: null },
    });
  });

  it("a failed start still shows the recorded reason beside the exact message that requested it", () => {
    expect(
      render(
        { kind: "failed", reason: "Could not start the agent", next: "Choose another model" },
        "not-started",
        false,
      ),
    ).toMatchObject({
      face: "brokeOff",
      brokeOff: { reason: "Could not start the agent", next: "Choose another model" },
    });
  });

  it("background work waits only while the server row says the card waits on helpers", () => {
    expect(
      render({ kind: "completed" }, "unheld", false, false, {
        kind: "working",
        since: 1,
        waitsOnHelpers: true,
      })?.live,
    ).toBe(true);
    expect(render({ kind: "completed" }, "unheld", false, false, { kind: "idle" })?.live).toBe(
      false,
    );
  });

  it.each([
    { continuedBy: null, notContinued: undefined, continuation: "automatic" },
    {
      continuedBy: RunId.make("conversation/r/2"),
      notContinued: undefined,
      continuation: "continued",
    },
    { continuedBy: null, notContinued: "a Stop was asked", continuation: "none" },
  ])(
    "restart continuation is carried to the real card as $continuation",
    ({ continuedBy, notContinued, continuation }) => {
      const restart = { cause: "replaced" as const, at: "2026-10-08T08:24:39.700Z" };
      expect(
        render(
          {
            kind: "cut-by-restart",
            continuedBy,
            restart,
            ...(notContinued === undefined ? {} : { notContinued }),
          },
          "unheld",
          false,
        ),
      ).toMatchObject({ interruption: { restart, continuation } });
    },
  );

  it("a continued card takes its final ending from the joined run", () => {
    expect(
      render(
        { kind: "cut-by-restart", continuedBy: RunId.make("conversation/r/2") },
        "tool",
        false,
        true,
      )?.face,
    ).toBe("idle");
  });
});
