/**
 * EngineSignals: the doorbells an actor rings after a commit, so the effect worker and the wake
 * scheduler look again without polling. A consumer `arm`s, checks for work, and `wait`s only when
 * it found none: a ring between the check and the wait opens the latch, so no wake-up is lost.
 *
 * @module engine/EngineSignals
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";

export interface Doorbell {
  /** Tell the consumer there is something new. */
  readonly ring: Effect.Effect<void>;
  /** Before looking for work: rings from now on are remembered. */
  readonly arm: Effect.Effect<void>;
  /** After finding no work: returns at the next ring, or at once if one came since `arm`. */
  readonly wait: Effect.Effect<void>;
}

export const makeDoorbell = Effect.gen(function* () {
  const latch = yield* Latch.make(false);
  return {
    ring: Effect.asVoid(latch.open),
    arm: Effect.asVoid(latch.close),
    wait: latch.await,
  } satisfies Doorbell;
});

export interface EngineSignalsShape {
  /** Outbox rows were queued or requeued. */
  readonly effects: Doorbell;
  /** A wake was armed, fired or cancelled. */
  readonly wakes: Doorbell;
}

export class EngineSignals extends Context.Service<EngineSignals, EngineSignalsShape>()(
  "t3/engine/EngineSignals",
) {}

export const layer = Layer.effect(
  EngineSignals,
  Effect.all({ effects: makeDoorbell, wakes: makeDoorbell }),
);
