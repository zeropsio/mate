import type * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

/** One event per pull: the consumer's next pull acknowledges its previous handler returned. */
export const handledQueue = <A>(deadline: Duration.Input = "5 seconds") =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<{
      readonly event: A;
      readonly handled: Deferred.Deferred<void>;
    }>();
    let last: Deferred.Deferred<void> | undefined;
    const events = Stream.fromEffectRepeat(
      Effect.suspend(() => {
        const done = last === undefined ? Effect.void : Deferred.succeed(last, undefined);
        last = undefined;
        return done.pipe(
          Effect.andThen(Queue.take(queue)),
          Effect.map((published) => {
            last = published.handled;
            return published.event;
          }),
        );
      }),
    );
    return {
      events,
      publish: (event: A) =>
        Effect.gen(function* () {
          const handled = yield* Deferred.make<void>();
          yield* Queue.offer(queue, { event, handled });
          yield* Deferred.await(handled);
        }).pipe(Effect.timeout(deadline), Effect.orDie),
    };
  });
