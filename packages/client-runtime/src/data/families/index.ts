/**
 * The fact families this account holds. A new family is one module beside these and one line
 * here; the reducer, the store and the Zerops adapter loop over this list.
 *
 * @module data/families
 */
import type { Family, ScopeKey } from "../model.ts";
import { processFamily } from "./process.ts";
import type { AnyFamilySpec } from "./spec.ts";

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
    if (spec.index !== undefined) once(`index ${spec.index.name}`);
  }
  return families;
}

export const FAMILIES = defineFamilies([processFamily]);

const byFamily = new Map<string, AnyFamilySpec>(FAMILIES.map((spec) => [spec.family, spec]));
const bySuffix = new Map<string, AnyFamilySpec>(FAMILIES.map((spec) => [spec.scope.suffix, spec]));

export function familySpec(family: Family): AnyFamilySpec {
  const spec = byFamily.get(family);
  if (spec === undefined) throw new Error(`No family ${family} is registered.`);
  return spec;
}

/** The family whose members a scope lists. */
export function scopeSpec(scope: ScopeKey): AnyFamilySpec {
  const spec = bySuffix.get(scope.split(":")[2] ?? "");
  if (spec === undefined) throw new Error(`No family lists the scope ${scope}.`);
  return spec;
}
