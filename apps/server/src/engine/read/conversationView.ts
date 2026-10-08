/**
 * A conversation as the grafts read it — HQ's overview and attention, the menu row, the stand-up:
 * its agent, the run on now and the last that ended, its open requests, the person's last message
 * and the agent's last words. Read from the record's projections and the actor's state, never from
 * V1; nothing here writes.
 *
 * @module engine/read/conversationView
 */
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
  type ConversationAgent,
  type RunState,
} from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";

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

export interface ConversationView {
  readonly conversationId: ConversationId;
  /** The conversation's sequence: its own revision. */
  readonly seq: number;
  readonly agent: ConversationAgent | null;
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
  /** The person's latest message, as they wrote it. */
  readonly lastPerson: { readonly text: string; readonly at: number } | null;
  /** The agent's latest words, once said whole. */
  readonly lastAgent: { readonly text: string; readonly at: number } | null;
  /** The newest call of the run on, while it runs. */
  readonly liveCall: ViewCall | null;
  /** Background work alive after its turn: a helper or a shell (`working`), only monitors. */
  readonly background: "working" | "monitoring" | null;
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
    const items = (where: {
      readonly kind: string;
      readonly open?: boolean;
      readonly by?: string;
    }) =>
      sql<{ readonly body_json: string; readonly at: number; readonly run_id: string | null }>`
        SELECT body_json, at, run_id FROM engine_item
        WHERE conversation_id = ${conversationId} AND kind = ${where.kind}
          ${where.open === undefined ? sql`` : sql`AND state = ${where.open ? "open" : "closed"}`}
          ${where.by === undefined ? sql`` : sql`AND json_extract(by_json, '$.kind') = ${where.by}`}
        ORDER BY opened_seq DESC LIMIT 1
      `.pipe(Effect.map((rows) => rows[0]));
    const textOf = (row: { readonly body_json: string; readonly at: number } | undefined) =>
      row === undefined
        ? Effect.succeed(null)
        : Effect.map(decodeBody(row.body_json), (body) =>
            "text" in body && typeof body.text === "string"
              ? { text: body.text, at: row.at }
              : null,
          );
    const call = activeRun === null ? undefined : yield* items({ kind: "call", open: true });
    const callBody =
      call === undefined || call.run_id !== activeRun?.id
        ? undefined
        : yield* decodeBody(call.body_json);
    const work = yield* sql<{ readonly body_json: string }>`
      SELECT body_json FROM engine_item
      WHERE conversation_id = ${conversationId} AND kind = 'work' AND state = 'open'
    `;
    const alive = (yield* Effect.forEach(work, (row) => decodeBody(row.body_json))).flatMap(
      (body) =>
        body.kind === "work" && ["running", "waiting", "idle"].includes(body.status) ? [body] : [],
    );
    const view: ConversationView = {
      conversationId,
      seq: head.head_seq,
      agent: state.agent,
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
      lastPerson: yield* textOf(yield* items({ kind: "person" })),
      lastAgent: yield* textOf(yield* items({ kind: "note", open: false, by: "mate" })),
      liveCall:
        callBody?.kind === "call" && call !== undefined
          ? { step: callBody.step, tool: callBody.tool.name, words: callBody.words, at: call.at }
          : null,
      background:
        alive.length === 0
          ? null
          : alive.every((body) => body.workKind === "monitor")
            ? "monitoring"
            : "working",
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

/**
 * Every conversation the engine holds a record of, the oldest first. One that cannot be read is
 * named as unread (and logged), never dropped silently, and never keeps the others from the list;
 * the next read tries it again.
 */
export const readConversationViews = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const ids = yield* sql<{ readonly conversation_id: string }>`
    SELECT conversation_id FROM engine_conversation ORDER BY rowid
  `;
  const views: Array<ConversationView> = [];
  const unread: Array<ConversationId> = [];
  for (const row of ids) {
    const id = ConversationId.make(row.conversation_id);
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
