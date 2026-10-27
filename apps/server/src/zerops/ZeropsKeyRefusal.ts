import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

/** Kept in memory only: a refusal belongs to the key sent on that request. */
export interface KeyRefusal {
  readonly refusedKey: string;
  readonly currentKey: string | undefined;
}

export interface ZeropsKeyRefusal {
  readonly changes: Stream.Stream<KeyRefusal>;
  readonly check: (key: string, status: number) => Effect.Effect<string | undefined>;
}

export const make = (readFresh: Effect.Effect<string | undefined>) =>
  Effect.gen(function* () {
    const latest = yield* SubscriptionRef.make<Option.Option<KeyRefusal>>(Option.none());
    const lock = yield* Semaphore.make(1);
    return {
      changes: SubscriptionRef.changes(latest).pipe(
        Stream.filter(Option.isSome),
        Stream.map((value) => value.value),
      ),
      check: (refusedKey: string, status: number) =>
        Effect.gen(function* () {
          const currentKey = yield* readFresh;
          // A resource's 403 is not evidence that its credential is invalid. The platform
          // currently supplies definite credential refusal as 401 (as in zcp's hook).
          if (status === 401) {
            yield* SubscriptionRef.update(latest, (previous) =>
              // A late reply for the old key cannot erase the current key's own refusal.
              Option.isSome(previous) &&
              previous.value.refusedKey === currentKey &&
              previous.value.currentKey === currentKey
                ? previous
                : Option.some({ refusedKey, currentKey }),
            );
          }
          return currentKey;
        }).pipe(lock.withPermits(1)),
    } satisfies ZeropsKeyRefusal;
  });
