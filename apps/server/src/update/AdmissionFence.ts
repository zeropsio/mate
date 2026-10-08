import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

export const makeAdmissionFence = <Tag extends string>(allowed: (tag: Tag) => boolean) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const changed = yield* PubSub.sliding<void>(1);
    let closed = false;
    const set = (value: boolean) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          closed = value;
          yield* PubSub.publish(changed, void 0);
        }),
      );
    return {
      begin: set(true),
      cancel: set(false),
      closed: Effect.sync(() => closed),
      changes: Stream.fromPubSub(changed),
      run: <A, E, R>(
        tag: Tag,
        accept: Effect.Effect<A, E, R>,
      ): Effect.Effect<A | undefined, E, R> =>
        allowed(tag)
          ? accept
          : lock.withPermits(1)(
              Effect.suspend(() =>
                closed ? Effect.succeed(undefined) : Effect.uninterruptible(accept),
              ),
            ),
    };
  });
