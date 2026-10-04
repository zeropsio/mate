/**
 * crewLockWait — a crewmate's lock taken within a bounded wait: only the wait
 * is bounded, never the work that runs once the lock is held.
 *
 * @module crewLockWait
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Semaphore from "effect/Semaphore";
import type * as Duration from "effect/Duration";

export const withPermitWithin =
  (lock: Semaphore.Semaphore, wait: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Option.Option<A>, E, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(restore(Effect.timeoutOption(lock.take(1), wait)), (taken) =>
        Option.isNone(taken)
          ? Effect.succeed(Option.none<A>())
          : restore(effect).pipe(Effect.map(Option.some), Effect.ensuring(lock.release(1))),
      ),
    );
