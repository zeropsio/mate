/**
 * A conversation as the grafts read it — HQ's overview and attention, the menu row, the stand-up:
 * its agent, the run on now and the last that ended, its open requests, the person's last message
 * and the agent's last words. Read from the record's projections and the actor's state, never from
 * V1; nothing here writes.
 *
 * @module engine/read/conversationView
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  ConversationId,
  ItemBody,
  Principal,
  RequestAsk,
  RequestId,
  RunEnd,
  RunEndSource,
  RunId,
  RunTrigger,
  WORK_ALIVE,
  type BackgroundWorkItem,
  MATE_ANSWER_WAIT_MS,
  type MateMessageItem,
  type ConversationWorkingOn,
  type ConversationAgent,
  type RunState,
  type RuntimeMode,
  type ThreadLease,
} from "@t3tools/contracts";

import { userAskOf } from "@t3tools/shared/userAsk";

import { Conversations } from "../Conversations.ts";
import { isUsageWake } from "../domain/evolve.ts";
import type { AwaitedAnswer } from "../domain/mateAsks.ts";

/** How many of the person's newest messages the last ask looks through: past this many commands
 * in a row it is none. */
const ASK_WINDOW = 20;

/** A run as a view reads it. */
export interface ViewRun {
  readonly id: RunId;
  readonly ordinal: number;
  readonly state: RunState | "unknown";
  readonly trigger: RunTrigger;
  readonly principal: Principal;
  readonly end: RunEnd | null;
  readonly endSource: RunEndSource | null;
  readonly queuedAt: number;
  readonly admittedAt: number | null;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly unresponsiveSince: number | null;
}

/** A request the agent waits on. */
export interface ViewRequest {
  readonly id: RequestId;
  readonly runId: RunId;
  readonly at: number;
  readonly ask: RequestAsk;
  readonly answerable: boolean;
}

/** A call the run is on now. */
export interface ViewCall {
  readonly step: string;
  readonly tool: string;
  readonly words: string | null;
  readonly at: number;
}

/** The wakes that start no run when they fire: a watch, an idle close, an expected turn. */
const NO_RUN_WAKES: ReadonlySet<string> = new Set(["watchdog", "session-idle", "agent-turn-due"]);

