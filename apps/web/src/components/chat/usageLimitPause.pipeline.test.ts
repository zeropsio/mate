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
  phase: "paused" | "held" | "lifted",
  {
    reload = false,
    answer = LIMIT_WORDS,
    liftedAt = null,
    driver,
  }: { reload?: boolean; answer?: string; liftedAt?: number | null; driver?: string } = {},
) {
  const runs = [
    decode(
      engineRun(key.conversationId, 1, {
        end: {
          kind: "usage-limit",
          resetsAt: RESETS_AT,
          ...(driver === undefined ? {} : { driver }),
        },
        summary: {
          items: 4,
          calls: { command: 1 },
          answerItemId: `${limited}/i/4` as never,
          lastItemSeq: 4,
        },
      }),
    ),
    ...(phase === "paused"
      ? []
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
    ...(reload
      ? []
      : [
          thoughtItem(limited, 2, "I'm planning out three concurrent background jobs"),
          callItem(limited, 3, { state: "failed" }),
        ]),
    noteItem(limited, 4, answer, { answer: false }),
    ...(phase === "paused"
      ? []
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
    phase === "lifted"
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
    isWorking: phase === "lifted",
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

describe("a conversation paused at the usage limit", () => {
  it("draws the limit as one notice right after the run it stopped, the conversation's last row", () => {
    const { rows } = milo("paused");
    expect(pauseIndex(rows)).toBe(rows.length - 1);
    expect(rows[pauseIndex(rows) - 1]).toMatchObject({ kind: "card-end" });
  });

  it("holds a message sent while paused right after the notice, sending when the limit resets", () => {
    const { rows } = milo("held");
    expect(sentIndex(rows)).toBe(pauseIndex(rows) + 1);
    expect(rows[sentIndex(rows)]).toMatchObject({ receipt: "held" });
  });

  it("starts the held message's run when the pause lifts: the notice goes quiet in place and the mark clears", () => {
    const before = milo("held").rows;
    const { rows } = milo("lifted");
    expect(rows[pauseIndex(rows)]).toMatchObject({ id: before[pauseIndex(before)]!.id });
    expect(rows[pauseIndex(rows)]).not.toMatchObject({ resumedAt: null });
    expect(sentIndex(rows)).toBe(pauseIndex(rows) + 1);
    expect(rows[sentIndex(rows)]).not.toMatchObject({ receipt: "held" });
  });

  it("the pause row says when the Mate really picked up again", () => {
    const { rows } = milo("lifted", { liftedAt: LIFTED_AT });
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
        const { rows } = milo(phase, driver === undefined ? {} : { driver });
        const pause = rows[pauseIndex(rows)];
        expect(pause?.kind === "pause" ? pause.provider : "no pause").toBe(provider);
      }
    },
  );

  it("draws nothing for an answer the limit left empty", () => {
    const { rows } = milo("paused", { answer: "" });
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
      const { rows, limit } = milo(phase);
      const serverPause = server
        ? { resetsAt: "2099-10-11T11:00:00.000Z", autoResume: false }
        : null;
      expect(livePauseStageId(rows, limit, serverPause)).toBe(
        stage ? rows[pauseIndex(rows)]!.id : null,
      );
    },
  );
});
