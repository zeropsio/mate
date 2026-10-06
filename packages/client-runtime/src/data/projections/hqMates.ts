/**
 * Each Mate HQ places, as HQ relays it: whether it is online and its last overview, by project.
 * A Mate HQ said nothing of yet is absent; one it relayed keeps its last word through an outage,
 * and `live` says whether that word is current.
 *
 * @module data/projections/hqMates
 */
import type { MateLiveView } from "@t3tools/shared/hqMates";

import { placementsScope } from "../families/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface HqMatesRead {
  readonly mates: Readonly<Record<string, MateLiveView>>;
  /** HQ relays them now: its link is live. Each Mate's own presence says whether it is up. */
  readonly live: boolean;
}

export const hqMates: Projection<string, HqMatesRead> = {
  name: "hqMates",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const mates: Record<string, MateLiveView> = {};
    for (const projectId of read.members(placementsScope(orgId)).ids) {
      const fact = read.fact("hqMate", projectId);
      if (fact.kind !== "known") continue;
      mates[projectId] = { presence: fact.value.presence, ...fact.value.overview };
    }
    return {
      mates,
      live:
        read.stream(linkKeys.hq(orgId)).phase === "live" &&
        read.stream(placementsScope(orgId)).phase === "live",
    };
  },
  equals: sameValue,
};
