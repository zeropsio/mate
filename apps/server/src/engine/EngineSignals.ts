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
import * as PubSub from "effect/PubSub";
import type { ConversationId } from "@t3tools/contracts";

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

/**
 * One ring heard by several consumers, each with its own latch: one consumer's `arm` never closes
 * a ring another has yet to wait on.
 */
export interface Doorbells {
  readonly ring: Effect.Effect<void>;
  /** A consumer's own doorbell, rung with every ring from now on. */
  readonly consumer: Effect.Effect<Doorbell>;
}

export const makeDoorbells = Effect.sync((): Doorbells => {
  const consumers = new Set<Doorbell>();
  return {
    ring: Effect.forEach(consumers, (bell) => bell.ring, { discard: true }),
    consumer: Effect.tap(makeDoorbell, (bell) => Effect.sync(() => consumers.add(bell))),
  };
});

export interface EngineSignalsShape {
  /** Outbox rows were queued or requeued: each worker pool hears it on its own doorbell. */
  readonly effects: Doorbells;
  /** A wake was armed, fired or cancelled. */
  readonly wakes: Doorbell;
  /** A conversation committed events: its view may have changed (the grafts' `changes`). */
  readonly commits: PubSub.PubSub<ConversationId>;
}

export class EngineSignals extends Context.Service<EngineSignals, EngineSignalsShape>()(
  "t3/engine/EngineSignals",
) {}

/** A conversation's commits, for whoever reads views: it never holds a writer back. */
export const makeCommits = PubSub.sliding<ConversationId>(256);

export const layer = Layer.effect(
  EngineSignals,
  Effect.all({ effects: makeDoorbells, wakes: makeDoorbell, commits: makeCommits }),
);
