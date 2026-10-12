import {
  RunRecord,
  type ConversationRow,
  type ConversationRowState,
  type Item,
} from "@t3tools/contracts";
import { projectMateLimit } from "@t3tools/client-runtime/data";
import {
  callItem,
  engineCardPagingOfRecords,
  engineRow,
  engineRun,
  engineRunCardsOfRecords,
  engineThreadOfRecords,
  noteItem,
  personItem,
  thoughtItem,
} from "@t3tools/client-runtime/data/fixtures";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows, livePauseStageId } from "./MessagesTimeline.logic";

const key = { environmentId: "env", conversationId: "milo" };
const limited = "milo/r/1";
const held = "milo/r/2";
const decode = Schema.decodeUnknownSync(RunRecord);
const RESETS_AT = Date.parse("2099-10-11T11:00:00.000Z");
const PROMPT = "Live stress test 4A: start two helpers";

/** Milo's held message went at 8:47 and the pause lifted at 10:20 (run 4, local time). */
const SENT_AT = Date.parse("2099-10-10T06:47:27.000Z");
const LIFTED_AT = Date.parse("2099-10-10T08:20:39.900Z");

const LIMIT_WORDS = "You've hit your weekly limit · resets Oct 11, 11am (UTC)";

/**
 * Milo's stress run 4 (2026-10-10), as the engine recorded it: the run thought, its command
 * failed, it ended at the usage limit with Claude's words as its answer, and the conversation
 * paused until the reset; a message the person sent then waits in a queued run. `lifted`: the
 * reset came, the queued run started and the Mate is at work on it. `reload`: the page opened
 * again, holding the ended run's person message and answer, not its work. `answer`: the answer's
 * words as they stood (the end's commit carried it empty; its words came 154 ms later).
 */
function milo(
  phase: "paused" | "held" | "lifted" | "continued",
  {
    reload = false,
    work = true,
    answer = LIMIT_WORDS,
    liftedAt = null,
    driver,
    window,
  }: {
    reload?: boolean;
    /** The run worked before the limit; without, the limit refused it before it did anything. */
    work?: boolean;
    answer?: string;
    liftedAt?: number | null;
    driver?: string;
    window?: string;
  } = {},
) {
  const runs = [
    decode(
      engineRun(key.conversationId, 1, {
        end: {
          kind: "usage-limit",
          resetsAt: RESETS_AT,
          ...(driver === undefined ? {} : { driver }),
          ...(window === undefined ? {} : { window }),
        },
        summary: {
          items: 4,
          calls: { command: 1 },
          // The engine records no answer for a run a usage limit cut (B5).
          answerItemId: null,
          lastItemSeq: 4,
        },
      }),
    ),
    ...(phase === "paused"
      ? []
      : phase === "continued"
        ? [
            // The engine's resume at the reset joins the run the limit cut.
            decode(
              engineRun(key.conversationId, 2, {
                trigger: { kind: "wake", cause: "usage-resume", wakeId: null },
                joins: limited,
                queuedAt: LIFTED_AT,
                admittedAt: LIFTED_AT,
                startedAt: LIFTED_AT,
                state: "running",
                turnState: "running",
                endedAt: null,
                end: null,
              } as never),
            ),
          ]
        : [
            decode(
              engineRun(
                key.conversationId,
                2,
                phase === "held"
                  ? {
                      state: "queued",
                      end: null,
                      admittedAt: null,
                      startedAt: null,
                      endedAt: null,
                    }
                  : {
                      state: "running",
                      end: null,
                      endedAt: null,
                      ...(liftedAt === null
                        ? {}
                        : { queuedAt: SENT_AT, admittedAt: liftedAt, startedAt: liftedAt }),
                    },
              ),
            ),
          ]),
  ];
  const items: Item[] = [
    personItem(limited, 1, PROMPT),
    ...(reload || !work
      ? []
      : [
          thoughtItem(limited, 2, "I'm planning out three concurrent background jobs"),
          callItem(limited, 3, { state: "failed" }),
        ]),
    noteItem(limited, 4, answer, { answer: false }),
    ...(phase === "paused"
      ? []
      : phase === "continued"
        ? [
            {
              ...thoughtItem(held, 6, "Reading the notes file first"),
              at: LIFTED_AT + 4_000,
            } as Item,
          ]
        : [
            personItem(held, 5, "Then write the table", {
              ...(liftedAt === null ? {} : { at: SENT_AT }),
              delivery:
                phase === "held" ? { state: "queued", at: null } : { state: "delivered", at: 5 },
            }),
            ...(liftedAt === null
              ? []
              : [
                  {
                    ...thoughtItem(held, 6, "Reading the notes file first"),
                    at: liftedAt + 4_000,
                  } as Item,
                ]),
          ]),
  ];
  const state: ConversationRowState =
    phase === "lifted" || phase === "continued"
      ? { kind: "working", since: 6, waitsOnHelpers: false }
      : { kind: "paused", resetsAt: RESETS_AT };
  const row: ConversationRow = engineRow(key.environmentId, key.conversationId, {
    state,
    latestRun: { id: runs[0]!.id, end: runs[0]!.end, endedAt: runs[0]!.endedAt, turnState: null },
  });
  const records = {
    runs,
    items,
    row,
    ...(reload ? { spans: [{ runId: limited, from: null, to: 0, reading: null }] } : {}),
  };
  const thread = engineThreadOfRecords(key, records)!;
  const limit = projectMateLimit(
    { engineRow: row, latestTurn: null, session: null },
    Date.parse("2099-10-10T19:12:00.000Z"),
  );
  const rows = deriveMessagesTimelineRows({
    limit,
    runCards: engineRunCardsOfRecords(key, records)!,
    timelineEntries: deriveTimelineEntries(
      thread.messages as ReadonlyArray<ChatMessage>,
      [],
      deriveWorkLogEntries(thread.activities),
    ),
    latestTurn: thread.latestTurn,
    isWorking: phase === "lifted" || phase === "continued",
    activeTurnStartedAt: null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    ...(reload ? { cardPaging: engineCardPagingOfRecords(key, records) } : {}),
  });
  return { rows, limit };
}

