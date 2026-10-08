/**
 * EffectOutbox: the effects a step queued, in the same transaction as the step.
 *
 * The claim is one statement: the oldest pending row whose time has come, and only when nothing
 * earlier in its owner and lane is still pending, running or settling — a row waiting in backoff
 * holds the rows behind it. A lane is any string its owner kind names (a conversation's `turn`, the
 * crew's `git/<handle>`), FIFO within its owner. A claim takes from one pool: the conversations'
 * effects, or every other owner's, so neither waits on the other's fibers. A retryable failure is bookkeeping (back to pending, later). A
 * terminal outcome is first written to its row (`settling`), then told to the owner's actor, which
 * records it (`EffectSettled`); a tell that failed is told again by a sweep with backoff, and at
 * boot, so an outcome is never lost and its lane never stays blocked. At boot, process-bound rows
 * from another boot are cut (their process is gone) and replay-safe rows are requeued.
 *
 * @module engine/outbox/EffectOutbox
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  EffectOutcome,
  type BootId,
  type ConversationId,
  type EffectId,
  type OwnerKind,
  type RunId,
} from "@t3tools/contracts";

import type { EffectClass, EffectLane } from "../domain/command.ts";
import { EngineStoreError } from "../store/EngineStore.ts";

export type EffectRowState = "pending" | "running" | "settling" | "done" | "failed" | "cut";

export interface EffectRow {
  readonly effectId: EffectId;
  /** Its owner: a conversation, or the crew. */
  readonly conversationId: ConversationId;
  readonly ownerKind: OwnerKind;
  readonly lane: EffectLane;
  readonly kind: string;
  readonly class: EffectClass;
  readonly runId: RunId | null;
  readonly payload: unknown;
  readonly state: EffectRowState;
  /** Attempts so far, this one included once claimed. */
  readonly attempt: number;
  readonly availableAt: number;
  readonly claimedBoot: BootId | null;
  readonly lastError: string | null;
  /** A settling row's outcome, not yet recorded by its owner. */
  readonly outcome: EffectOutcome | null;
  /** Tells of a settling row's outcome so far. */
  readonly settleAttempt: number;
}

/** One conversation a restart touched, and the process-bound work it left behind. */
export interface RecoveryOwner {
  readonly conversationId: ConversationId;
  /** Tried, and cut mid-flight: it may have acted. */
  readonly cut: ReadonlyArray<EffectId>;
  /** Never tried (still pending at attempt 0): nothing of it happened. */
  readonly unstarted: ReadonlyArray<EffectId>;
}

/**
 * Whose effects a claim takes: the conversations', or every other owner's (the crew's git, checks
 * and deliveries, which may hold a fiber for minutes). Absent: any.
 */
export type EffectPool = "conversations" | "owners";

/** How often, and how far apart, a replay-safe effect is tried before it fails for good. */
export interface RetryPolicy {
  readonly maxAttempts: number;
  /** The wait before the next attempt, after attempt `n` failed. */
  readonly delayMs: (attempt: number) => number;
}

export interface EffectOutboxShape {
  readonly claim: (
    boot: BootId,
    now: number,
    pool?: EffectPool,
  ) => Effect.Effect<Option.Option<EffectRow>, EngineStoreError>;
  /** A retryable failure: pending again after `delayMs` (by default `backoffMs(attempt)`). */
  readonly retry: (
    row: EffectRow,
    now: number,
    reason: string,
    delayMs?: number,
  ) => Effect.Effect<void, EngineStoreError>;
  /** A terminal outcome its owner could not record: closed here so it never blocks its lane. */
  readonly close: (
    effect: EffectId,
    state: Exclude<EffectRowState, "pending" | "running" | "settling">,
    reason: string,
  ) => Effect.Effect<void, EngineStoreError>;
  /** A terminal outcome, written to its row before its owner is told. */
  readonly settling: (
    effect: EffectId,
    outcome: EffectOutcome,
    now: number,
  ) => Effect.Effect<void, EngineStoreError>;
  /** The owner could not be told: tell it again after `backoffMs(settleAttempt)`. */
  readonly settleLater: (row: EffectRow, now: number) => Effect.Effect<void, EngineStoreError>;
  /** The oldest settling row due to be told again (every one at boot: `now` = Infinity). */
  readonly nextSettling: (now: number) => Effect.Effect<Option.Option<EffectRow>, EngineStoreError>;
  /**
   * When the worker next has something to do: the earliest lane head that comes due, or the
   * earliest settling row due to be told again. A row behind a running or settling row is not due.
   */
  readonly nextAvailableAt: (
    pool?: EffectPool,
  ) => Effect.Effect<Option.Option<number>, EngineStoreError>;
  readonly row: (effect: EffectId) => Effect.Effect<Option.Option<EffectRow>, EngineStoreError>;
  /** Boot: requeues replay-safe rows another boot was running; returns how many. */
  readonly requeueReplaySafe: (
    boot: BootId,
    now: number,
  ) => Effect.Effect<number, EngineStoreError>;
  /**
   * Boot: the owners to recover — every conversation with process-bound rows another boot left
   * pending or running (tried ones are cut, untried ones reported apart), every one whose run was
   * alive, every one with a session still open (its process died with the server), and every
   * owner of another kind, which reconciles what it holds at each boot.
   */
  readonly recoveryOwners: (
    boot: BootId,
  ) => Effect.Effect<ReadonlyArray<RecoveryOwner>, EngineStoreError>;
}

