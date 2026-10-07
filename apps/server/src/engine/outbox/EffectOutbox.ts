/**
 * EffectOutbox: the effects a step queued, in the same transaction as the step.
 *
 * The claim is one statement: the oldest pending row whose time has come, and only when nothing
 * earlier in its conversation and lane is still pending or running — a row waiting in backoff
 * holds the rows behind it. A retryable failure is bookkeeping (back to pending, later); a terminal
 * outcome is a fact the owner's actor records (`EffectSettled`). At boot, process-bound rows from
 * another boot are cut (their process is gone) and replay-safe rows are requeued.
 *
 * @module engine/outbox/EffectOutbox
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { BootId, ConversationId, EffectId, RunId } from "@t3tools/contracts";

import type { EffectClass, EffectLane } from "../domain/command.ts";
import { EngineStoreError } from "../store/EngineStore.ts";

export type EffectRowState = "pending" | "running" | "done" | "failed" | "cut";

export interface EffectRow {
  readonly effectId: EffectId;
  readonly conversationId: ConversationId;
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
}

/** One conversation a restart touched, and the process-bound work it left behind. */
export interface RecoveryOwner {
  readonly conversationId: ConversationId;
  /** Tried, and cut mid-flight: it may have acted. */
  readonly cut: ReadonlyArray<EffectId>;
  /** Never tried (still pending at attempt 0): nothing of it happened. */
  readonly unstarted: ReadonlyArray<EffectId>;
}

export interface EffectOutboxShape {
  readonly claim: (
    boot: BootId,
    now: number,
  ) => Effect.Effect<Option.Option<EffectRow>, EngineStoreError>;
  /** A retryable failure: pending again after `backoffMs(attempt)`. */
  readonly retry: (
    row: EffectRow,
    now: number,
    reason: string,
  ) => Effect.Effect<void, EngineStoreError>;
  /** A terminal outcome its owner could not record: closed here so it never blocks its lane. */
  readonly close: (
    effect: EffectId,
    state: Exclude<EffectRowState, "pending" | "running">,
    reason: string,
  ) => Effect.Effect<void, EngineStoreError>;
  /** When the earliest pending row comes due. */
  readonly nextAvailableAt: Effect.Effect<Option.Option<number>, EngineStoreError>;
  readonly row: (effect: EffectId) => Effect.Effect<Option.Option<EffectRow>, EngineStoreError>;
  /** Boot: requeues replay-safe rows another boot was running; returns how many. */
  readonly requeueReplaySafe: (
    boot: BootId,
    now: number,
  ) => Effect.Effect<number, EngineStoreError>;
  /**
   * Boot: the conversations to recover — every one with process-bound rows another boot left
   * pending or running (tried ones are cut, untried ones reported apart), every one whose run was
   * alive, and every one with a session still open (its process died with the server).
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

interface Row {
  readonly effect_id: string;
  readonly conversation_id: string;
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
}

const decodePayload = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const fromRow = (row: Row) =>
  Effect.map(decodePayload(row.payload_json), (payload): EffectRow => ({
    effectId: row.effect_id as EffectId,
    conversationId: row.conversation_id as ConversationId,
    lane: row.lane as EffectLane,
    kind: row.kind,
    class: row.class as EffectClass,
    runId: row.run_id as RunId | null,
    payload,
    state: row.state as EffectRowState,
    attempt: row.attempt,
    availableAt: row.available_at,
    claimedBoot: row.claimed_boot as BootId | null,
    lastError: row.last_error,
  }));

const COLUMNS = `effect_id, conversation_id, lane, kind, class, run_id, payload_json, state, attempt,
  available_at, claimed_boot, last_error`;

export const makeEffectOutbox = Effect.fn("makeEffectOutbox")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const failed = (operation: string) => (cause: unknown) =>
    new EngineStoreError({ operation: `outbox.${operation}`, cause });

  const claim: EffectOutboxShape["claim"] = (boot, now) =>
    sql<Row>`
      UPDATE engine_effect
      SET state = 'running', claimed_boot = ${boot}, claimed_at = ${now}, attempt = attempt + 1
      WHERE effect_id = (
        SELECT e.effect_id FROM engine_effect e
        WHERE e.state = 'pending' AND e.available_at <= ${now}
          AND NOT EXISTS (
            SELECT 1 FROM engine_effect p
            WHERE p.conversation_id = e.conversation_id AND p.lane = e.lane
              AND p.rowid < e.rowid AND p.state IN ('pending', 'running')
          )
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
    retry: (effect, now, reason) =>
      sql`
        UPDATE engine_effect
        SET state = 'pending', available_at = ${now + backoffMs(effect.attempt)},
          last_error = ${reason}
        WHERE effect_id = ${effect.effectId} AND state = 'running'
      `.pipe(Effect.asVoid, Effect.mapError(failed("retry"))),
    close: (effect, state, reason) =>
      sql`
        UPDATE engine_effect SET state = ${state}, last_error = ${reason}
        WHERE effect_id = ${effect} AND state IN ('pending', 'running')
      `.pipe(Effect.asVoid, Effect.mapError(failed("close"))),
    nextAvailableAt: sql<{ readonly at: number | null }>`
      SELECT min(available_at) AS at FROM engine_effect WHERE state = 'pending'
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
