/**
 * WakeScheduler: one fiber that sleeps until the earliest armed wake is due, re-reading when an
 * actor rings (a wake was armed, fired or cancelled). Firing is a `tell` of `WakeFired` to the
 * wake's owner; the owner's step marks the row fired in the same transaction as what the wake
 * starts, so a fire repeated after a crash finds nothing armed. A recurring wake keeps its cron:
 * the step that fires it arms its next time. Wakes that came due while the server was down fire
 * as soon as the scheduler starts.
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
  readonly dueAt: number;
}

const ENGINE = { kind: "engine" } as const;

export const makeWakeScheduler = Effect.fn("makeWakeScheduler")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const conversations = yield* Conversations;
  const signals = yield* EngineSignals;

  const earliest = sql<{
    readonly wake_id: string;
    readonly owner_conversation_id: string;
    readonly due_at: number;
  }>`
    SELECT wake_id, owner_conversation_id, due_at FROM engine_wake
    WHERE state = 'armed' ORDER BY due_at, wake_id LIMIT 1
  `.pipe(
    Effect.map((rows) =>
      Option.map(Option.fromNullishOr(rows[0]), (row): DueWake => ({
        wakeId: row.wake_id as WakeId,
        owner: row.owner_conversation_id as ConversationId,
        dueAt: row.due_at,
      })),
    ),
    Effect.mapError((cause) => new EngineStoreError({ operation: "wakes.earliest", cause })),
  );

  const fire = Effect.fnUntraced(function* (wake: DueWake) {
    const result = yield* conversations.tell({
      commandId: wakeFiredCommandId(wake.wakeId, wake.dueAt),
      conversationId: wake.owner,
      principal: ENGINE,
      command: { _tag: "WakeFired", wakeId: wake.wakeId },
    });
    // The owner does not hold it armed: drop the row so it cannot fire in a loop.
    if (result._tag === "Rejected") {
      const now = yield* Clock.currentTimeMillis;
      yield* sql`
        UPDATE engine_wake SET state = 'dropped', fired_at = ${now}
        WHERE wake_id = ${wake.wakeId} AND state = 'armed' AND due_at = ${wake.dueAt}
      `.pipe(Effect.mapError((cause) => new EngineStoreError({ operation: "wakes.drop", cause })));
    }
  });

  /** One turn of the loop: fire the earliest wake if due, else sleep until it is or a ring. */
  const turn = Effect.gen(function* () {
    yield* signals.wakes.arm;
    const next = yield* earliest;
    if (Option.isNone(next)) return yield* signals.wakes.wait;
    const now = yield* Clock.currentTimeMillis;
    if (next.value.dueAt <= now) return yield* fire(next.value);
    yield* Effect.raceFirst(Effect.sleep(next.value.dueAt - now), signals.wakes.wait);
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
    /** Starts the scheduler's fiber in the caller's scope. */
    start: Effect.asVoid(Effect.forkScoped(loop)) as Effect.Effect<void, never, Scope.Scope>,
  };
});
