/**
 * EngineStore: the conversation's durable record.
 *
 * `commit` is ONE transaction: reserve the receipt (a duplicate command returns the stored result
 * and writes nothing), append the events with a gapless per-conversation `seq`, update the
 * projections (`engine_run`, `engine_item`, `engine_request`, `engine_session`), insert outbox rows
 * `ON CONFLICT DO NOTHING`, arm, fire or cancel wakes, settle the receipt, and snapshot the state
 * every K events. Every event is encoded with the contracts before it is written, and a step one
 * of whose events does not encode is refused (`invalid-signal`): the store never writes what it
 * could not read back. A rejected command is committed too (its receipt only), so a retry of it returns
 * the same answer. `load` is the latest snapshot plus a fold of the events after it.
 *
 * @module engine/store/EngineStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  CommandResult,
  EngineEvent,
  KnownEngineEvent,
  type ConversationId,
  type ItemId,
  type RunId,
} from "@t3tools/contracts";

import type { Decision, Envelope } from "../domain/command.ts";
import { evolve, fold, stampEvents } from "../domain/evolve.ts";
import { STATE_VERSION, initialState, type ConversationState } from "../domain/state.ts";

/** The record could not be read or written, or held a row this build cannot decode. */
export class EngineStoreError extends Schema.TaggedError<EngineStoreError>()("EngineStoreError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `engine store ${this.operation} failed: ${String(this.cause)}`;
  }
}

/** Where a commit stands; a test fault fires after the stage it names. */
export type CommitStage = "receipt" | "events" | "projections" | "outbox" | "settle" | "snapshot";

export interface CommitInput {
  readonly envelope: Envelope;
  readonly decision: Decision;
  /** The actor's state before the step: its head must be the stored head. */
  readonly state: ConversationState;
  readonly now: number;
}

export interface Committed {
  readonly result: CommandResult;
  /** The events written, stamped; empty for a duplicate or a rejection. */
  readonly events: ReadonlyArray<KnownEngineEvent>;
  /** The state after the step. */
  readonly state: ConversationState;
  readonly duplicate: boolean;
  /** The step queued outbox rows: the worker has work. */
  readonly enqueued: boolean;
  /** The step armed, fired or cancelled a wake: the scheduler re-reads. */
  readonly wakesChanged: boolean;
}

export interface EngineStoreShape {
  readonly load: (
    conversation: ConversationId,
  ) => Effect.Effect<ConversationState, EngineStoreError>;
  readonly commit: (input: CommitInput) => Effect.Effect<Committed, EngineStoreError>;
  readonly events: (
    conversation: ConversationId,
    afterSeq: number,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<EngineEvent>, EngineStoreError>;
  readonly itemDetail: (item: ItemId) => Effect.Effect<Option.Option<string>, EngineStoreError>;
}

export class EngineStore extends Context.Service<EngineStore, EngineStoreShape>()(
  "t3/engine/store/EngineStore",
) {}

export interface EngineStoreOptions {
  /** Snapshot the state every K events. */
  readonly snapshotEvery?: number;
  /** Tests only: runs after each commit stage; a failure must roll the whole step back. */
  readonly fault?: (stage: CommitStage) => Effect.Effect<void, EngineStoreError>;
}

const DEFAULT_SNAPSHOT_EVERY = 100;
const DEFAULT_EVENTS_PAGE = 1000;

interface EventRow {
  readonly conversation_id: string;
  readonly seq: number;
  readonly type: string;
  readonly v: number;
  readonly at: number;
  readonly command_id: string;
  readonly payload_json: string;
}

const decodeEvent = Schema.decodeUnknownEffect(EngineEvent);
const encodeEvent = Schema.encodeUnknownEffect(KnownEngineEvent);
const decodeResultJson = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandResult));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const eventFromRow = (row: EventRow) =>
  decodeEvent({
    ...(JSON.parse(row.payload_json) as object),
    _tag: row.type,
    v: row.v,
    conversationId: row.conversation_id,
    seq: row.seq,
    at: row.at,
    commandId: row.command_id,
  });

const HEADER_KEYS = new Set(["_tag", "v", "conversationId", "seq", "at", "commandId"]);