export interface ConversationView {
  readonly conversationId: ConversationId;
  /** The conversation's sequence: its own revision. */
  readonly seq: number;
  readonly agent: ConversationAgent | null;
  /** How freely its agent works, once a person set it. */
  readonly runtimeMode?: RuntimeMode | null;
  /** The pool container its agent leased, which it works in; null: none. */
  readonly lease?: ThreadLease | null;
  readonly archived: boolean;
  /** When its record began, and when it last changed. */
  readonly createdAt: number;
  readonly updatedAt: number;
  /** The run admitted, being sent, running or waiting; none while nothing is on. */
  readonly activeRun: ViewRun | null;
  /** The runs waiting their turn, the oldest first. */
  readonly queued: ReadonlyArray<ViewRun>;
  /** The latest run that ended. */
  readonly lastEnded: ViewRun | null;
  /** A usage limit holds the queue until then (`unknown`: until a probe or the person). */
  readonly pausedUntil: number | "unknown" | null;
  readonly openRequests: ReadonlyArray<ViewRequest>;
  /**
   * The person's latest message that opened a run and asks something, as they wrote it, with what
   * it carried (a picture's label is in its text): one steered into a running run is a word on
   * that run, never the conversation's subject (Milo's second stress run read the steer as its
   * title), and a slash command or the server's resume prompt is no ask of theirs. Another Mate's
   * message (`mateMessage`) is never the person speaking.
   */
  readonly lastPerson: {
    readonly text: string;
    readonly at: number;
    readonly attachments?: ReadonlyArray<{ readonly type: string; readonly mimeType?: string }>;
  } | null;
  /**
   * The same, among the messages the person typed: a request a page sent for them (`fromPanel`)
   * or a follow-up on a task (`taskMessage`) is a word on the conversation, never its subject —
   * what the person last asked; decisions read it.
   */
  readonly lastAsked: ConversationView["lastPerson"];
  /**
   * The latest ask whoever made it: `lastAsked`, or another Mate's message after it, with that
   * Mate (`mateMessage`): what the menu row and the header name the conversation by.
   */
  readonly latestAsk:
    | (NonNullable<ConversationView["lastPerson"]> & { readonly mateMessage?: MateMessageItem })
    | null;
  /**
   * The messages it sent other Mates that no answer met yet, oldest first: while no later run a
   * person's or a Mate's message started ended, and for at most `MATE_ANSWER_WAIT_MS`.
   */
  readonly awaits: ReadonlyArray<AwaitedAnswer>;
  /**
   * What a page asked it to work on: the newest `about` of a person's message — the one that
   * queued a run, or one steered into it — whose run has not ended. Absent: none.
   */
  readonly workingOn?: ConversationWorkingOn;
  /** The agent's latest words, once said whole. */
  readonly lastAgent: { readonly text: string; readonly at: number } | null;
  /** The newest call of the run on, while it runs. */
  readonly liveCall: ViewCall | null;
  /** Background work alive after its turn: a helper or a shell (`working`), only monitors. */
  readonly background: "working" | "monitoring" | null;
  /**
   * The background work that keeps it working (`background`), oldest first: every alive piece but
   * a monitor, which watches for hours and is never waited on. Absent: none named.
   */
  readonly work?: ReadonlyArray<BackgroundWorkItem>;
  /** Its background work ended and the agent's own turn on it is due (`AGENT_TURN_DUE_MS`). */
  readonly turnDue?: true;
  /**
   * A wake that starts a run is due now (an answered value's word to the agent, a restart's
   * continuation): the run is about to start, armed in the same commit that ended what came before.
   */
  readonly runDue?: true;
  /** A person's Stop is in force: the run on, or the session its work lives in, is being ended. */
  readonly stopping?: true;
  /** The runs a usage limit ended that a usage wake will resume (`joins`). Absent: none. */
  readonly usageResumes?: ReadonlyArray<RunId>;
}

const decode = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema as never)) as unknown as (
    json: string,
  ) => Effect.Effect<S["Type"], Schema.SchemaError>;

const decodeTrigger = decode(RunTrigger);
const decodePrincipal = decode(Principal);
const decodeEnd = decode(RunEnd);
const decodeAsk = decode(RequestAsk);
const decodeBody = decode(ItemBody);
const decodeSource = Schema.decodeUnknownEffect(RunEndSource);

interface RunRow {
  readonly run_id: string;
  readonly ordinal: number;
  readonly state: string;
  readonly trigger_json: string;
  readonly principal_json: string;
  readonly end_json: string | null;
  readonly end_source: string | null;
  readonly queued_at: number;
  readonly admitted_at: number | null;
  readonly started_at: number | null;
  readonly ended_at: number | null;
  readonly unresponsive_since: number | null;
}

const RUN_STATES: ReadonlySet<string> = new Set([
  "queued",
  "admitted",
  "sending",
  "running",
  "waiting",
  "ended",
]);

const runOf = (row: RunRow) =>
  Effect.gen(function* () {
    const run: ViewRun = {
      id: RunId.make(row.run_id),
      ordinal: row.ordinal,
      state: RUN_STATES.has(row.state) ? (row.state as RunState) : "unknown",
      trigger: yield* decodeTrigger(row.trigger_json),
      principal: yield* decodePrincipal(row.principal_json),
      end: row.end_json === null ? null : yield* decodeEnd(row.end_json),
      endSource: row.end_source === null ? null : yield* decodeSource(row.end_source),
      queuedAt: row.queued_at,
      admittedAt: row.admitted_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      unresponsiveSince: row.unresponsive_since,
    };
    return run;
  });

const ON: ReadonlySet<string> = new Set(["admitted", "sending", "running", "waiting"]);

