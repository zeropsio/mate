/**
 * EngineStore: every owner's durable record — a conversation's, and the crew's.
 *
 * `commit` is ONE transaction: reserve the receipt (a duplicate command returns the stored result
 * and writes nothing), append the events with a gapless per-owner `seq`, update the projections
 * (the owner kind's own, plus the outbox's settled rows and the wakes every kind shares), insert
 * outbox rows `ON CONFLICT DO NOTHING`, settle the receipt, and snapshot the state every K events.
 * Every event is encoded by its kind's codec before it is written, and a step one of whose events
 * does not encode is refused (`invalid-signal`): the store never writes what it could not read
 * back. A rejected command is committed too (its receipt only), so a retry of it returns the same
 * answer. `load` is the latest snapshot plus a fold of the events after it.
 *
 * `load`, `commit` and `events` are the conversation's; `owner(domain)` gives any kind the same.
 *
 * @module engine/store/EngineStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandResult,
  ENGINE_EVENT_VERSION,
  type ConversationId,
  type EffectOutcome,
  type EngineEvent,
  type ItemId,
  type KnownEngineEvent,
} from "@t3tools/contracts";

import type { Command, EventDraft } from "../domain/command.ts";
import { conversationDomain } from "../domain/conversationDomain.ts";
import type { ConversationState } from "../domain/state.ts";
import type { Domain, OwnerDecision, OwnerEnvelope, OwnerEvent } from "../owners.ts";

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

export interface OwnerCommitInput<S, C, D> {
  readonly envelope: OwnerEnvelope<C>;
  readonly decision: OwnerDecision<D>;
  /** The actor's state before the step: its head must be the stored head. */
  readonly state: S;
  readonly now: number;
}

export interface OwnerCommitted<S, E> {
  readonly result: CommandResult;
  /** The events written, stamped; empty for a duplicate or a rejection. */
  readonly events: ReadonlyArray<E>;
  /** The state after the step. */
  readonly state: S;
  readonly duplicate: boolean;
  /** The step queued outbox rows: the worker has work. */
  readonly enqueued: boolean;
  /** The step armed, fired or cancelled a wake: the scheduler re-reads. */
  readonly wakesChanged: boolean;
}

/** One owner kind's record. */
export interface OwnerStore<S, C, E, D> {
  readonly load: (owner: ConversationId) => Effect.Effect<S, EngineStoreError>;
  readonly commit: (
    input: OwnerCommitInput<S, C, D>,
  ) => Effect.Effect<OwnerCommitted<S, E>, EngineStoreError>;
  readonly events: (
    owner: ConversationId,
    afterSeq: number,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<E>, EngineStoreError>;
}

export type CommitInput = OwnerCommitInput<ConversationState, Command, EventDraft>;

export interface Committed extends Omit<
  OwnerCommitted<ConversationState, KnownEngineEvent>,
  "events"
> {
  /** The events written, stamped; empty for a duplicate or a rejection. */
  readonly events: ReadonlyArray<KnownEngineEvent>;
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
  /** Any owner kind's record, by its domain. */
  readonly owner: <
    S extends { readonly headSeq: number },
    C extends { readonly _tag: string },
    E extends OwnerEvent,
    D,
  >(
    domain: Domain<S, C, E, D>,
  ) => OwnerStore<S, C, E, D>;
  /** When the conversation first committed an event of this type, if it ever did. */
  readonly firstAt: (
    conversation: ConversationId,
    type: KnownEngineEvent["_tag"],
  ) => Effect.Effect<Option.Option<number>, EngineStoreError>;
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

const decodeResultJson = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandResult));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const rowFields = (row: EventRow): Readonly<Record<string, unknown>> => ({
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
const payloadOf = (event: OwnerEvent): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(event).filter(([key]) => !HEADER_KEYS.has(key))),
  );

