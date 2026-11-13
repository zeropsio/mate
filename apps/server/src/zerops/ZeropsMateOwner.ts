/**
 * ZeropsMateOwner — whom HQ names this Mate's owner: the one place the Mate reads it.
 *
 * A Mate's owner is HQ's record (its maker, then whoever signs its agent in as the Mate reports it,
 * or the person a hand-over names; a registered Chief's, its registered person). The Mate derives
 * none: not from its project's Zerops `OWNER` override, nor from who signed a login in. HQ sends it
 * in each `state` frame (`ownerUserId`, absent when HQ knows none); the link hands it here
 * (`named`), and everything else in the Mate that asks whose it is reads `owner`: the hand-over
 * sign-out (`ZeropsOffboarding`).
 * The act gate (`ZeropsHqLink.actingIn`) reads it too, so the owner it names holds across link
 * loss and a refused key.
 *
 * HQ's last word holds while the link is down; a restart knows nobody until HQ's first state.
 *
 * @module ZeropsMateOwner
 */
import type { ZeropsUserId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

/**
 * Whom HQ names the Mate's owner: a Zerops user id; `null` while HQ names none; `undefined` until
 * HQ's first state since this server started.
 */
export type MateOwner = ZeropsUserId | null | undefined;

export class ZeropsMateOwner extends Context.Service<
  ZeropsMateOwner,
  {
    /** Whom HQ last named the owner. */
    readonly owner: Effect.Effect<MateOwner>;
    /** Fires each time HQ names a different owner than it last did. */
    readonly changes: Stream.Stream<void>;
    /** The link's write: the owner a `state` frame names (`null` when it names none). */
    readonly named: (owner: ZeropsUserId | null) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsMateOwner") {}

export const make = Effect.gen(function* () {
  const owner = yield* Ref.make<MateOwner>(undefined);
  const moved = yield* PubSub.unbounded<void>();
  return ZeropsMateOwner.of({
    owner: Ref.get(owner),
    changes: Stream.fromPubSub(moved),
    named: (next) =>
      Ref.getAndSet(owner, next).pipe(
        Effect.flatMap((before) =>
          before === next ? Effect.void : PubSub.publish(moved, undefined),
        ),
      ),
  });
});

/** The one owner a running server reads: the HQ link writes it, nothing else does. */
export const layer = Layer.effect(ZeropsMateOwner, make);
