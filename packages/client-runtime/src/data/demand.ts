/**
 * What the account observes, and what that costs each source (HANDOFF §4.1, §4.2). Navigation is
 * always demanded: for Zerops a constant set of organization registrations, never one per menu row.
 * A detail family is registered only for the owners a screen demands it for (one project's
 * services while that project is open). Each observed scope is a pair: a membership `listStream`,
 * whose answer is the scope's baseline, and an `updateStream` of whole rows.
 *
 * Request shapes as measured: `klient/probe-org-data/20261005T184903Z-registration-formats.jsonl`.
 *
 * @module data/demand
 */
import { FAMILIES } from "./families/index.ts";
import { scopeOf, type AnyFamilySpec, type ScopeOwner, type SearchTerms } from "./families/spec.ts";
import type { Family, ScopeKey } from "./model.ts";

export interface Registration {
  readonly scope: ScopeKey;
  readonly family: Family;
  /** `membership`: a `listStream`, answered with the baseline. `updates`: an `updateStream`. */
  readonly role: "membership" | "updates";
  readonly path: string;
  readonly search: SearchTerms;
}

/** A detail family demanded for one owner, while a screen holds it. */
export interface DetailDemand {
  readonly family: Family;
  readonly ownerId: string;
}

/** A whole organization's search: the platform answers up to this many rows in one page. */
export const ORGANIZATION_SEARCH_LIMIT = 2000;

/** The Zerops registrations for the organization's navigation and the details demanded now. */
export function zeropsRegistrations(
  families: ReadonlyArray<AnyFamilySpec>,
  orgId: string,
  details: ReadonlyArray<DetailDemand>,
): ReadonlyArray<Registration> {
  const pair = (spec: AnyFamilySpec, owner: ScopeOwner): Registration[] => {
    if (spec.zerops === undefined) return [];
    const scope =
      owner.ownerId === null ? scopeOf(spec, orgId) : scopeOf(spec, orgId, owner.ownerId);
    const path = `/${spec.zerops.entity}/search`;
    // Updates register before membership: an update racing the baseline is caught, never lost.
    return [
      { scope, family: spec.family, role: "updates", path, search: spec.zerops.updates(owner) },
      {
        scope,
        family: spec.family,
        role: "membership",
        path,
        search: spec.zerops.membership(owner),
      },
    ];
  };
  return [
    ...families
      .filter((spec) => spec.scope.demand === "navigation")
      .flatMap((spec) => pair(spec, { orgId, ownerId: null })),
    ...details.flatMap(({ family, ownerId }) =>
      families
        .filter((spec) => spec.family === family && spec.scope.demand === "detail")
        .flatMap((spec) => pair(spec, { orgId, ownerId })),
    ),
  ];
}

/** The organization's navigation on Zerops: what the adapter registers on every attempt. */
export const zeropsNavigation = (orgId: string) => zeropsRegistrations(FAMILIES, orgId, []);
