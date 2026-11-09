/**
 * What the client offers a person of HQ's verbs, beside each thing HQ's structure streams: a `can`
 * record of verb to decision, decided by the verb rule (`zeropsOffers.ts`) over the client's own
 * live read of Zerops — the person's membership and each project's override for them.
 * HQ streams no verdict; it decides each write again on the person's fresh read, and its refusal
 * wins.
 *
 * - **A verb not decided is unknown** — Zerops not read yet, the thing absent — never a guess.
 * - **A Mate's moves** (`moveTo`) are choices, not a verb: each application, or `new`, with the
 *   kinds the move rule lets it take there; HQ answers them as the move opens.
 * - **Three states a control draws** (`hqOffer`): allowed, refused with the rule's reason (its words
 *   are `hq/refusals.ts`'), and unknown. HQ away changes none of them: a write while it is away is
 *   answered at once (`hqAwayAnswer`).
 *
 * Pure.
 *
 * @module hqOffers
 */
import * as Schema from "effect/Schema";

/** One verb's decision as a gate HQ streams carries it: its reason open, so a later HQ's is read. */
export const HqDecision = Schema.Union([
  Schema.Struct({ allow: Schema.Literal(true) }),
  Schema.Struct({ allow: Schema.Literal(false), reason: Schema.String }),
]);
export type HqDecision = typeof HqDecision.Type;

/** A `can` record: each verb decided, by verb. */
export type HqOffers = Readonly<Record<string, HqDecision>>;

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

/** An application's verbs as `applicationOffers` decides the ones a fixture names. */
export type HqApplicationVerb =
  | "add_mate"
  | "structure"
  | "release"
  | "add_stage"
  | "add_production"
  | "add_git_environment";
export type HqApplicationOffers = { readonly [K in HqApplicationVerb]?: HqDecision };

/**
 * The verb HQ admits every write to a repository's remote on: mirroring it through the GitHub app
 * or with a token, its token, its address, disconnecting it, following a GitHub repository.
 */
export const HQ_REMOTE_WRITE_VERB = "structure" satisfies HqApplicationVerb;

/** What a control draws for one verb. */
export type HqOfferState =
  | { readonly kind: "allowed" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unknown" };

/** One verb's state, from its `can` record as last read. */
export function hqOffer(can: HqOffers | undefined, verb: string): HqOfferState {
  const decision = can?.[verb];
  if (decision === undefined) return { kind: "unknown" };
  return decision.allow ? { kind: "allowed" } : { kind: "refused", reason: decision.reason };
}
