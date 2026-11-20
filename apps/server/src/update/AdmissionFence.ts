import { subscribeUpdateChanges } from "./subscribeChanges.ts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

/**
 * An update's admission fence. Closed, it takes only what `allowed` names; sealed (once the
 * update's final idle proof is under way) it refuses too what `sealable` names, so nothing the
 * proof has read changes before the restart. Opening the fence or beginning again unseals it.
 */
export const makeAdmissionFence = <Tag extends string>(
  allowed: (tag: Tag) => boolean,
  sealable: (tag: Tag) => boolean = () => false,
) =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const changed = yield* PubSub.sliding<void>(1);
    let closed = false;
    let sealed = false;
    const set = (value: boolean) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          closed = value;
          sealed = false;
          yield* PubSub.publish(changed, void 0);
        }),
      );
    // Under the lock, the seal waits for an input it refuses that is already being taken.
    const seal = (value: boolean) =>
      lock.withPermits(1)(
        Effect.sync(() => {
          sealed = value && closed;
        }),
      );
    const guarded = <A, E, R>(refused: () => boolean, accept: Effect.Effect<A, E, R>) =>
      lock.withPermits(1)(
        Effect.suspend(() =>
          refused() ? Effect.succeed(undefined) : Effect.uninterruptible(accept),
        ),
      );
    return {
      begin: set(true),
      cancel: set(false),
      seal: seal(true),
      unseal: seal(false),
      closed: Effect.sync(() => closed),
      changes: Stream.fromPubSub(changed),
      subscribeChanges: subscribeUpdateChanges(changed),
      run: <A, E, R>(
        tag: Tag,
        accept: Effect.Effect<A, E, R>,
      ): Effect.Effect<A | undefined, E, R> =>
        !allowed(tag)
          ? guarded(() => closed, accept)
          : sealable(tag)
            ? guarded(() => sealed, accept)
            : accept,
    };
  });