/** Stamps drafts with the header the store writes: gapless seq after the head, one time. */
const stamp = <D, E>(
  head: number,
  envelope: OwnerEnvelope<unknown>,
  drafts: ReadonlyArray<D>,
  at: number,
): ReadonlyArray<E> =>
  drafts.map(
    (draft, index) =>
      ({
        ...draft,
        v: ENGINE_EVENT_VERSION,
        conversationId: envelope.conversationId,
        seq: head + index + 1,
        at,
        commandId: envelope.commandId,
      }) as E,
  );

const json = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);
const jsonText = (value: unknown): string => JSON.stringify(value);

const isStoreError = Schema.is(EngineStoreError);

const effectState = {
  ok: "done",
  failed: "failed",
  cut: "cut",
  "timed-out": "failed",
  unknown: "failed",
} as const;

type Shared<Tag extends string> = Extract<KnownEngineEvent, { readonly _tag: Tag }>;

/** The projections every owner kind shares: an effect's outcome, and its wakes. */
const projectShared = (sql: SqlClient.SqlClient, event: OwnerEvent) => {
  switch (event._tag) {
    case "EffectOutcomeRecorded": {
      const { outcome, effectId } = event as Shared<"EffectOutcomeRecorded">;
      return sql`
        UPDATE engine_effect SET state = ${effectState[(outcome as EffectOutcome).kind]},
          outcome_json = ${JSON.stringify(outcome)}
        WHERE effect_id = ${effectId}
      `.pipe(Effect.asVoid);
    }
    case "WakeArmed": {
      const armed = event as Shared<"WakeArmed">;
      return sql`
        INSERT INTO engine_wake (
          wake_id, owner_conversation_id, kind, due_at, cron, state, principal_json, payload_json,
          armed_seq
        ) VALUES (
          ${armed.wakeId}, ${armed.conversationId}, ${armed.kind}, ${armed.dueAt}, ${armed.cron},
          'armed', ${JSON.stringify(armed.principal)},
          ${JSON.stringify({ joins: armed.joins, text: armed.text })}, ${armed.seq}
        )
        ON CONFLICT (wake_id) DO UPDATE SET kind = excluded.kind, due_at = excluded.due_at,
          cron = excluded.cron, state = 'armed', principal_json = excluded.principal_json,
          payload_json = excluded.payload_json, fired_at = NULL, armed_seq = excluded.armed_seq,
          retry_at = NULL, fire_failures = 0
      `.pipe(Effect.asVoid);
    }
    case "WakeFired":
      return sql`
        UPDATE engine_wake SET state = 'fired', fired_at = ${event.at}
        WHERE wake_id = ${(event as Shared<"WakeFired">).wakeId}
      `.pipe(Effect.asVoid);
    case "WakeCancelled":
      return sql`
        UPDATE engine_wake SET state = 'cancelled'
        WHERE wake_id = ${(event as Shared<"WakeCancelled">).wakeId}
      `.pipe(Effect.asVoid);
    default:
      return Effect.void;
  }
};

const touchesWakes = (event: OwnerEvent) =>
  event._tag === "WakeArmed" || event._tag === "WakeFired" || event._tag === "WakeCancelled";