const pauseIndex = (rows: ReturnType<typeof milo>["rows"]) =>
  rows.findIndex((row) => row.kind === "pause");
const sentIndex = (rows: ReturnType<typeof milo>["rows"]) =>
  rows.findIndex((row) => row.kind === "message" && row.message.text === "Then write the table");
const cardOf = (rows: ReturnType<typeof milo>["rows"]) =>
  rows.find((row) => row.kind === "record" && row.status !== null) as
    | Extract<ReturnType<typeof milo>["rows"][number], { kind: "record" }>
    | undefined;
const cardEndIndex = (rows: ReturnType<typeof milo>["rows"]) =>
  rows.findIndex((row) => row.kind === "card-end");

// The owner's pick on the "Answer Then More Work" board (B5, 2026-10-12): "The card waits through
// the pause. A run cut by a limit or a restart hasn't answered, so its last words stay in its card's
// slot and the card waits with its face asleep, then goes on in place: only the head's words and the
// face change. The ask ends with one card and one answer, and a reload reads the same."
describe("a run the usage limit cut", () => {
  it("waits in its card with its face asleep, no notice under it, the card the conversation's end", () => {
    const { rows } = milo("paused");
    expect(pauseIndex(rows)).toBe(-1);
    expect(cardOf(rows)).toMatchObject({
      live: true,
      now: { kind: "paused" },
      status: {
        live: true,
        face: "paused",
        paused: { resetsAt: new Date(RESETS_AT).toISOString() },
      },
    });
    expect(rows.at(-1)).toMatchObject({ kind: "card-end" });
  });

  it("holds its last line in its slot while it waits", () => {
    const card = cardOf(milo("paused").rows)!;
    expect(card.slot.live.map((item) => item.key)).toEqual([card.slot.record.at(-1)!.key]);
  });

  it("a reload draws the waiting card as it stood live", () => {
    const shown = (rows: ReturnType<typeof milo>["rows"]) => {
      const card = cardOf(rows)!;
      return {
        live: card.live,
        now: card.now?.kind,
        face: card.status!.face,
        paused: card.status!.paused,
        last: rows.at(-1)!.kind,
        pauses: pauseIndex(rows),
      };
    };
    expect(shown(milo("paused", { reload: true }).rows)).toEqual(shown(milo("paused").rows));
  });

  it.each([
    { driver: "claudeAgent", provider: "Claude" },
    { driver: "codex", provider: "Codex" },
  ])("names whose limit it waits on from the run's own end ($driver)", ({ driver, provider }) => {
    expect(cardOf(milo("paused", { driver }).rows)!.status!.paused).toMatchObject({ provider });
  });

  it("holds a message sent while paused right under its card, sending when the limit resets", () => {
    const { rows } = milo("held");
    expect(pauseIndex(rows)).toBe(-1);
    expect(sentIndex(rows)).toBe(cardEndIndex(rows) + 1);
    expect(rows[sentIndex(rows)]).toMatchObject({ receipt: "held" });
  });

  it("settles in place when the held message's run starts, nothing drawn between them", () => {
    const { rows } = milo("lifted");
    expect(pauseIndex(rows)).toBe(-1);
    expect(cardOf(rows)).toMatchObject({ live: false });
    expect(cardOf(rows)!.status!.paused).toBeUndefined();
    expect(sentIndex(rows)).toBe(cardEndIndex(rows) + 1);
    expect(rows[sentIndex(rows)]).not.toMatchObject({ receipt: "held" });
  });

  it("goes on in its card when the limit lifts, its history saying where it waited", () => {
    const { rows } = milo("continued");
    const cards = rows.filter((row) => row.kind === "record");
    expect(cards).toHaveLength(1);
    expect(pauseIndex(rows)).toBe(-1);
    const card = cardOf(rows)!;
    expect(card.live).toBe(true);
    expect(card.status!.paused).toBeUndefined();
    const waited = card.items.find((item) => item.kind === "event" && item.event.type === "waited");
    expect(waited).toMatchObject({
      at: new Date(LIFTED_AT).toISOString(),
      event: { type: "waited", to: new Date(LIFTED_AT).toISOString() },
    });
    // At the seam: after what it did before the cut, before what it does after.
    const keys = card.items.map((item) => item.key);
    expect(keys.indexOf(waited!.key)).toBe(keys.length - 1);
  });

  it("its clock leaves the wait out once it goes on", () => {
    const card = cardOf(milo("continued").rows)!;
    const waited = card.items.find((item) => item.kind === "event" && item.event.type === "waited");
    const from =
      waited?.kind === "event" && waited.event.type === "waited" ? waited.event.from : "";
    expect(card.status!.waitedMs).toBeGreaterThanOrEqual(LIFTED_AT - Date.parse(from));
  });
});

