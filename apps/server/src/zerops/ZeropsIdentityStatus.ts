/**
 * ZeropsIdentityStatus — whether this Mate can currently prove who is
 * knocking, for the descriptor to state (brief §4 S4).
 *
 * The door (`ZeropsThrowawayIdentity.verifyThrowawayCaller`) and the
 * membership watch (`ZeropsMembershipWatch.readProjectMembership`) both make
 * the same read — `GET /project/{own}` with the Mate's own key — and both
 * record here what it just answered. `/.well-known/t3/environment`
 * (`ServerEnvironment.ts`) reads this Ref rather than making a read of its
 * own: the descriptor is a report of the last real attempt, never a probe in
 * its own right.
 *
 * `"unknown"` is the value before either of them has run once — a fixture
 * container, or a live one in the instant between the layer starting and the
 * watch's first pass (non-blocking: the descriptor is servable immediately;
 * it just says less until then).
 *
 * @module ZeropsIdentityStatus
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type { ZeropsMateKeySource } from "./ZeropsMateKey.ts";

export interface ZeropsIdentityStatusValue {
  readonly identity: "unknown" | "ok" | "failed";
  /** ISO instant of the read that produced this verdict, `undefined` before the first one. */
  readonly identityCheckedAt: string | undefined;
  /** Which key source that read used — `undefined` before the first one, or when neither had a key. */
  readonly keySource: ZeropsMateKeySource | undefined;
}

export const ZEROPS_IDENTITY_STATUS_UNKNOWN: ZeropsIdentityStatusValue = {
  identity: "unknown",
  identityCheckedAt: undefined,
  keySource: undefined,
};

export class ZeropsIdentityStatus extends Context.Service<
  ZeropsIdentityStatus,
  {
    readonly current: Effect.Effect<ZeropsIdentityStatusValue>;
    /** Records the verdict of one own-project read. Never the key itself. */
    readonly record: (input: {
      readonly ok: boolean;
      readonly keySource: ZeropsMateKeySource | undefined;
    }) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsIdentityStatus") {}

export const layer = Layer.effect(
  ZeropsIdentityStatus,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ZeropsIdentityStatusValue>(ZEROPS_IDENTITY_STATUS_UNKNOWN);
    const record: ZeropsIdentityStatus["Service"]["record"] = (input) =>
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        yield* Ref.set(ref, {
          identity: input.ok ? "ok" : "failed",
          identityCheckedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
          keySource: input.keySource,
        });
      });
    return ZeropsIdentityStatus.of({ current: Ref.get(ref), record });
  }),
);
