/** Setup evidence from HQ navigation. Missing facts are unknown; transport loss removes none. */
import { placementsScope } from "../families/hqNavigation.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness } from "./freshness.ts";

export interface HqMateSetup {
  readonly closedOff: boolean | "unknown";
  readonly marker: boolean | "unknown";
}
export const UNKNOWN_MATE_SETUP: HqMateSetup = { closedOff: "unknown", marker: "unknown" };

export const hqMateSetup: Projection<
  { readonly orgId: string; readonly projectId: string },
  HqMateSetup
> = {
  name: "hqMateSetup",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    if (!read.members(placementsScope(orgId)).ids.includes(projectId)) return UNKNOWN_MATE_SETUP;
    const placement = read.fact("placement", projectId);
    if (placement.kind !== "known" || placement.value.mate === null) return UNKNOWN_MATE_SETUP;
    const mate = placement.value.mate;
    return {
      closedOff:
        mate.closedOff || scopeFreshness(read, placementsScope(orgId)).live
          ? mate.closedOff
          : "unknown",
      marker: mate.setupMarker ?? "unknown",
    };
  },
  equals: sameValue,
};
