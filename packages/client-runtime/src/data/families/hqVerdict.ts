/**
 * Whether the organization's HQ is named, as the account holds it: one value per organization,
 * written by the account's observation (`showHq`). Until it is written the account does not know
 * whether to wait for an HQ; menu readers consume this fact.
 *
 * @module data/families/hqVerdict
 */
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type HqVerdict = "pending" | "official";

export interface HqVerdictValue {
  readonly verdict: HqVerdict;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqVerdict: HqVerdictValue;
  }
}

/** Held by the account, never registered on a Zerops socket. */
export const hqVerdictFamily: FamilySpec<"hqVerdict"> = {
  family: "hqVerdict",
  retainUnverified: true,
  authority: "zerops",
  scope: { source: "zerops", suffix: "hq-verdict", leaving: "removed", demand: "navigation" },
};

export const hqVerdictScope = (orgId: string): ScopeKey => scopeOf(hqVerdictFamily, orgId);
