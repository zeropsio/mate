import { subscribeUpdateChanges, type SubscribeUpdateChanges } from "./subscribeChanges.ts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

export interface ReactorDrainBoundary {
  readonly position: Effect.Effect<{
    readonly started: boolean;
    readonly domain: number;
    readonly runtime: number;
  }>;
  readonly changes: Stream.Stream<void>;
  readonly subscribeChanges: SubscribeUpdateChanges;
}

/** Watermarks name inputs actually received; a worker's drain separately proves their effects finished. */
export const makeReactorDrainBoundary = Effect.gen(function* () {
  const changed = yield* PubSub.sliding<void>(1);
  let started = false;
  let domain = 0;
  let runtime = 0;
  const ring = Effect.asVoid(PubSub.publish(changed, void 0));
  return {
    position: Effect.sync(() => ({ started, domain, runtime })),
    changes: Stream.fromPubSub(changed),
    subscribeChanges: subscribeUpdateChanges(changed),
    start: (initialDomain: number, initialRuntime: number) =>
      Effect.sync(() => {
        started = true;
        domain = initialDomain;
        runtime = initialRuntime;
      }).pipe(Effect.andThen(ring)),
    domain: <A, E, R>(sequence: number, consume: Effect.Effect<A, E, R>) =>
      consume.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            domain = Math.max(domain, sequence);
          }).pipe(Effect.andThen(ring)),
        ),
      ),
    runtime: <A, E, R>(sequence: number, consume: Effect.Effect<A, E, R>) =>
      consume.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            runtime = Math.max(runtime, sequence);
          }).pipe(Effect.andThen(ring)),
        ),
      ),
  };
});
