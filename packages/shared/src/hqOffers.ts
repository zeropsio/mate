/**
 * What HQ offers a person, beside each thing its structure streams them (`apps/hq/src/offers.ts`):
 * a `can` record of verb to decision — the same `can` (`apps/hq/src/permissions.ts`) over the same target
 * HQ enforces the write with, over the org as HQ last read it. The write itself is decided again at
 * the press, and its refusal wins.
 *
 * - **The record is open.** A verb this build does not know, or a decision it cannot read, is
 *   unknown — never a broken snapshot, never a guess. Each decision is read on its own.
 * - **A Mate's moves** (`moveTo`) are choices, not a verb: each application, or `new`, with the
 *   kinds the move rule lets it take there; none listed is nowhere.
 * - **Four states a control draws** (`hqOffer`): allowed, refused with HQ's reason (its words are
 *   `hq/refusals.ts`'), unknown — nothing streamed yet, the thing absent, the verb unanswered — and
 *   unavailable since HQ stopped answering. A re-read in flight keeps the last record. Nothing
 *   compares a time to now.
 *
 * Pure.
 *
 * @module hqOffers
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { Decision } from "./zeropsPermissions.ts";

/** One verb's decision as HQ sends it: its reason open, so a later HQ's reason is still read. */
export const HqDecision = Schema.Union([
  Schema.Struct({ allow: Schema.Literal(true) }),
  Schema.Struct({ allow: Schema.Literal(false), reason: Schema.String }),
]);
export type HqDecision = typeof HqDecision.Type;

/** A `can` record as it travels: open, each decision read on its own (`hqOffer`). */
export const HqOffers = Schema.Record(Schema.String, Schema.Unknown);
export type HqOffers = typeof HqOffers.Type;

/**
 * Where HQ lets the reader move a Mate (`moveTo`): each application by id, and `new` — one they
 * make for it — with the kinds it may take there. A kind this build does not know is passed by.
 */
export const HqMoveTo = Schema.Record(Schema.String, Schema.Array(Schema.String));
export type HqMoveTo = typeof HqMoveTo.Type;

export const HqMoveRefusals = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, Schema.String),
);
export type HqMoveRefusals = typeof HqMoveRefusals.Type;

/** A `can` record as HQ writes it: a decision for each of `V`. */
export type HqOffersOf<V extends string> = { readonly [K in V]: Decision };

/** What a control draws for one verb. */
export type HqOfferState =
  | { readonly kind: "allowed" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unknown" }
  /** HQ does not answer: since when, wall ms. */
  | { readonly kind: "unavailable"; readonly since: number };

const readDecision = Schema.decodeUnknownOption(HqDecision);

/**
 * One verb's state, from the `can` record HQ last streamed and whether HQ answers now: once it
 * stopped answering, every HQ-enforced verb is unavailable since then, whatever it said before;
 * while it is only being read again, what it said last stands.
 */
export function hqOffer(
  can: HqOffers | undefined,
  verb: string,
  hq: { readonly current: boolean; readonly unavailableSince: number | null },
): HqOfferState {
  if (!hq.current && hq.unavailableSince !== null) {
    return { kind: "unavailable", since: hq.unavailableSince };
  }
  return Option.match(readDecision(can?.[verb]), {
    onNone: (): HqOfferState => ({ kind: "unknown" }),
    onSome: (decision): HqOfferState =>
      decision.allow ? { kind: "allowed" } : { kind: "refused", reason: decision.reason },
  });
}
