import { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
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
const decodePolicy = Schema.decodeUnknownOption(HqAutoUpdatePolicy);
export const hqAutoUpdatePolicyFamily: FamilySpec<"hqAutoUpdatePolicy"> = {
  family: "hqAutoUpdatePolicy",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "auto-update-policy",
    leaving: "removed",
    demand: "navigation",
  },
  hq: {
    scope: "navigation",
    idOf: (key, { orgId }) => (key === "auto-update-policy" ? orgId : null),
    keyOf: () => "auto-update-policy",
    decode: (raw) => Option.getOrNull(decodePolicy(raw)),
  },
};
