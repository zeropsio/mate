/**
 * Who merges an application's changes, where it limits that: HQ's shapes for the setting, shared by
 * HQ and the clients.
 *
 * - An application in HQ's `navigation` scope carries `mergers` (`HqMergers`) only where it limits
 *   who merges: the organization's Owner and Admins, and the people it names. Absent: whoever may
 *   push merges.
 * - `PUT /api/apps/:appId/mergers` (`HqMergersRequest` → `HqMergersAnswer`) sets the limit, or
 *   lifts it with `people: null`; an Owner or Admin writes it (`structurePermission`).
 *
 * HQ enforces it on a merge and on a release to a Git production (`not_app_merger`,
 * `zeropsPermissions.ts`).
 *
 * @module hqMergers
 */
import * as Schema from "effect/Schema";

/** How many people an application names beside the organization's Owner and Admins, at most. */
export const HQ_MERGERS_MAX = 50;

export const HqMergers = Schema.Struct({
  /** Zerops user ids named beside the organization's Owner and Admins; may be empty. */
  people: Schema.Array(Schema.String),
  /** The Zerops user id of whoever set it. */
  setBy: Schema.String,
  /** ISO 8601. */
  setAt: Schema.String,
});
export type HqMergers = typeof HqMergers.Type;

export const HqMergersRequest = Schema.Struct({
  /** Distinct Zerops user ids, `HQ_MERGERS_MAX` at most; `null` lifts the limit. */
  people: Schema.NullOr(Schema.Array(Schema.String)),
});
export type HqMergersRequest = typeof HqMergersRequest.Type;

/** The limit as it stands after the write; `null`: whoever may push merges. */
export const HqMergersAnswer = Schema.Struct({ mergers: Schema.NullOr(HqMergers) });
export type HqMergersAnswer = typeof HqMergersAnswer.Type;
