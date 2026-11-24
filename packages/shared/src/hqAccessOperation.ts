/**
 * An access change as navigation shows it under `access:<id>`: to its maker while it is open or
 * failed, and to an Owner or Admin while it waits (`mate-hq spec/protocol.md` S13a): its operation's id, the change cut to whom
 * and what it concerns (never a grant's role, a level or a membership), and its operation.
 */
import * as Schema from "effect/Schema";
import { HqOperationFailure } from "./hqOperationFailure.ts";

export const HqAccessOperation = Schema.Struct({
  id: Schema.String,
  change: Schema.Struct({
    kind: Schema.Literals(["projects", "app", "role", "remove", "invite", "resend", "readAccess"]),
    /** The changed person; absent for an invitation to an address without a Zerops account. */
    userId: Schema.optionalKey(Schema.String),
    appId: Schema.optionalKey(Schema.String),
    /** The projects it names: its grants', or a `readAccess` request's project. */
    projectIds: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  /** Its operation, as a birth's shows it; `continueBy` only while it waits for its maker's token. */
  operation: Schema.NullOr(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      kind: Schema.Literal("access"),
      phase: Schema.Literals([
        "accepted",
        "grants_requested",
        "removal_requested",
        "role_requested",
        "invite_requested",
      ]),
      at: Schema.String,
      acceptedAt: Schema.String,
      failure: Schema.optionalKey(
        Schema.Struct({
          ...HqOperationFailure.fields,
          step: Schema.Literals(["search", "grants", "role", "remove", "invite", "zerops"]),
        }),
      ),
      continueBy: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type HqAccessOperation = typeof HqAccessOperation.Type;
