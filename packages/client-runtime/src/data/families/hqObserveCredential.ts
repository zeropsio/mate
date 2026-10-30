/** One installed profile's personal observe authority, held within the account lifetime. */
import type { ObserveCredential } from "../../zerops/hq/observeCredential.ts";
import type { ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";
export interface ObserveCredentialKey {
  readonly orgId: string;
  readonly projectId: string;
}
export const observeCredentialId = (key: ObserveCredentialKey) =>
  JSON.stringify([key.orgId, key.projectId]);
export const observeCredentialScope = (key: ObserveCredentialKey): ScopeKey =>
  `hq:${key.orgId}:observe-credential:${observeCredentialId(key)}`;
export const observeRequestScope = (key: ObserveCredentialKey): ScopeKey =>
  `hq:${key.orgId}:observe-credential-request:${observeCredentialId(key)}`;
declare module "../model.ts" {
  interface FamilyValues {
    readonly hqObserveCredential: ObserveCredential;
    readonly hqObserveCredentialRequest: { readonly requestId: string; readonly after: number };
  }
}
export const hqObserveCredentialFamily: FamilySpec<"hqObserveCredential"> = {
  family: "hqObserveCredential",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "observe-credential",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
export const hqObserveCredentialRequestFamily: FamilySpec<"hqObserveCredentialRequest"> = {
  family: "hqObserveCredentialRequest",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "observe-credential-request",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
