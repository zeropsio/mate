import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

/**
 * Kept in memory only: a refusal belongs to the key sent on that request and to the admission HQ
 * had last named when the request started, none before HQ's first state (`ZeropsHqLink` decides).
 */
export interface KeyRefusal {
  readonly refusedKey: string;
  readonly currentKey: string | undefined;
  readonly admission: string | undefined;
}

export interface ZeropsKeyRefusal {
  readonly changes: Stream.Stream<KeyRefusal>;
  /** The admission a request starting now runs under, read through the link's reader; none before it. */
  readonly admission: Effect.Effect<string | undefined>;
  /** Installs the link's reader of the admission HQ last named, once, as the link is built. */
  readonly installAdmission: (read: () => string | undefined) => Effect.Effect<void>;
  /** `admission` is what {@link ZeropsKeyRefusal.admission} answered as the request started. */
  readonly check: (
    key: string,
    status: number,
    admission: string | undefined,
  ) => Effect.Effect<string | undefined>;
}

export const make = (readFresh: Effect.Effect<string | undefined>) =>
  Effect.gen(function* () {
    const latest = yield* SubscriptionRef.make<Option.Option<KeyRefusal>>(Option.none());
    let readAdmission: () => string | undefined = () => undefined;
    return {
      changes: SubscriptionRef.changes(latest).pipe(
        Stream.filter(Option.isSome),
        Stream.map((value) => value.value),
      ),
      admission: Effect.sync(() => readAdmission()),
      installAdmission: (read) =>
        Effect.sync(() => {
          readAdmission = read;
        }),
      check: (refusedKey, status, admission) =>
        Effect.gen(function* () {
          const currentKey = yield* readFresh;
          // A resource's 403 is not evidence that its credential is invalid. The platform
          // currently supplies definite credential refusal as 401 (as in zcp's hook).
          if (status === 401)
            yield* SubscriptionRef.set(latest, Option.some({ refusedKey, currentKey, admission }));
          return currentKey;
        }),
    } satisfies ZeropsKeyRefusal;
  });
