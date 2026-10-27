/**
 * What the account observes, and what that costs each source. Navigation is
 * always demanded: for Zerops a constant set of organization registrations, never one per menu row.
 * A detail family is registered only for the owners a screen demands it for (one project's
 * services while that project is open). Each observed scope is a pair: a membership `listStream`,
 * whose answer is the scope's baseline, and an `updateStream` of whole rows.
 *
 * @module data/demand
 */
import { FAMILIES, familySpec } from "./families/index.ts";
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

/**
 * A detail demanded for one owner while a screen holds it: a detail family's own scope (one
 * project's services), or, naming a `listing`, one of a family's detail listings (one project's
 * newest processes).
 */
export interface DetailDemand {
  readonly family: Family;
  readonly listing?: string;
  readonly ownerId: string;
}

/** The scope a detail demand observes under the organization's link. */
export function detailScopeOf(orgId: string, demand: DetailDemand): ScopeKey {
  const { scope } = familySpec(demand.family);
  return `${scope.source}:${orgId}:${demand.listing ?? scope.suffix}:${demand.ownerId}`;
}

/**
 * The details screens hold now, counted per scope: the first hold demands a scope, the last
 * release lets it go. Listeners hear every change of the demanded set.
 */
export interface DetailDemands {
  readonly hold: (scope: ScopeKey) => () => void;
  readonly scopes: () => ReadonlyArray<ScopeKey>;
  readonly onChange: (listener: () => void) => () => void;
  /**
   * A held scope no push keeps current (a project's own row) is renewed: read again once, if it
   * was read already and no read of it is in flight — the reader decides, on taking the mark.
   */
  readonly renew: (scope: ScopeKey) => void;
  /** Whether a scope was marked to be renewed, consuming the mark. */
  readonly takeRenewal: (scope: ScopeKey) => boolean;
}

export function makeDetailDemands(options: {
  /** The scope's first hold, and its last release. */
  readonly demanded: (scope: ScopeKey, demanded: boolean) => void;
}): DetailDemands {
  const holds = new Map<ScopeKey, number>();
  const renewals = new Set<ScopeKey>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    hold: (scope) => {
      const count = holds.get(scope) ?? 0;
      holds.set(scope, count + 1);
      if (count === 0) {
        options.demanded(scope, true);
        changed();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (holds.get(scope) ?? 1) - 1;
        if (left > 0) return void holds.set(scope, left);
        holds.delete(scope);
        renewals.delete(scope);
        options.demanded(scope, false);
        changed();
      };
    },
    scopes: () => [...holds.keys()],
    renew: (scope) => {
      if (!holds.has(scope)) return;
      renewals.add(scope);
      changed();
    },
    takeRenewal: (scope) => renewals.delete(scope),
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
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
    ...details.flatMap(({ family, listing, ownerId }) =>
      // A detail listing is read, never registered: its family's own scope observes its members.
      listing !== undefined
        ? []
        : families
            .filter((spec) => spec.family === family && spec.scope.demand === "detail")
            .flatMap((spec) => pair(spec, { orgId, ownerId })),
    ),
  ];
}

/** The organization's navigation on Zerops: what the adapter registers on every attempt. */
export const zeropsNavigation = (orgId: string) => zeropsRegistrations(FAMILIES, orgId, []);
