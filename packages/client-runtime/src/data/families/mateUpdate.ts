import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import type { FamilySpec } from "./spec.ts";
import type { ScopeKey } from "../model.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateUpdateAvailability: ExecutionEnvironmentUpdate | null;
    /** Own action identity, never a copied outcome. */
    readonly mateUpdateRequest: {
      readonly requestId: string | null;
      readonly containerKey: string | null;
    };
  }
}
export const mateUpdateAvailabilityFamily: FamilySpec<"mateUpdateAvailability"> = {
  family: "mateUpdateAvailability",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "update-availability",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
export const mateUpdateRequestFamily: FamilySpec<"mateUpdateRequest"> = {
  family: "mateUpdateRequest",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "update-request",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
  indexes: [{ name: "mateUpdateRequests", keyOf: () => "all" }],
};
export const updateAvailabilityScope = (environmentId: string): ScopeKey =>
  `mate:${encodeURIComponent(environmentId)}:update-availability`;
export const updateRequestScope = (environmentId: string): ScopeKey =>
  `mate:${encodeURIComponent(environmentId)}:update-request`;