/** The view of one conversation; none when the engine has no record of it. */
export const readConversationView = (conversationId: ConversationId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const conversations = yield* Conversations;
    const [head] = yield* sql<{ readonly head_seq: number; readonly updated_at: number }>`
      SELECT head_seq, updated_at FROM engine_conversation WHERE conversation_id = ${conversationId}
    `;
    if (head === undefined) return undefined;
    const state = yield* conversations.state(conversationId);
    const [first] = yield* sql<{ readonly at: number }>`
      SELECT at FROM engine_event WHERE conversation_id = ${conversationId} ORDER BY seq LIMIT 1
    `;
    const notEnded = yield* sql<RunRow>`
      SELECT * FROM engine_run WHERE conversation_id = ${conversationId} AND state != 'ended'
      ORDER BY ordinal
    `;
    const [ended] = yield* sql<RunRow>`
      SELECT * FROM engine_run WHERE conversation_id = ${conversationId} AND state = 'ended'
      ORDER BY ordinal DESC LIMIT 1
    `;
    const runs = yield* Effect.forEach(notEnded, runOf);
    const activeRun = runs.find((run) => ON.has(run.state)) ?? null;
    const requests = yield* sql<{
      readonly request_id: string;
      readonly run_id: string;
      readonly at: number;
      readonly ask_json: string;
      readonly answerable: number;
    }>`
      SELECT request_id, run_id, at, ask_json, answerable FROM engine_request
      WHERE conversation_id = ${conversationId} AND state = 'open' ORDER BY seq
    `;
    const items = (
      where: {
        readonly kind: string;
        readonly open?: boolean;
        readonly by?: string;
        /** Leave out a person's message steered into a running run. */
        readonly opening?: true;
        /** Leave out a message a page sent for the person. */
        readonly typed?: true;
        /** Leave out another Mate's message: never the person's words. */
        readonly fromPerson?: true;
      },
      limit = 1,
    ) =>
      sql<{ readonly body_json: string; readonly at: number; readonly run_id: string | null }>`
        SELECT body_json, at, run_id FROM engine_item
        WHERE conversation_id = ${conversationId} AND kind = ${where.kind}
          ${where.open === undefined ? sql`` : sql`AND state = ${where.open ? "open" : "closed"}`}
          ${where.by === undefined ? sql`` : sql`AND json_extract(by_json, '$.kind') = ${where.by}`}
          ${where.opening === undefined ? sql`` : sql`AND json_extract(body_json, '$.delivery.state') IS NOT 'steered'`}
          ${where.typed === undefined ? sql`` : sql`AND json_extract(body_json, '$.fromPanel') IS NULL AND json_extract(body_json, '$.taskMessage') IS NULL`}
          ${where.fromPerson === undefined ? sql`` : sql`AND json_extract(body_json, '$.mateMessage') IS NULL`}
        ORDER BY opened_seq DESC LIMIT ${limit}
      `;
    const item = (where: Parameters<typeof items>[0]) =>
      Effect.map(items(where), (rows) => rows[0]);
    const textOf = (row: { readonly body_json: string; readonly at: number } | undefined) =>
      row === undefined
        ? Effect.succeed(null)
        : Effect.map(decodeBody(row.body_json), (body) =>
            "text" in body && typeof body.text === "string"
              ? {
                  text: body.text,
                  at: row.at,
                  ...(body.kind === "person" ? { attachments: body.attachments } : {}),
                  ...(body.kind === "person" && body.mateMessage !== undefined
                    ? { mateMessage: body.mateMessage }
                    : {}),
                }
              : null,
          );
    // The person's newest message that asks something (`userAskOf`): a slash command, the
    // usage-limit resume or a crew card after their ask is no word of theirs, and the ask stays
    // what the conversation is about (a `/compact` left Mates' rows reading "Nothing asked yet").
    const lastAskOf = (where: { readonly typed?: true }) =>
      Effect.gen(function* () {
        const rows = yield* items(
          { kind: "person", opening: true, fromPerson: true, ...where },
          ASK_WINDOW,
        );
        for (const row of rows) {
          const said = yield* textOf(row);
          if (said !== null && userAskOf(said) !== null) return said;
        }
        return null;
      });
    // The person's latest typed ask, and another Mate's latest message: whichever came later is
    // the latest ask. A Mate's message always has words, so it always asks.
    const lastAsks = Effect.gen(function* () {
      const asked = yield* lastAskOf({ typed: true });
      // The fold keeps which item it is: one row by its id, never a scan.
      const [mate] =
        state.lastMateItem === null
          ? []
          : yield* sql<{ readonly body_json: string; readonly at: number }>`
              SELECT body_json, at FROM engine_item WHERE item_id = ${state.lastMateItem}
            `;
      const fromMate = yield* textOf(mate);
      const said: ConversationView["latestAsk"] =
        fromMate !== null && (asked === null || fromMate.at > asked.at) ? fromMate : asked;
      return { said, asked };
    });
    const call = activeRun === null ? undefined : yield* item({ kind: "call", open: true });
    const callBody =
      call === undefined || call.run_id !== activeRun?.id
        ? undefined
        : yield* decodeBody(call.body_json);
    const work = yield* sql<{
      readonly body_json: string;
      readonly by_kind: string | null;
      readonly helper_id: string | null;
      readonly at: number;
    }>`
      SELECT body_json, json_extract(by_json, '$.kind') AS by_kind,
        json_extract(by_json, '$.helperId') AS helper_id, at FROM engine_item
      WHERE conversation_id = ${conversationId} AND kind = 'work' AND state = 'open'
      ORDER BY opened_seq
    `;
    const alive = (yield* Effect.forEach(work, (row) =>
      Effect.map(decodeBody(row.body_json), (body) => ({ body, row })),
    )).flatMap(({ body, row }) =>
      body.kind === "work" && WORK_ALIVE.has(body.status) ? [{ body, row }] : [],
    );
    // A helper's own job is its helper's work, never the Mate's own; while its helper runs it is
    // that helper's to name (Eli, 2026-10-14: its helpers' shells read as its own background jobs).
    const helpersAlive = new Set(
      alive.flatMap(({ body }) => (body.workKind === "helper" ? [body.work] : [])),
    );
    const named = alive.flatMap(({ body, row }): ReadonlyArray<BackgroundWorkItem> =>
      body.workKind === "monitor" || (row.helper_id !== null && helpersAlive.has(row.helper_id))
        ? []
        : [
            {
              title: body.title,
              of: body.workKind === "helper" || row.by_kind === "helper" ? "helper" : "mate",
              since: row.at,
            },
          ],
    );
    const asks = yield* lastAsks;
    // What a page asked for in a run still on: the newest person message of those runs that names
    // it, steered into one or opening it. Nothing is read while every run has ended. Read through
    // the runs' own items (`engine_item_by_run`): the unary `+` keeps SQLite off
    // `engine_item_by_kind`, which walks every person message the conversation ever had.
    const [about] =
      runs.length === 0
        ? []
        : yield* sql<{ readonly body_json: string }>`
            SELECT body_json FROM engine_item
            WHERE +conversation_id = ${conversationId} AND +kind = 'person'
              AND ${sql.in(
                "run_id",
                runs.map((run) => run.id),
              )}
              AND json_extract(body_json, '$.about') IS NOT NULL
            ORDER BY opened_seq DESC LIMIT 1
          `;
    const aboutBody = about === undefined ? undefined : yield* decodeBody(about.body_json);
    const workingOn = aboutBody?.kind === "person" ? aboutBody.about : undefined;
    const now = yield* Clock.currentTimeMillis;
    const usageResumes = Object.values(state.wakes).flatMap((wake) =>
      isUsageWake(wake.kind) && wake.joins !== null ? [wake.joins] : [],
    );
    const view: ConversationView = {
      conversationId,
      seq: head.head_seq,
      agent: state.agent,
      runtimeMode: state.runtimeMode,
      lease: state.lease,
      archived: state.archived,
      createdAt: first?.at ?? head.updated_at,
      updatedAt: head.updated_at,
      activeRun,
      queued: runs.filter((run) => run.state === "queued"),
      lastEnded: ended === undefined ? null : yield* runOf(ended),
      pausedUntil: state.pausedUntil,
      openRequests: yield* Effect.forEach(requests, (row) =>
        Effect.map(decodeAsk(row.ask_json), (ask) => ({
          id: RequestId.make(row.request_id),
          runId: RunId.make(row.run_id),
          at: row.at,
          ask,
          answerable: row.answerable === 1,
        })),
      ),
      lastPerson: yield* lastAskOf({}),
      lastAsked: asks.asked,
      latestAsk: asks.said,
      // Waited on for at most a day; the fold drops one a later run a message started outlived.
      awaits: state.awaits.filter((awaited) => now - awaited.at < MATE_ANSWER_WAIT_MS),
      ...(workingOn === undefined ? {} : { workingOn }),
      lastAgent: yield* textOf(yield* item({ kind: "note", open: false, by: "mate" })),
      liveCall:
        callBody?.kind === "call" && call !== undefined
          ? { step: callBody.step, tool: callBody.tool.name, words: callBody.words, at: call.at }
          : null,
      background: alive.length === 0 ? null : named.length === 0 ? "monitoring" : "working",
      ...(named.length === 0 ? {} : { work: named }),
      ...(Object.values(state.wakes).some((wake) => wake.kind === "agent-turn-due")
        ? { turnDue: true as const }
        : {}),
      ...(Object.values(state.wakes).some(
        (wake) => !NO_RUN_WAKES.has(wake.kind) && wake.dueAt <= head.updated_at,
      )
        ? { runDue: true as const }
        : {}),
      ...(usageResumes.length === 0 ? {} : { usageResumes }),
      ...(state.closing?.reason === "stop" ||
      (activeRun !== null && state.runs[activeRun.id]?.stopAsked != null)
        ? { stopping: true as const }
        : {}),
    };
    return view;
  });