export class EffectOutbox extends Context.Service<EffectOutbox, EffectOutboxShape>()(
  "t3/engine/outbox/EffectOutbox",
) {}

/** `min(30 s, 100 ms · 2^(attempt − 1))`. */
export const backoffMs = (attempt: number): number =>
  Math.min(30_000, 100 * 2 ** Math.max(0, attempt - 1));

/** A conversation's effect: five tries in about a second and a half. */
export const CONVERSATION_RETRY: RetryPolicy = { maxAttempts: 5, delayMs: backoffMs };

/**
 * Every other owner's (the crew's git and checks over ssh): `min(1 min, 1 s · 2^(n − 1))` between
 * ten tries, about four minutes in all, so an ssh hiccup or a container's restart passes.
 */
export const OWNER_RETRY: RetryPolicy = {
  maxAttempts: 10,
  delayMs: (attempt) => Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)),
};

/** The retry policy of a row's owner kind. */
export const retryPolicyOf = (
  row: Pick<EffectRow, "ownerKind">,
  policies: { readonly conversation: RetryPolicy; readonly owner: RetryPolicy } = {
    conversation: CONVERSATION_RETRY,
    owner: OWNER_RETRY,
  },
): RetryPolicy => (row.ownerKind === "conversation" ? policies.conversation : policies.owner);

const poolFilter = (pool: EffectPool | undefined, alias: string): string =>
  pool === undefined
    ? "1 = 1"
    : pool === "conversations"
      ? `${alias}.owner_kind = 'conversation'`
      : `${alias}.owner_kind != 'conversation'`;

interface Row {
  readonly effect_id: string;
  readonly conversation_id: string;
  readonly owner_kind: string;
  readonly lane: string;
  readonly kind: string;
  readonly class: string;
  readonly run_id: string | null;
  readonly payload_json: string;
  readonly state: string;
  readonly attempt: number;
  readonly available_at: number;
  readonly claimed_boot: string | null;
  readonly last_error: string | null;
  readonly outcome_json: string | null;
  readonly settle_attempt: number;
}

const decodePayload = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeOutcome = Schema.decodeUnknownEffect(Schema.fromJsonString(EffectOutcome));

const fromRow = (row: Row) =>
  Effect.all({
    payload: decodePayload(row.payload_json),
    outcome: row.outcome_json === null ? Effect.succeed(null) : decodeOutcome(row.outcome_json),
  }).pipe(
    Effect.map(({ payload, outcome }): EffectRow => ({
      effectId: row.effect_id as EffectId,
      conversationId: row.conversation_id as ConversationId,
      ownerKind: row.owner_kind as OwnerKind,
      lane: row.lane,
      kind: row.kind,
      class: row.class as EffectClass,
      runId: row.run_id as RunId | null,
      payload,
      state: row.state as EffectRowState,
      attempt: row.attempt,
      availableAt: row.available_at,
      claimedBoot: row.claimed_boot as BootId | null,
      lastError: row.last_error,
      outcome,
      settleAttempt: row.settle_attempt,
    })),
  );

const COLUMNS = `effect_id, conversation_id, owner_kind, lane, kind, class, run_id, payload_json, state, attempt,
  available_at, claimed_boot, last_error, outcome_json, settle_attempt`;

/** A lane's head: nothing earlier in its owner and lane is still in flight. */
const LANE_HEAD = `NOT EXISTS (
  SELECT 1 FROM engine_effect p
  WHERE p.conversation_id = e.conversation_id AND p.lane = e.lane
    AND p.rowid < e.rowid AND p.state IN ('pending', 'running', 'settling')
)`;

