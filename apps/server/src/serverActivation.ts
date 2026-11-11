import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import { MateUpdateBootFence } from "./mateUpdateBoot.ts";

export class ServerActivation extends Context.Reference<Effect.Effect<void> | undefined>(
  "t3/serverActivation",
  { defaultValue: () => undefined },
) {}

/**
 * Forks a long-running root and proves it is parked at the activation boundary. It runs once the
 * server is activated and an update's boot fence (`MateUpdateBootFence`) has lifted.
 */
export const forkParked = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const activation = yield* ServerActivation;
    const fenced = (yield* MateUpdateBootFence).lifted.pipe(Effect.andThen(effect));
    if (activation === undefined) {
      yield* Effect.forkScoped(fenced);
      return;
    }
    const parked = yield* Deferred.make<void>();
    yield* Effect.forkScoped(
      Deferred.succeed(parked, undefined).pipe(Effect.andThen(activation), Effect.andThen(fenced)),
    );
    yield* Deferred.await(parked);
  });
