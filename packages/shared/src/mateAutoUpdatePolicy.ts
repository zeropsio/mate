import * as Schema from "effect/Schema";

/** HQ's policy for its organization. Absence never grants automatic-update permission. */
export const HqAutoUpdatePolicy = Schema.Struct({
  orgId: Schema.String,
  enabled: Schema.Boolean,
  epoch: Schema.optionalKey(Schema.String),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type HqAutoUpdatePolicy = typeof HqAutoUpdatePolicy.Type;

export const SetAutoUpdatePolicy = Schema.Struct({ enabled: Schema.Boolean });

/**
 * How long an update waits for a Mate's work — its runs, its helpers, their reports — to be done
 * before it gives up: the Mate stays on its version and keeps working.
 */
export const MATE_UPDATE_DRAIN_MINUTES = 10;
