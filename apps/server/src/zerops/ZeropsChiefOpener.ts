/**
 * ZeropsChiefOpener — whom HQ lets open this Mate's Chief project: the one place the Mate reads it.
 *
 * Who may open a Chief is HQ's answer (its live registration's person, else its last registered
 * person; none when old history names several), not whose Chief it is (`ZeropsMateOwner`): a
 * registration that moved away leaves the maker the owner and the moved person the opener. HQ
 * sends it in each `state` frame (`chiefOpenerUserId`); the link hands it here (`named`), and the
 * access list's Chief filter (`ZeropsMateAccessList`) reads `opener`, so the tickets and
 * connections that follow that list follow it too.
 *
 * A state that omits it erases no known answer; a restart knows nobody until HQ names one.
 *
 * @module ZeropsChiefOpener
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

/**
 * Whom HQ lets open the Chief: a Zerops user id; `null` while HQ lets nobody; `undefined` until
 * HQ first names one since this server started.
 */
export type ChiefOpener = string | null | undefined;

export class ZeropsChiefOpener extends Context.Service<
  ZeropsChiefOpener,
  {
    /** Whom HQ last let open the Chief. */
    readonly opener: Effect.Effect<ChiefOpener>;
    /** Fires each time HQ names a different opener than it last did. */
    readonly changes: Stream.Stream<void>;
    /** The link's write: the opener a `state` frame names, `undefined` when it names none. */
    readonly named: (opener: ChiefOpener) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsChiefOpener") {}

export const make = Effect.gen(function* () {
  const opener = yield* Ref.make<ChiefOpener>(undefined);
  const moved = yield* PubSub.unbounded<void>();
  return ZeropsChiefOpener.of({
    opener: Ref.get(opener),
    changes: Stream.fromPubSub(moved),
    named: (next) =>
      next === undefined
        ? Effect.void
        : Ref.getAndSet(opener, next).pipe(
            Effect.flatMap((before) =>
              before === next ? Effect.void : PubSub.publish(moved, undefined),
            ),
          ),
  });
});

/** The one opener a running server reads: the HQ link writes it, nothing else does. */
export const layer = Layer.effect(ZeropsChiefOpener, make);
