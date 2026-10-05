/**
 * The fact families this account holds. A new family is one module beside these and one line
 * here; the reducer, the store and the Zerops adapter loop over this list.
 *
 * @module data/families
 */
import type { Family, ScopeKey } from "../model.ts";
import { attentionFamily } from "./attention.ts";
import { placementFamily } from "./placement.ts";
import { processFamily } from "./process.ts";
import { projectFamily } from "./project.ts";
import type { AnyFamilySpec } from "./spec.ts";

export const FAMILIES: ReadonlyArray<AnyFamilySpec> = [
  projectFamily,
  processFamily,
  placementFamily,
  attentionFamily,
];

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
