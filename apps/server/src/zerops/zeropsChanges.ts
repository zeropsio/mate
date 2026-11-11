/**
 * Waiting on the change streams of a decision's inputs instead of looking again on a timer.
 *
 * @module zeropsChanges
 */
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

/**
 * Subscribes to every stream now, in the caller's scope, and answers the wait for the next
 * change of any of them since the subscription or the last wait; changes nobody waited for fold
 * into one. A stream subscribes on its first pull, so each reader starts at once and runs to that
 * pull before this returns (a merged stream would subscribe in fibers of its own, later): a look
 * taken after it misses no change.
 */
export const subscribeChanges = (
  streams: ReadonlyArray<Stream.Stream<unknown>>,
): Effect.Effect<Effect.Effect<void>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const moved = yield* Queue.sliding<void>(1);
    for (const stream of streams) {
      yield* Stream.runForEach(stream, () => Queue.offer(moved, undefined)).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
    }
    return Queue.take(moved);
  });
