/**
 * The fact families this account holds. A new family is one module beside these and one line
 * here; the reducer, the store and the Zerops adapter loop over this list.
 *
 * @module data/families
 */
import type { Family, MemberState, ScopeKey } from "../model.ts";
import {
  hqAppFamily,
  hqOrganizationFamily,
  hqPersonFamily,
  hqPressFamily,
  hqStatusFamily,
  placementFamily,
} from "./hqNavigation.ts";
import { hqMateFamily } from "./hqMate.ts";
import { processFamily } from "./process.ts";
import { projectFamily } from "./project.ts";
import { versionFamily } from "./version.ts";
import { serviceFamily } from "./service.ts";
import type { AnyFamilySpec, DetailListing } from "./spec.ts";

/** The registry, checked once at startup: a family, a scope name and an index name each once. */
export function defineFamilies(
  families: ReadonlyArray<AnyFamilySpec>,
): ReadonlyArray<AnyFamilySpec> {
  const seen = new Set<string>();
  const once = (what: string) => {
    if (seen.has(what)) throw new Error(`The data layer registers ${what} twice.`);
    seen.add(what);
  };
  for (const spec of families) {
    once(`family ${spec.family}`);
    once(`scope ${spec.scope.suffix}`);
    for (const listing of spec.details ?? []) once(`scope ${listing.suffix}`);
    for (const index of spec.indexes ?? []) once(`index ${index.name}`);
  }
  return families;
}

export const FAMILIES = defineFamilies([
  projectFamily,
  processFamily,
  versionFamily,
  hqOrganizationFamily,
  hqStatusFamily,
  hqAppFamily,
  placementFamily,
  hqPersonFamily,
  hqPressFamily,
  hqMateFamily,
  serviceFamily,
]);

const byFamily = new Map<string, AnyFamilySpec>(FAMILIES.map((spec) => [spec.family, spec]));
/** What a scope lists: its family, what leaving it means, and the detail listing it is, if one. */
export interface ScopeListing {
  readonly spec: AnyFamilySpec;
  readonly leaving: MemberState;
  readonly detail: DetailListing | null;
}

const bySuffix = new Map<string, ScopeListing>(
  FAMILIES.flatMap((spec) => [
    [spec.scope.suffix, { spec, leaving: spec.scope.leaving, detail: null }] as const,
    ...(spec.details ?? []).map(
      (detail) => [detail.suffix, { spec, leaving: detail.leaving, detail }] as const,
    ),
  ]),
);

export function familySpec(family: Family): AnyFamilySpec {
  const spec = byFamily.get(family);
  if (spec === undefined) throw new Error(`No family ${family} is registered.`);
  return spec;
}

/** What a scope lists. */
export function scopeListing(scope: ScopeKey): ScopeListing {
  const listing = bySuffix.get(scope.split(":")[2] ?? "");
  if (listing === undefined) throw new Error(`No family lists the scope ${scope}.`);
  return listing;
}

/** The family whose members a scope lists. */
export const scopeSpec = (scope: ScopeKey): AnyFamilySpec => scopeListing(scope).spec;

/**
 * The family's own scope under the link a scope belongs to: where a member's `listed` is read,
 * whichever listing delivered its value. A detail listing's members are listed in their family's
 * own navigation scope.
 */
export function ownScopeOf(scope: ScopeKey): ScopeKey {
  const { spec, detail } = scopeListing(scope);
  if (detail === null) return scope;
  const [source, linkOwner] = scope.split(":");
  return `${source}:${linkOwner}:${spec.scope.suffix}` as ScopeKey;
}