describe("a conversation paused at the usage limit", () => {
  it("holds a message sent while paused right after the notice, sending when the limit resets", () => {
    const { rows } = milo("held", { work: false });
    expect(sentIndex(rows)).toBe(pauseIndex(rows) + 1);
    expect(rows[sentIndex(rows)]).toMatchObject({ receipt: "held" });
  });

  it("starts the held message's run when the pause lifts: the notice goes quiet in place and the mark clears", () => {
    const before = milo("held", { work: false }).rows;
    const { rows } = milo("lifted", { work: false });
    expect(rows[pauseIndex(rows)]).toMatchObject({ id: before[pauseIndex(before)]!.id });
    expect(rows[pauseIndex(rows)]).not.toMatchObject({ resumedAt: null });
    expect(sentIndex(rows)).toBe(pauseIndex(rows) + 1);
    expect(rows[sentIndex(rows)]).not.toMatchObject({ receipt: "held" });
  });

  it("the pause row says when the Mate really picked up again", () => {
    const { rows } = milo("lifted", { work: false, liftedAt: LIFTED_AT });
    expect(rows[pauseIndex(rows)]).toMatchObject({
      resumedAt: new Date(LIFTED_AT).toISOString(),
    });
  });

  // The flicker on CI: "the coding agent's limit" until the session was read, then "Codex limit".
  it.each([
    { driver: "claudeAgent", provider: "Claude" },
    { driver: "codex", provider: "Codex" },
    { driver: undefined, provider: undefined },
  ])(
    "names the agent whose limit it was from the run's own end, before any session is read ($driver)",
    ({ driver, provider }) => {
      for (const phase of ["paused", "held", "lifted"] as const) {
        const { rows } = milo(phase, { work: false, ...(driver === undefined ? {} : { driver }) });
        const pause = rows[pauseIndex(rows)];
        expect(pause?.kind === "pause" ? pause.provider : "no pause").toBe(provider);
      }
    },
  );

  it.each([{ window: "7-day" }, { window: "5-hour" }, { window: undefined }])(
    "names the window the run's own end names ($window)",
    ({ window }) => {
      for (const phase of ["paused", "held", "lifted"] as const) {
        const { rows } = milo(phase, {
          work: false,
          driver: "claudeAgent",
          ...(window === undefined ? {} : { window }),
        });
        const pause = rows[pauseIndex(rows)];
        expect(pause?.kind === "pause" ? pause.window : "no pause").toBe(window);
      }
    },
  );

  it("draws nothing for an answer the limit left empty", () => {
    const { rows } = milo("paused", { work: false, answer: "" });
    expect(
      rows.filter((row) => row.kind === "message" && row.message.role === "assistant"),
    ).toEqual([]);
    expect(rows.at(-1)).toMatchObject({ kind: "pause" });
  });

  it("counts the run's work on its paused card the same live and after a reload", () => {
    const effort = (rows: ReturnType<typeof milo>["rows"]) =>
      rows.flatMap((row) => (row.kind === "record" && row.status !== null ? [row.outcome] : []));
    const live = effort(milo("paused").rows);
    expect(live).toEqual([expect.objectContaining({ activity: [{ kind: "command", count: 1 }] })]);
    expect(effort(milo("paused", { reload: true }).rows)).toEqual(live);
  });

  // Decision (2026-10-10, Milo run 4): only the server's own pause, with nothing after it, fills the
  // conversation; the engine's pause is the notice card, so nothing below it stands a viewport away.
  it.each([
    { phase: "paused", server: false, stage: false },
    { phase: "held", server: false, stage: false },
    { phase: "paused", server: true, stage: true },
    { phase: "held", server: true, stage: false },
    { phase: "lifted", server: true, stage: false },
  ] as const)(
    "the $phase pause fills the conversation only when it is the server's and nothing follows it ($stage)",
    ({ phase, server, stage }) => {
      const { rows, limit } = milo(phase, { work: false });
      const serverPause = server
        ? { resetsAt: "2099-10-11T11:00:00.000Z", autoResume: false }
        : null;
      expect(livePauseStageId(rows, limit, serverPause)).toBe(
        stage ? rows[pauseIndex(rows)]!.id : null,
      );
    },
  );
});
