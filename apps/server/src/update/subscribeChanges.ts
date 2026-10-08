import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";

export type UpdateChangeSubscription = { readonly changes: Stream.Stream<void> };
export type SubscribeUpdateChanges = Effect.Effect<UpdateChangeSubscription, never, Scope.Scope>;

/** Acquisition happens here, before a caller reads facts or forks the stream consumer. */
export const subscribeUpdateChanges = <A>(hub: PubSub.PubSub<A>): SubscribeUpdateChanges =>
  PubSub.subscribe(hub).pipe(
    Effect.map((subscription) => ({
      changes: Stream.fromSubscription(subscription).pipe(Stream.map(() => void 0)),
    })),
  );

export const mergeUpdateSubscriptions = (
  subscriptions: ReadonlyArray<SubscribeUpdateChanges>,
): SubscribeUpdateChanges =>
  Effect.all(subscriptions).pipe(
    Effect.map((sources) => ({
      changes: Stream.mergeAll(
        sources.map((source) => source.changes),
        { concurrency: "unbounded" },
      ),
    })),
  );
