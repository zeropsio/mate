import * as Schema from "effect/Schema";

/** HQ's policy for its organization. Absence never grants automatic-update permission. */
export const HqAutoUpdatePolicy = Schema.Struct({
  orgId: Schema.String,
  enabled: Schema.Boolean,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type HqAutoUpdatePolicy = typeof HqAutoUpdatePolicy.Type;

export const SetAutoUpdatePolicy = Schema.Struct({ enabled: Schema.Boolean });