export const makeEngineStore = Effect.fn("makeEngineStore")(function* (
  options: EngineStoreOptions = {},
) {
  const sql = yield* SqlClient.SqlClient;
  const snapshotEvery = options.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY;
  const fault = (stage: CommitStage) => (options.fault ? options.fault(stage) : Effect.void);
  const storeError = (operation: string) => (cause: unknown) =>
    isStoreError(cause) ? cause : new EngineStoreError({ operation, cause });

  const ownerStore = <
    S extends { readonly headSeq: number },
    C extends { readonly _tag: string },
    E extends OwnerEvent,
    D,
  >(
    domain: Domain<S, C, E, D>,
  ): OwnerStore<S, C, E, D> => {
    const settleReceipt = (envelope: OwnerEnvelope<C>, result: CommandResult) =>
      sql`
        UPDATE engine_receipt SET status = ${result._tag === "Accepted" ? "accepted" : "rejected"},
          result_json = ${JSON.stringify(result)},
          result_seq = ${result._tag === "Accepted" ? result.seq : null}
        WHERE conversation_id = ${envelope.conversationId}
          AND command_id = ${envelope.commandId}
      `;

    const commitStep = Effect.fnUntraced(function* (input: OwnerCommitInput<S, C, D>) {
      const { envelope, decision, state, now } = input;
      const c = envelope.conversationId;
      const unchanged = (result: CommandResult, duplicate: boolean): OwnerCommitted<S, E> => ({
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
        yield* settleReceipt(envelope, result);
        return unchanged(result, false);
      }

      const [owner] = yield* sql<{ readonly head_seq: number }>`
        SELECT head_seq FROM engine_conversation WHERE conversation_id = ${c}
      `;
      const head = owner?.head_seq ?? 0;
      if (head !== state.headSeq) {
        return yield* new EngineStoreError({
          operation: "commit",
          cause: new Error(`stale state: stored head ${head}, actor head ${state.headSeq}`),
        });
      }

      const step = decision.step;
      const events = stamp<D, E>(head, envelope, step.events, now);
      // What the store writes, it must read back: a step whose event this build cannot encode (a
      // driver's body passed through unchecked) is refused whole, before anything is written.
      const unreadable = yield* Effect.exit(
        Effect.forEach(events, (event) => domain.encode(event), { discard: true }),
      );
      if (unreadable._tag === "Failure") {
        const result: CommandResult = {
          _tag: "Rejected",
          rejection: { reason: "invalid-signal", detail: String(unreadable.cause).slice(0, 500) },
        };
        yield* settleReceipt(envelope, result);
        return unchanged(result, false);
      }
      for (const event of events) {
        yield* sql`
          INSERT INTO engine_event (
            conversation_id, seq, type, v, at, command_id, run_id, payload_json
          ) VALUES (
            ${c}, ${event.seq}, ${event._tag}, ${event.v}, ${event.at}, ${event.commandId},
            ${domain.runOf(event)}, ${payloadOf(event)}
          )
        `;
      }
      yield* fault("events");

      let next = state;
      for (const event of events) {
        next = domain.evolve(next, event);
        yield* projectShared(sql, event);
        yield* Effect.provideService(domain.project(event, next), SqlClient.SqlClient, sql);
      }
      for (const detail of step.details) {
        yield* sql`
          INSERT INTO engine_item_detail (item_id, body) VALUES (${detail.itemId}, ${detail.body})
          ON CONFLICT (item_id) DO UPDATE SET body = excluded.body
        `;
      }
      for (const kept of step.data ?? []) {
        yield* sql`
          INSERT INTO engine_item_data (item_id, conversation_id, data_json, at)
          VALUES (${kept.itemId}, ${c}, ${jsonText(kept.data)}, ${now})
          ON CONFLICT (item_id) DO UPDATE SET data_json = excluded.data_json, at = excluded.at
        `;
      }
      yield* fault("projections");

      const newHead = head + events.length;
      for (const effect of step.effects) {
        yield* sql`
          INSERT INTO engine_effect (
            effect_id, conversation_id, owner_kind, lane, kind, class, run_id, payload_json, state,
            attempt, available_at, cause_id, created_seq
          ) VALUES (
            ${effect.effectId}, ${c}, ${domain.kind}, ${effect.lane}, ${effect.kind},
            ${effect.class}, ${effect.runId}, ${jsonText(effect.payload ?? null)}, 'pending', 0,
            ${now}, ${envelope.commandId}, ${newHead}
          )
          ON CONFLICT (effect_id) DO NOTHING
        `;
      }
      yield* fault("outbox");

      const result = step.result;
      yield* settleReceipt(envelope, result);
      yield* fault("settle");

      const agent = json(domain.rowAgent(next));
      const snapshot = Math.floor(newHead / snapshotEvery) > Math.floor(head / snapshotEvery);
      if (snapshot) {
        const snapshotJson = jsonText({ v: domain.stateVersion, state: next });
        yield* sql`
          INSERT INTO engine_conversation (
            conversation_id, owner_kind, head_seq, snapshot_json, snapshot_seq, updated_at,
            agent_json
          ) VALUES (
            ${c}, ${domain.kind}, ${newHead}, ${snapshotJson}, ${newHead}, ${now}, ${agent}
          )
          ON CONFLICT (conversation_id) DO UPDATE SET head_seq = excluded.head_seq,
            snapshot_json = excluded.snapshot_json, snapshot_seq = excluded.snapshot_seq,
            updated_at = excluded.updated_at, agent_json = excluded.agent_json
        `;
      } else {
        yield* sql`
          INSERT INTO engine_conversation (
            conversation_id, owner_kind, head_seq, updated_at, agent_json
          ) VALUES (${c}, ${domain.kind}, ${newHead}, ${now}, ${agent})
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
        wakesChanged: events.some(touchesWakes),
      } satisfies OwnerCommitted<S, E>;
    });

    const readEvents = (owner: ConversationId, afterSeq: number, limit: number) =>
      sql<EventRow>`
        SELECT conversation_id, seq, type, v, at, command_id, payload_json FROM engine_event
        WHERE conversation_id = ${owner} AND seq > ${afterSeq}
        ORDER BY seq LIMIT ${limit}
      `.pipe(Effect.flatMap(Effect.forEach((row) => domain.decode(rowFields(row)))));

    const load = (owner: ConversationId) =>
      Effect.gen(function* () {
        const [row] = yield* sql<{
          readonly snapshot_json: string | null;
          readonly snapshot_seq: number | null;
        }>`
          SELECT snapshot_json, snapshot_seq FROM engine_conversation
          WHERE conversation_id = ${owner}
        `;
        let state = domain.initial(owner);
        if (row?.snapshot_json != null && row.snapshot_seq != null) {
          const snapshot = (yield* decodeJson(row.snapshot_json)) as {
            readonly v: number;
            readonly state: S;
          };
          if (snapshot.v === domain.stateVersion) state = snapshot.state;
        }
        for (;;) {
          const page = yield* readEvents(owner, state.headSeq, DEFAULT_EVENTS_PAGE);
          for (const event of page) state = domain.evolve(state, event);
          if (page.length < DEFAULT_EVENTS_PAGE) return state;
        }
      }).pipe(Effect.mapError(storeError("load")));

    return {
      load,
      commit: (input) =>
        sql.withTransaction(commitStep(input)).pipe(Effect.mapError(storeError("commit"))),
      events: (owner, afterSeq, limit = DEFAULT_EVENTS_PAGE) =>
        readEvents(owner, afterSeq, limit).pipe(Effect.mapError(storeError("events"))),
    };
  };

  const conversations = ownerStore(conversationDomain);

  return EngineStore.of({
    load: conversations.load,
    commit: (input) => conversations.commit(input) as Effect.Effect<Committed, EngineStoreError>,
    events: conversations.events,
    itemDetail: (item) =>
      sql<{ readonly body: string }>`
        SELECT body FROM engine_item_detail WHERE item_id = ${item}
      `.pipe(
        Effect.map((rows) => Option.fromNullishOr(rows[0]?.body)),
        Effect.mapError(storeError("itemDetail")),
      ),
    owner: (domain) => ownerStore(domain),
    firstAt: (conversation, type) =>
      sql<{ readonly at: number }>`
        SELECT at FROM engine_event WHERE conversation_id = ${conversation} AND type = ${type}
        ORDER BY seq LIMIT 1
      `.pipe(
        Effect.map((rows) => Option.fromNullishOr(rows[0]?.at)),
        Effect.mapError(storeError("firstAt")),
      ),
  });
});

export const layer = Layer.effect(EngineStore, makeEngineStore());
