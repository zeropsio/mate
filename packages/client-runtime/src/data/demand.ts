/**
 * What the account observes, and what that costs each source (HANDOFF §4.1, §4.2). Navigation is
 * always demanded: for Zerops it is a constant set of organization registrations, never one per
 * menu row — for every family that declares a Zerops source, a pair: a membership `listStream`,
 * whose answer is the scope's baseline, and an `updateStream` of whole rows.
 *
 * Request shapes as measured: `klient/probe-org-data/20261005T184903Z-registration-formats.jsonl`.
 *
 * @module data/demand
 */
import { FAMILIES } from "./families/index.ts";
import { scopeOf, type SearchTerms } from "./families/spec.ts";
import type { Family, ScopeKey } from "./model.ts";

export interface Registration {
  readonly scope: ScopeKey;
  readonly family: Family;
  /** `membership`: a `listStream`, answered with the baseline. `updates`: an `updateStream`. */
  readonly role: "membership" | "updates";
  readonly path: string;
  readonly search: SearchTerms;
}

/** A whole organization's search: the platform answers up to this many rows in one page. */
export const ORGANIZATION_SEARCH_LIMIT = 2000;

/** The organization's navigation on Zerops: one registration pair per Zerops family. */
export function zeropsNavigation(orgId: string): ReadonlyArray<Registration> {
  return FAMILIES.flatMap((spec): Registration[] => {
    if (spec.zerops === undefined) return [];
    const scope = scopeOf(spec, orgId);
    const path = `/${spec.zerops.entity}/search`;
    // Updates register before membership: an update racing the baseline is caught, never lost.
    return [
      { scope, family: spec.family, role: "updates", path, search: spec.zerops.updates(orgId) },
      {
        scope,
        family: spec.family,
        role: "membership",
        path,
        search: spec.zerops.membership(orgId),
      },
    ];
  });
}