/** Every conversation's view, and the conversations whose view could not be read. */
export interface ConversationList {
  readonly views: ReadonlyArray<ConversationView>;
  /** Conversations the engine holds whose view could not be read now: never "none". */
  readonly unread: ReadonlyArray<ConversationId>;
  /** Every conversation was listed and read: only then is a conversation not listed none. */
  readonly complete: boolean;
}

const conversationIds = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly conversation_id: string }>`
    SELECT conversation_id FROM engine_conversation WHERE owner_kind = 'conversation' ORDER BY rowid
  `;
  return rows.map((row) => ConversationId.make(row.conversation_id));
});

/** Every conversation bound to a lease, and whether every conversation's record was read. */
export interface ConversationLeases {
  readonly leases: ReadonlyArray<{
    readonly conversationId: ConversationId;
    readonly lease: ThreadLease;
  }>;
  /** False when a record could not be read: what it holds is not known, never none. */
  readonly complete: boolean;
}

/**
 * The lease each conversation the engine holds a record of is bound to, from its record alone —
 * never its view, which reads its runs, requests and items besides. One whose record cannot be
 * read is logged and leaves the list incomplete; the next read tries it again.
 */
export const readConversationLeases = Effect.gen(function* () {
  const conversations = yield* Conversations;
  const leases: Array<ConversationLeases["leases"][number]> = [];
  let complete = true;
  for (const conversationId of yield* conversationIds) {
    const lease = yield* conversations.state(conversationId).pipe(
      Effect.map((state) => ({ held: state.lease })),
      Effect.catchCause((cause) =>
        Effect.logWarning("Mate engine: a conversation's record could not be read", {
          conversationId,
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );
    if (lease === undefined) complete = false;
    else if (lease.held != null) leases.push({ conversationId, lease: lease.held });
  }
  return { leases, complete } satisfies ConversationLeases;
});

/**
 * Every conversation the engine holds a record of, the oldest first. One that cannot be read is
 * named as unread (and logged), never dropped silently, and never keeps the others from the list;
 * the next read tries it again.
 */
export const readConversationViews = Effect.gen(function* () {
  const ids = yield* conversationIds;
  const views: Array<ConversationView> = [];
  const unread: Array<ConversationId> = [];
  for (const id of ids) {
    const view = yield* readConversationView(id).pipe(
      Effect.map((found) => ({ found })),
      Effect.catchCause((cause) =>
        Effect.logWarning("Mate engine: a conversation's view could not be read", {
          conversationId: id,
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );
    if (view === undefined) unread.push(id);
    else if (view.found !== undefined) views.push(view.found);
  }
  return { views, unread, complete: unread.length === 0 } satisfies ConversationList;
});
