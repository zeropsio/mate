/**
 * A production deployed outside Mate: an application whose `main` something else puts live on
 * every merge. HQ's shapes for it, shared by HQ and the clients. It is a person's statement, never
 * something HQ observes: nothing here says a deploy ran.
 *
 * - An application in HQ's `navigation` scope carries `outsideProduction` (`HqOutsideProduction`)
 *   only where somebody said so. It matters only while the application has no production of its
 *   own: one that is attached wins.
 * - `PUT /api/apps/:appId/outside-production` (`HqOutsideProductionRequest` →
 *   `HqOutsideProductionAnswer`) sets it with `outside: true` and an optional address, or lifts it
 *   with `outside: false`; an Owner or Admin writes it (`structurePermission`). HQ keeps the
 *   address as sent.
 *
 * @module hqOutsideProduction
 */
import * as Schema from "effect/Schema";

/** How long an address HQ takes is, at most. */
export const HQ_OUTSIDE_ADDRESS_MAX = 2048;

export const HqOutsideProduction = Schema.Struct({
  /** Where production answers, an absolute `http(s)` URL with a host; `null` where none was given. */
  address: Schema.NullOr(Schema.String),
  /** The Zerops user id of whoever said so. */
  setBy: Schema.String,
  /** ISO 8601. */
  setAt: Schema.String,
});
export type HqOutsideProduction = typeof HqOutsideProduction.Type;

export const HqOutsideProductionRequest = Schema.Union([
  Schema.Struct({
    outside: Schema.Literal(true),
    /** An `http(s)` URL, `HQ_OUTSIDE_ADDRESS_MAX` characters at most; `null`: none given. */
    address: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ outside: Schema.Literal(false) }),
]);
export type HqOutsideProductionRequest = typeof HqOutsideProductionRequest.Type;

/** The statement as it stands after the write; `null`: nobody says so. */
export const HqOutsideProductionAnswer = Schema.Struct({
  outsideProduction: Schema.NullOr(HqOutsideProduction),
});
export type HqOutsideProductionAnswer = typeof HqOutsideProductionAnswer.Type;