export const makeEffectOutbox = Effect.fn("makeEffectOutbox")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const failed = (operation: string) => (cause: unknown) =>
    new EngineStoreError({ operation: `outbox.${operation}`, cause });

  const claim: EffectOutboxShape["claim"] = (boot, now, pool) =>
    sql<Row>`
      UPDATE engine_effect
      SET state = 'running', claimed_boot = ${boot}, claimed_at = ${now}, attempt = attempt + 1
      WHERE effect_id = (
        SELECT e.effect_id FROM engine_effect e
        WHERE e.state = 'pending' AND e.available_at <= ${now} AND ${sql.literal(LANE_HEAD)}
          AND ${sql.literal(poolFilter(pool, "e"))}
        ORDER BY e.rowid LIMIT 1
      )
      RETURNING ${sql.literal(COLUMNS)}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined ? Effect.succeed(Option.none()) : Effect.asSome(fromRow(rows[0])),
      ),
      Effect.mapError(failed("claim")),
    );

  const row: EffectOutboxShape["row"] = (effect) =>
    sql<Row>`SELECT ${sql.literal(COLUMNS)} FROM engine_effect WHERE effect_id = ${effect}`.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined ? Effect.succeed(Option.none()) : Effect.asSome(fromRow(rows[0])),
      ),
      Effect.mapError(failed("row")),
    );

  return EffectOutbox.of({
    claim,
    row,
    retry: (effect, now, reason, delayMs = backoffMs(effect.attempt)) =>
      sql`
        UPDATE engine_effect
        SET state = 'pending', available_at = ${now + delayMs},
          last_error = ${reason}
        WHERE effect_id = ${effect.effectId} AND state = 'running'
      `.pipe(Effect.asVoid, Effect.mapError(failed("retry"))),
    close: (effect, state, reason) =>
      sql`
        UPDATE engine_effect SET state = ${state}, last_error = ${reason}
        WHERE effect_id = ${effect} AND state IN ('pending', 'running', 'settling')
      `.pipe(Effect.asVoid, Effect.mapError(failed("close"))),
    settling: (effect, outcome, now) =>
      sql`
        UPDATE engine_effect SET state = 'settling', outcome_json = ${JSON.stringify(outcome)},
          available_at = ${now}, settle_attempt = 0
        WHERE effect_id = ${effect} AND state = 'running'
      `.pipe(Effect.asVoid, Effect.mapError(failed("settling"))),
    settleLater: (effect, now) =>
      sql`
        UPDATE engine_effect SET settle_attempt = settle_attempt + 1,
          available_at = ${now + backoffMs(effect.settleAttempt + 1)}
        WHERE effect_id = ${effect.effectId} AND state = 'settling'
      `.pipe(Effect.asVoid, Effect.mapError(failed("settleLater"))),
    nextSettling: (now) =>
      sql<Row>`
        SELECT ${sql.literal(COLUMNS)} FROM engine_effect
        WHERE state = 'settling' AND available_at <= ${Number.isFinite(now) ? now : Number.MAX_SAFE_INTEGER}
        ORDER BY available_at, rowid LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeed(Option.none()) : Effect.asSome(fromRow(rows[0])),
        ),
        Effect.mapError(failed("nextSettling")),
      ),
    nextAvailableAt: (pool) =>
      sql<{ readonly at: number | null }>`
        SELECT min(at) AS at FROM (
          SELECT min(e.available_at) AS at FROM engine_effect e
          WHERE e.state = 'pending' AND ${sql.literal(LANE_HEAD)}
            AND ${sql.literal(poolFilter(pool, "e"))}
          UNION ALL
          SELECT min(available_at) AS at FROM engine_effect WHERE state = 'settling'
        )
      `.pipe(
        Effect.map((rows) => Option.fromNullishOr(rows[0]?.at)),
        Effect.mapError(failed("nextAvailableAt")),
      ),
    requeueReplaySafe: (boot, now) =>
      sql<{ readonly effect_id: string }>`
        UPDATE engine_effect SET state = 'pending', available_at = ${now}
        WHERE class = 'replay-safe' AND state = 'running'
          AND (claimed_boot IS NULL OR claimed_boot != ${boot})
        RETURNING effect_id
      `.pipe(
        Effect.map((rows) => rows.length),
        Effect.mapError(failed("requeueReplaySafe")),
      ),
    recoveryOwners: (boot) =>
      Effect.gen(function* () {
        const left = yield* sql<{
          readonly effect_id: string;
          readonly conversation_id: string;
          readonly state: string;
          readonly attempt: number;
        }>`
          SELECT effect_id, conversation_id, state, attempt FROM engine_effect
          WHERE class = 'process-bound'
            AND (state = 'pending'
              OR (state = 'running' AND (claimed_boot IS NULL OR claimed_boot != ${boot})))
          ORDER BY rowid
        `;
        const touched = yield* sql<{ readonly conversation_id: string }>`
          SELECT conversation_id FROM engine_run
          WHERE state IN ('admitted', 'sending', 'running', 'waiting')
          UNION
          SELECT conversation_id FROM engine_session WHERE state = 'open'
          UNION
          SELECT conversation_id FROM engine_conversation WHERE owner_kind != 'conversation'
        `;
        const owners = new Map<
          string,
          { readonly cut: Array<EffectId>; readonly unstarted: Array<EffectId> }
        >();
        const owner = (conversation: string) => {
          const found = owners.get(conversation) ?? { cut: [], unstarted: [] };
          owners.set(conversation, found);
          return found;
        };
        for (const row of touched) owner(row.conversation_id);
        for (const row of left) {
          const untried = row.state === "pending" && row.attempt === 0;
          owner(row.conversation_id)[untried ? "unstarted" : "cut"].push(row.effect_id as EffectId);
        }
        return [...owners].map(([conversationId, effects]): RecoveryOwner => ({
          conversationId: conversationId as ConversationId,
          ...effects,
        }));
      }).pipe(Effect.mapError(failed("recoveryOwners"))),
  });
});

export const layer = Layer.effect(EffectOutbox, makeEffectOutbox());
