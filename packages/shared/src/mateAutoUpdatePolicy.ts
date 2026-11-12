import * as Schema from "effect/Schema";

/** HQ's policy for its organization. Only a held policy that says off refuses an automatic update. */
export const HqAutoUpdatePolicy = Schema.Struct({
  orgId: Schema.String,
  enabled: Schema.Boolean,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type HqAutoUpdatePolicy = typeof HqAutoUpdatePolicy.Type;

export const SetAutoUpdatePolicy = Schema.Struct({ enabled: Schema.Boolean });

/**
 * How long an update waits for a Mate's work — its runs, its helpers, their reports — to be done
 * before it gives up: the Mate stays on its version and keeps working.
 */
export const MATE_UPDATE_DRAIN_MINUTES = 10;
