import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import type { CommandTag } from "./domain/command.ts";

export const UPDATE_DRAIN_MESSAGE =
  "Update ready; waiting for your work to finish. Try again after the update.";

/** Only inputs that settle or stop accepted work may cross a closed admission fence. */
export const allowedDuringUpdate = (tag: CommandTag): boolean => {
  switch (tag) {
    case "Stop":
    case "Answer":
    case "CloseSession":
    case "CancelWake":
    case "EffectSettled":
    case "ProviderSignals":
    case "Recovered":
      return true;
    default:
      return false;
  }
};

export const makeUpdateAdmission = Effect.gen(function* () {
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
    /** Fence and receipt share one serialization point; no checked-but-not-accepted input escapes. */
    run: <A, E, R>(
      tag: CommandTag,
      accept: Effect.Effect<A, E, R>,
    ): Effect.Effect<A | undefined, E, R> =>
      allowedDuringUpdate(tag)
        ? accept
        : lock.withPermits(1)(
            Effect.suspend(() =>
              closed ? Effect.succeed(undefined) : Effect.uninterruptible(accept),
            ),
          ),
  };
});

export type UpdateAdmission = Effect.Success<typeof makeUpdateAdmission>;
