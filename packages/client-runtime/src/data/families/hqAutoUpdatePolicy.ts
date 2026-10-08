import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqAutoUpdatePolicy: HqAutoUpdatePolicy;
  }
}
export const autoUpdatePolicyScope = (orgId: string): ScopeKey => `hq:${orgId}:auto-update-policy`;
export const autoUpdatePolicyRequestId = (orgId: string, attempt: number) =>
  `auto-update-policy/${encodeURIComponent(orgId)}/${attempt}`;
export const hqAutoUpdatePolicyFamily: FamilySpec<"hqAutoUpdatePolicy"> = {
  family: "hqAutoUpdatePolicy",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "auto-update-policy",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
