/** Browser-to-location latency, sampled once per account and endpoint while the picker demands it. */
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";
export interface LocationLatency {
  readonly locationId: string;
  readonly pingUrl: string;
  readonly latencyMs: number;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly locationLatency: LocationLatency;
  }
}
export const locationLatencyFamily: FamilySpec<"locationLatency"> = {
  family: "locationLatency",
  authority: "zerops",
  scope: {
    source: "zerops",
    suffix: "location-latency",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
export const locationLatencyId = (
  orgId: string,
  location: { readonly id: string; readonly pingUrl: string },
) => JSON.stringify([orgId, location.id, location.pingUrl]);
export const locationLatencyScope = (orgId: string, id: string): ScopeKey =>
  scopeOf(locationLatencyFamily, orgId, id);