/** The event's own fields: the header lives in the row's columns. */
const payloadOf = (event: KnownEngineEvent): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(event).filter(([key]) => !HEADER_KEYS.has(key))),
  );

const runIdOf = (event: KnownEngineEvent): RunId | null =>
  "runId" in event && typeof event.runId === "string" ? event.runId : null;

const json = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));
const jsonText = (value: unknown): string => JSON.stringify(value);

const isStoreError = Schema.is(EngineStoreError);

const effectState = { ok: "done", failed: "failed", cut: "cut", unknown: "failed" } as const;

export const makeEngineStore = Effect.fn("makeEngineStore")(function* (
  options: EngineStoreOptions = {},
) {
  const sql = yield* SqlClient.SqlClient;
  const snapshotEvery = options.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY;
  const fault = (stage: CommitStage) => (options.fault ? options.fault(stage) : Effect.void);

  const upsertRun = (state: ConversationState, id: RunId | null, rev: number) => {
    const run = id === null ? undefined : state.runs[id];
    if (run === undefined) return Effect.void;
    return sql`
      INSERT INTO engine_run (
        run_id, conversation_id, ordinal, seq, rev, trigger_json, joins, principal_json, state,
        maintenance, waiting_on, stop_asked_json, end_json, end_source, session_id,
        provider_turn_id, queued_at, admitted_at, started_at, ended_at, unresponsive_since
      ) VALUES (
        ${run.id}, ${state.conversationId}, ${run.ordinal}, ${run.seq}, ${rev},
        ${JSON.stringify(run.trigger)}, ${run.joins}, ${JSON.stringify(run.principal)}, ${run.state},
        ${run.maintenance ? 1 : 0}, ${run.waitingOn}, ${json(run.stopAsked)}, ${json(run.end)},
        ${run.endSource}, ${run.sessionId}, ${run.providerTurnId}, ${run.queuedAt},
        ${run.admittedAt}, ${run.startedAt}, ${run.endedAt}, ${run.unresponsiveSince}
      )
      ON CONFLICT (run_id) DO UPDATE SET
        rev = excluded.rev, state = excluded.state, waiting_on = excluded.waiting_on,
        stop_asked_json = excluded.stop_asked_json, end_json = excluded.end_json,
        end_source = excluded.end_source, session_id = excluded.session_id,
        provider_turn_id = excluded.provider_turn_id, admitted_at = excluded.admitted_at,
        started_at = excluded.started_at, ended_at = excluded.ended_at,
        unresponsive_since = excluded.unresponsive_since
    `.pipe(Effect.asVoid);
  };

  /** Writes what one event changes in the projections, the outbox's settled rows and the wakes. */
  const project = (event: KnownEngineEvent, state: ConversationState) => {
    const c = event.conversationId;
    switch (event._tag) {
      case "RunQueued":
        return Effect.andThen(
          upsertRun(state, event.runId, event.seq),
          upsertRun(state, event.joins, event.seq),
        );
      case "RunAdmitted":
      case "RunSending":
      case "RunStarted":
      case "RunWaiting":
      case "RunResumed":
      case "RunStopAsked":
      case "RunEnded":
      case "RunNotContinued":
      case "RunRequeued":
      case "RunUnresponsive":
      case "RunResponsive":
        return upsertRun(state, event.runId, event.seq);
      case "ItemOpened":
        return sql`
          INSERT INTO engine_item (
            item_id, conversation_id, run_id, kind, state, by_json, body_json, opened_seq, rev, at
          ) VALUES (
            ${event.itemId}, ${c}, ${event.runId}, ${event.body.kind}, 'open',
            ${JSON.stringify(event.by)}, ${JSON.stringify(event.body)}, ${event.seq}, ${event.seq},
            ${event.at}
          )
        `.pipe(Effect.asVoid);
      case "ItemUpdated":
        return sql`
          UPDATE engine_item SET kind = ${event.body.kind}, body_json = ${JSON.stringify(event.body)},
            rev = ${event.seq}
          WHERE item_id = ${event.itemId}
        `.pipe(Effect.asVoid);
      case "ItemClosed":
        return sql`
          UPDATE engine_item SET kind = ${event.body.kind}, body_json = ${JSON.stringify(event.body)},
            state = 'closed', closed_seq = ${event.seq}, rev = ${event.seq}
          WHERE item_id = ${event.itemId}
        `.pipe(Effect.asVoid);
      case "RequestOpened":
        return sql`
          INSERT INTO engine_request (
            request_id, conversation_id, run_id, seq, rev, at, kind, ask_json, answerable, state,
            principal_json
          ) VALUES (
            ${event.requestId}, ${c}, ${event.runId}, ${event.seq}, ${event.seq}, ${event.at},
            ${event.ask.kind}, ${JSON.stringify(event.ask)}, ${event.answerable ? 1 : 0}, 'open',
            ${JSON.stringify(event.principal)}
          )
        `.pipe(Effect.asVoid);
      case "RequestAnswered":
        return sql`
          UPDATE engine_request SET state = 'answered', rev = ${event.seq},
            answer_json = ${JSON.stringify({ by: event.by, at: event.at, summary: event.summary })}
          WHERE request_id = ${event.requestId}
        `.pipe(Effect.asVoid);
      case "RequestReopened":
        return sql`
          UPDATE engine_request SET state = 'open', answerable = 1, answer_json = NULL,
            rev = ${event.seq}
          WHERE request_id = ${event.requestId}
        `.pipe(Effect.asVoid);
      case "RequestClosed":
        return sql`
          UPDATE engine_request SET state = ${event.state}, answerable = 0, rev = ${event.seq}
          WHERE request_id = ${event.requestId} AND state IN ('open', 'answered')
        `.pipe(Effect.asVoid);
      case "SessionOpened":
        return sql`
          INSERT INTO engine_session (
            session_id, conversation_id, driver, model, native_ref, capabilities_json, state,
            rotated_from, opened_at
          ) VALUES (
            ${event.sessionId}, ${c}, ${event.driver}, ${event.model}, ${event.nativeRef},
            ${JSON.stringify(event.capabilities)}, 'open', ${event.rotatedFrom}, ${event.at}
          )
          ON CONFLICT (session_id) DO UPDATE SET state = 'open', closed_at = NULL, close_reason = NULL
        `.pipe(Effect.asVoid);
      case "SessionClosed":
        return sql`
          UPDATE engine_session SET state = 'closed', closed_at = ${event.at},
            close_reason = ${event.reason}
          WHERE session_id = ${event.sessionId}
        `.pipe(Effect.asVoid);
      case "EffectOutcomeRecorded":
        return sql`
          UPDATE engine_effect SET state = ${effectState[event.outcome.kind]},
            outcome_json = ${JSON.stringify(event.outcome)}
          WHERE effect_id = ${event.effectId}
        `.pipe(Effect.asVoid);
      case "WakeArmed":
        return sql`
          INSERT INTO engine_wake (
            wake_id, owner_conversation_id, kind, due_at, cron, state, principal_json, payload_json,
            armed_seq
          ) VALUES (
            ${event.wakeId}, ${c}, ${event.kind}, ${event.dueAt}, ${event.cron}, 'armed',
            ${JSON.stringify(event.principal)},
            ${JSON.stringify({ joins: event.joins, text: event.text })}, ${event.seq}
          )
          ON CONFLICT (wake_id) DO UPDATE SET kind = excluded.kind, due_at = excluded.due_at,
            cron = excluded.cron, state = 'armed', principal_json = excluded.principal_json,
            payload_json = excluded.payload_json, fired_at = NULL, armed_seq = excluded.armed_seq,
            retry_at = NULL, fire_failures = 0
        `.pipe(Effect.asVoid);
      case "WakeFired":
        return sql`
          UPDATE engine_wake SET state = 'fired', fired_at = ${event.at}
          WHERE wake_id = ${event.wakeId}
        `.pipe(Effect.asVoid);
      case "WakeCancelled":
        return sql`
          UPDATE engine_wake SET state = 'cancelled' WHERE wake_id = ${event.wakeId}
        `.pipe(Effect.asVoid);
      case "AgentAssigned":
      case "SessionClosing":
      case "ModelSwitched":
      case "UsagePauseLifted":
      case "ConversationArchived":
      case "ConversationUnarchived":
      case "EffectRequested":
        return Effect.void;
    }
  };

  const settleReceipt = (input: CommitInput, result: CommandResult) =>
    sql`
      UPDATE engine_receipt SET status = ${result._tag === "Accepted" ? "accepted" : "rejected"},
        result_json = ${JSON.stringify(result)},
        result_seq = ${result._tag === "Accepted" ? result.seq : null}
      WHERE conversation_id = ${input.envelope.conversationId}
        AND command_id = ${input.envelope.commandId}
    `;

  const commitStep = Effect.fnUntraced(function* (input: CommitInput) {
    const { envelope, decision, state, now } = input;
    const c = envelope.conversationId;
    const unchanged = (result: CommandResult, duplicate: boolean): Committed => ({
      result,
      events: [],
      state,
      duplicate,
      enqueued: false,
      wakesChanged: false,
    });

    const reserved = yield* sql`
      INSERT INTO engine_receipt (conversation_id, command_id, status, at)
      VALUES (${c}, ${envelope.commandId}, 'pending', ${now})
      ON CONFLICT DO NOTHING
      RETURNING command_id
    `;
    if (reserved.length === 0) {
      const [stored] = yield* sql<{ readonly result_json: string }>`
        SELECT result_json FROM engine_receipt
        WHERE conversation_id = ${c} AND command_id = ${envelope.commandId}
      `;
      return unchanged(yield* decodeResultJson(stored!.result_json), true);
    }
    yield* fault("receipt");

    if (decision._tag === "Reject") {
      const result: CommandResult = { _tag: "Rejected", rejection: decision.rejection };
      yield* settleReceipt(input, result);
      return unchanged(result, false);
    }

    const [conversation] = yield* sql<{ readonly head_seq: number }>`
      SELECT head_seq FROM engine_conversation WHERE conversation_id = ${c}
    `;
    const head = conversation?.head_seq ?? 0;
    if (head !== state.headSeq) {
      return yield* new EngineStoreError({
        operation: "commit",
        cause: new Error(`stale state: stored head ${head}, actor head ${state.headSeq}`),
      });
    }

    const step = decision.step;
    const events = stampEvents(head, envelope, step.events, now);
    // What the store writes, it must read back: a step whose event this build cannot encode (a
    // driver's body passed through unchecked) is refused whole, before anything is written.
    const unreadable = yield* Effect.exit(
      Effect.forEach(events, (event) => encodeEvent(event), { discard: true }),
    );
    if (unreadable._tag === "Failure") {
      const result: CommandResult = {
        _tag: "Rejected",
        rejection: { reason: "invalid-signal", detail: String(unreadable.cause).slice(0, 500) },
      };
      yield* settleReceipt(input, result);
      return unchanged(result, false);
    }
    for (const event of events) {
      yield* sql`
        INSERT INTO engine_event (conversation_id, seq, type, v, at, command_id, run_id, payload_json)
        VALUES (
          ${c}, ${event.seq}, ${event._tag}, ${event.v}, ${event.at}, ${event.commandId},
          ${runIdOf(event)}, ${payloadOf(event)}
        )
      `;
    }
    yield* fault("events");

    let next = state;
    for (const event of events) {
      next = evolve(next, event);
      yield* project(event, next);
    }
    for (const detail of step.details) {
      yield* sql`
        INSERT INTO engine_item_detail (item_id, body) VALUES (${detail.itemId}, ${detail.body})
        ON CONFLICT (item_id) DO UPDATE SET body = excluded.body
      `;
    }
    yield* fault("projections");

    const newHead = head + events.length;
    for (const effect of step.effects) {
      yield* sql`
        INSERT INTO engine_effect (
          effect_id, conversation_id, lane, kind, class, run_id, payload_json, state, attempt,
          available_at, cause_id, created_seq
        ) VALUES (
          ${effect.effectId}, ${c}, ${effect.lane}, ${effect.kind}, ${effect.class},
          ${effect.runId}, ${jsonText(effect.payload ?? null)}, 'pending', 0, ${now},
          ${envelope.commandId}, ${newHead}
        )
        ON CONFLICT (effect_id) DO NOTHING
      `;
    }
    yield* fault("outbox");

    const result = step.result;
    yield* settleReceipt(input, result);
    yield* fault("settle");

    const snapshot = Math.floor(newHead / snapshotEvery) > Math.floor(head / snapshotEvery);
    if (snapshot) {
      const snapshotJson = jsonText({ v: STATE_VERSION, state: next });
      yield* sql`
        INSERT INTO engine_conversation (
          conversation_id, head_seq, snapshot_json, snapshot_seq, updated_at, agent_json
        ) VALUES (${c}, ${newHead}, ${snapshotJson}, ${newHead}, ${now}, ${json(next.agent)})
        ON CONFLICT (conversation_id) DO UPDATE SET head_seq = excluded.head_seq,
          snapshot_json = excluded.snapshot_json, snapshot_seq = excluded.snapshot_seq,
          updated_at = excluded.updated_at, agent_json = excluded.agent_json
      `;
    } else {
      yield* sql`
        INSERT INTO engine_conversation (conversation_id, head_seq, updated_at, agent_json)
        VALUES (${c}, ${newHead}, ${now}, ${json(next.agent)})
        ON CONFLICT (conversation_id) DO UPDATE SET head_seq = excluded.head_seq,
          updated_at = excluded.updated_at, agent_json = excluded.agent_json
      `;
    }
    yield* fault("snapshot");

    return {
      result,
      events,
      state: next,
      duplicate: false,
      enqueued: step.effects.length > 0,
      wakesChanged: events.some(
        (event) =>
          event._tag === "WakeArmed" ||
          event._tag === "WakeFired" ||
          event._tag === "WakeCancelled",
      ),
    } satisfies Committed;
  });

  const storeError = (operation: string) => (cause: unknown) =>
    isStoreError(cause) ? cause : new EngineStoreError({ operation, cause });

  const readEvents = (conversation: ConversationId, afterSeq: number, limit: number) =>
    sql<EventRow>`
      SELECT conversation_id, seq, type, v, at, command_id, payload_json FROM engine_event
      WHERE conversation_id = ${conversation} AND seq > ${afterSeq}
      ORDER BY seq LIMIT ${limit}
    `.pipe(Effect.flatMap(Effect.forEach(eventFromRow)));

  const load: EngineStoreShape["load"] = (conversation) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{
        readonly snapshot_json: string | null;
        readonly snapshot_seq: number | null;
      }>`
        SELECT snapshot_json, snapshot_seq FROM engine_conversation
        WHERE conversation_id = ${conversation}
      `;
      let state = initialState(conversation);
      if (row?.snapshot_json != null && row.snapshot_seq != null) {
        const snapshot = (yield* decodeJson(row.snapshot_json)) as {
          readonly v: number;
          readonly state: ConversationState;
        };
        if (snapshot.v === STATE_VERSION) state = snapshot.state;
      }
      for (;;) {
        const page = yield* readEvents(conversation, state.headSeq, DEFAULT_EVENTS_PAGE);
        state = fold(state, page);
        if (page.length < DEFAULT_EVENTS_PAGE) return state;
      }
    }).pipe(Effect.mapError(storeError("load")));

  return EngineStore.of({
    load,
    commit: (input) =>
      sql.withTransaction(commitStep(input)).pipe(Effect.mapError(storeError("commit"))),
    events: (conversation, afterSeq, limit = DEFAULT_EVENTS_PAGE) =>
      readEvents(conversation, afterSeq, limit).pipe(Effect.mapError(storeError("events"))),
    itemDetail: (item) =>
      sql<{ readonly body: string }>`
        SELECT body FROM engine_item_detail WHERE item_id = ${item}
      `.pipe(
        Effect.map((rows) => Option.fromNullishOr(rows[0]?.body)),
        Effect.mapError(storeError("itemDetail")),
      ),
  });
});

export const layer = Layer.effect(EngineStore, makeEngineStore());
