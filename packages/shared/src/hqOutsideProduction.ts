/**
 * A production deployed outside Mate: an application's production environment of the `outside`
 * kind (`HqOutsideEnvironment`), deployed by something HQ does not run. HQ's write for it, shared
 * by HQ and the clients. It is a person's statement, never something HQ observes: nothing here says
 * a deploy ran.
 *
 * - `PUT /api/apps/:appId/outside-production` (`HqOutsideProductionRequest` →
 *   `HqOutsideProductionAnswer`) states it with `outside: true` and an optional address, or lifts it
 *   with `outside: false`; an Owner or Admin writes it (`structurePermission`). HQ keeps the
 *   address as sent, and refuses it `production_attached` while the application holds a Zerops or
 *   Git production.
 *
 * @module hqOutsideProduction
 */
import * as Schema from "effect/Schema";

import { HqOutsideTarget } from "./hqEnvironment.ts";

/** How long an address HQ takes is, at most. */
export const HQ_OUTSIDE_ADDRESS_MAX = 2048;

export const HqOutsideProductionRequest = Schema.Union([
  Schema.Struct({
    outside: Schema.Literal(true),
    /** An `http(s)` URL, `HQ_OUTSIDE_ADDRESS_MAX` characters at most; `null`: none given. */
    address: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ outside: Schema.Literal(false) }),
]);
export type HqOutsideProductionRequest = typeof HqOutsideProductionRequest.Type;

/** The outside production's environment target after the write; `null`: none stands. */
export const HqOutsideProductionAnswer = Schema.Struct({
  outside: Schema.NullOr(HqOutsideTarget),
});
export type HqOutsideProductionAnswer = typeof HqOutsideProductionAnswer.Type;
