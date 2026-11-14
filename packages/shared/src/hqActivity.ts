/**
 * An organization's activity, as HQ answers it (`spec/protocol.md`, Activity): who — a person, a
 * Mate, GitHub, HQ or an HQ operator — did what in the organization, newest first, one page at a
 * time. Only the organization's Owners and Admins read it.
 *
 * - `GET /api/activity?before=&limit=` (`HqActivityPage`): a page of entries; `next` is the `before`
 *   that reads the page after it, `null` on the last.
 *
 * @module hqActivity
 */
import * as Schema from "effect/Schema";

/** Who acted. */
export const HqActivityActor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("person"), userId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("mate"),
    mateProjectId: Schema.String,
    /** The person the Mate acted for, `null` when none was named. */
    forUserId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("github") }),
  Schema.Struct({ kind: Schema.Literal("core") }),
  /** An HQ operator, never named. */
  Schema.Struct({ kind: Schema.Literal("operator") }),
]);
export type HqActivityActor = typeof HqActivityActor.Type;

export const HqActivityEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  action: Schema.String,
  /** `unknown`: it may have taken effect, and its result never arrived. */
  outcome: Schema.Literals(["ok", "failed", "refused", "unknown"]),
  actor: HqActivityActor,
  appId: Schema.NullOr(Schema.String),
  repo: Schema.NullOr(Schema.String),
  number: Schema.NullOr(Schema.Number),
  subjectId: Schema.NullOr(Schema.String),
  subjectLabel: Schema.NullOr(Schema.String),
  sha: Schema.NullOr(Schema.String),
});
export type HqActivityEntry = typeof HqActivityEntry.Type;

export const HqActivityPage = Schema.Struct({
  entries: Schema.Array(HqActivityEntry),
  next: Schema.NullOr(Schema.String),
});
export type HqActivityPage = typeof HqActivityPage.Type;
