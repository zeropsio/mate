import { subscribeUpdateChanges } from "./subscribeChanges.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

/** Reserve before spawning: a detached operation is still work after its caller leaves. */
export const makeOwnedWork = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const changed = yield* PubSub.sliding<void>(1);
  let active = 0;
  const mark = (delta: number) =>
    Effect.sync(() => {
      active += delta;
    }).pipe(Effect.andThen(PubSub.publish(changed, void 0)), Effect.asVoid);
  const fork = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.uninterruptibleMask((restore) =>
      mark(1).pipe(
        Effect.andThen(Effect.forkIn(restore(effect).pipe(Effect.ensuring(mark(-1))), scope)),
      ),
    );
  return {
    drain: Effect.scoped(
      Effect.gen(function* () {
        const subscription = yield* subscribeUpdateChanges(changed);
        if (active === 0) return;
        yield* Stream.runDrain(subscription.changes.pipe(Stream.takeUntil(() => active === 0)));
      }),
    ),
    active: Effect.sync(() => active),
    changes: Stream.fromPubSub(changed),
    subscribeChanges: subscribeUpdateChanges(changed),
    fork,
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        mark(1),
        () => effect,
        () => mark(-1),
      ),
    join: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flatMap(fork(effect), Fiber.join),
  };
});
