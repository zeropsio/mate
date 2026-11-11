/** Personal observe authority metadata; the credential itself never enters a client. */
import * as Schema from "effect/Schema";
export const ObserveCredential = Schema.Struct({
  authorized: Schema.Boolean,
  userId: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
});
export type ObserveCredential = typeof ObserveCredential.Type;
