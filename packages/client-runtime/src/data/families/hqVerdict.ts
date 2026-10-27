/**
 * Whether the organization has an official HQ, as the account decided it from the organization's
 * member list: one value per organization, written by the account's
 * observation (`showHq`). Until it is written the account does not know whether to wait for an
 * HQ. The endpoint discovery remains in transit; menu readers consume this fact.
 *
 * @module data/families/hqVerdict
 */
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type HqVerdict = "pending" | "official" | "none" | "unreadable";

export interface HqVerdictValue {
  readonly verdict: HqVerdict;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqVerdict: HqVerdictValue;
  }
}

/** Read from Zerops (the member list) by the account, never registered on a Zerops socket. */
export const hqVerdictFamily: FamilySpec<"hqVerdict"> = {
  family: "hqVerdict",
  retainUnverified: true,
  authority: "zerops",
  scope: { source: "zerops", suffix: "hq-verdict", leaving: "removed", demand: "navigation" },
};

export const hqVerdictScope = (orgId: string): ScopeKey => scopeOf(hqVerdictFamily, orgId);
