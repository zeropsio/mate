/**
 * WakeScheduler: one fiber that sleeps until the earliest armed wake is due, re-reading when an
 * actor rings (a wake was armed, fired or cancelled). Firing is a `tell` of `WakeFired` to the
 * wake's owner; the owner's step marks the row fired in the same transaction as what the wake
 * starts, so a fire repeated after a crash finds nothing armed. A recurring wake keeps its cron:
 * the step that fires it arms its next time. Wakes that came due while the server was down fire
 * as soon as the scheduler starts. A wake whose owner fails to load backs off on its own row
 * (`retry_at`) and never holds the wakes behind it.
 *
 * @module engine/wakes/WakeScheduler
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { ConversationId, WakeId } from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";
import { wakeFiredCommandId } from "../domain/ids.ts";
import { EngineSignals } from "../EngineSignals.ts";
import { EngineStoreError } from "../store/EngineStore.ts";

interface DueWake {
  readonly wakeId: WakeId;
  readonly owner: ConversationId;
  /** When it fires: its due time, or later while a failed fire backs off. */
  readonly at: number;
  readonly armedSeq: number;
  readonly failures: number;
}

/** A failed fire waits `min(5 min, 1 s · 2^(failures − 1))` before it is tried again. */
export const wakeRetryMs = (failures: number): number =>
  Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, failures - 1));

const ENGINE = { kind: "engine" } as const;

/** How many due wakes one `fireDue` fires at most before it yields. */
const FIRE_BATCH = 100;

export const makeWakeScheduler = Effect.fn("makeWakeScheduler")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const conversations = yield* Conversations;
  const signals = yield* EngineSignals;

  const earliest = sql<{
    readonly wake_id: string;
    readonly owner_conversation_id: string;
    readonly at: number;
    readonly armed_seq: number;
    readonly fire_failures: number;
  }>`
    SELECT wake_id, owner_conversation_id, max(due_at, coalesce(retry_at, 0)) AS at, armed_seq,
      fire_failures
    FROM engine_wake
    WHERE state = 'armed' ORDER BY at, wake_id LIMIT 1
  `.pipe(
    Effect.map((rows) =>
      Option.map(Option.fromNullishOr(rows[0]), (row): DueWake => ({
        wakeId: row.wake_id as WakeId,
        owner: row.owner_conversation_id as ConversationId,
        at: row.at,
        armedSeq: row.armed_seq,
        failures: row.fire_failures,
      })),
    ),
    Effect.mapError((cause) => new EngineStoreError({ operation: "wakes.earliest", cause })),
  );

  /** Its owner could not take the fire (it failed to load): this wake backs off, others fire. */
  const backOff = Effect.fnUntraced(function* (wake: DueWake, error: unknown) {
    yield* Effect.logWarning("engine wake fire failed; it backs off", error);
    const now = yield* Clock.currentTimeMillis;
    const failures = wake.failures + 1;
    yield* sql`
      UPDATE engine_wake SET fire_failures = ${failures}, retry_at = ${now + wakeRetryMs(failures)}
      WHERE wake_id = ${wake.wakeId} AND state = 'armed' AND armed_seq = ${wake.armedSeq}
    `.pipe(Effect.mapError((cause) => new EngineStoreError({ operation: "wakes.retry", cause })));
  });

  const fire = Effect.fnUntraced(function* (wake: DueWake) {
    const told = yield* conversations
      .tell({
        commandId: wakeFiredCommandId(wake.wakeId, wake.armedSeq),
        conversationId: wake.owner,
        principal: ENGINE,
        command: { _tag: "WakeFired", wakeId: wake.wakeId, armedSeq: wake.armedSeq },
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catch((error) => Effect.as(backOff(wake, error), Option.none())),
      );
    if (Option.isNone(told)) return;
    const result = told.value;
    // The owner does not hold this arming: drop it so it cannot fire in a loop. A newer arming of
    // the same wake has another sequence and stays armed.
    if (result._tag === "Rejected") {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE engine_wake SET state = 'dropped', fired_at = ${now}
        WHERE wake_id = ${wake.wakeId} AND state = 'armed' AND armed_seq = ${wake.armedSeq}
      `.pipe(Effect.mapError((cause) => new EngineStoreError({ operation: "wakes.drop", cause })));
    }
  });

  /** Fires every armed wake due by `now`, earliest first; returns how many it fired. */
  const fireDue = Effect.fnUntraced(function* (now: number) {
    let fired = 0;
    while (fired < FIRE_BATCH) {
      const next = yield* earliest;
      if (Option.isNone(next) || next.value.at > now) break;
      yield* fire(next.value);
      fired++;
    }
    return fired;
  });

  /** One turn of the loop: fire what is due, else sleep until the earliest is or a ring. */
  const turn = Effect.gen(function* () {
    yield* signals.wakes.arm;
    const now = yield* Clock.currentTimeMillis;
    if ((yield* fireDue(now)) > 0) return;
    const next = yield* earliest;
    if (Option.isNone(next)) return yield* signals.wakes.wait;
    yield* Effect.raceFirst(Effect.sleep(Math.max(0, next.value.at - now)), signals.wakes.wait);
  });

  const loop = turn.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("engine wake scheduler turn failed", cause).pipe(
        Effect.andThen(Effect.sleep(1_000)),
      ),
    ),
    Effect.forever,
  );

  return {
    /** Fires what is due by `now`, as the loop does: boot and tests drive it directly. */
    fireDue,
    /** Starts the scheduler's fiber in the caller's scope. */
    start: Effect.asVoid(Effect.forkScoped(loop)) as Effect.Effect<void, never, Scope.Scope>,
  };
});
