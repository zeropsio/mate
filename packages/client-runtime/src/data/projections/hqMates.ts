/**
 * Each Mate HQ places, as HQ relays it: whether it is online and its last overview, by project.
 * A Mate HQ said nothing of yet is absent; one it relayed keeps its last word through an outage,
 * and `live` says whether that word is current.
 *
 * @module data/projections/hqMates
 */
import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { Reachability } from "../../zerops/environments/index.ts";

import { hqMateScope } from "../families/hqMate.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { MateProjectKey } from "./mateAttention.ts";
import { sameValue } from "./equal.ts";
import { placedMates } from "../placedRows.ts";
import { liveOrHeld } from "../streamMachine.ts";

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
        liveOrHeld(read.stream(linkKeys.hq(orgId))) &&
        liveOrHeld(read.stream(placementsScope(orgId))),
    };
  },
  equals: sameValue,
};

/**
 * The projects whose Mate HQ places for the reader, and whether that is HQ's current word: its
 * link and its placements live (`zerops/account/hqView.ts` hears a project enter or leave).
 */
export const hqPlacedMates: Projection<
  string,
  { readonly live: boolean; readonly placed: ReadonlyArray<string> }
> = {
  name: "hqPlacedMates",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => ({
    live:
      liveOrHeld(read.stream(linkKeys.hq(orgId))) &&
      liveOrHeld(read.stream(placementsScope(orgId))),
    placed: placedMates(read, orgId),
  }),
  equals: sameValue,
};

/**
 * Whether HQ answered for every Mate it places: each one's attention relayed, read with nothing in
 * it, or refused — what a Mate's row says of when it last spoke and what it last said. The menu
 * paints its rows once this holds, so each row comes with its time and its words.
 */
export const hqMatesAnswered: Projection<string, boolean> = {
  name: "hqMatesAnswered",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) =>
    read.members(placementsScope(orgId)).ids.every((projectId) => {
      const placement = read.fact("placement", projectId);
      if (placement.kind !== "known" || placement.value.mate == null) return true;
      const scope = hqMateScope(orgId, projectId);
      return (
        read.fact("hqMate", projectId).kind === "known" ||
        read.coverage(scope) === "complete" ||
        read.stream(scope).phase === "refused"
      );
    }),
  equals: Object.is,
};

function overviewOf(
  read: ProjectionReads,
  { orgId, projectId }: MateProjectKey,
): MateLiveView | null {
  if (!read.members(placementsScope(orgId)).ids.includes(projectId)) return null;
  const fact = read.fact("hqMate", projectId);
  return fact.kind === "known" ? { presence: fact.value.presence, ...fact.value.overview } : null;
}

export const hqMateOverview: Projection<MateProjectKey, MateLiveView | null> = {
  name: "hqMateOverview",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: overviewOf,
  equals: sameValue,
};

/** A targeted HQ refusal names an inaccessible Chief without adding it to personal navigation. */
export const hqMateRefusal: Projection<
  MateProjectKey,
  Extract<Reachability, { readonly kind: "refused-role" }> | null
> = {
  name: "hqMateRefusal",
  keyOf: hqMateOverview.keyOf,
  derive: (read, { orgId, projectId }) => {
    const stream = read.stream(hqMateScope(orgId, projectId));
    return stream.phase === "refused" && stream.fault?.code === "chief_owner_required"
      ? { kind: "refused-role", chiefOwnerName: stream.fault.message }
      : null;
  },
  equals: sameValue,
};

/** Field readers retain access/freshness dependencies without publishing unrelated overview sections. */
export const hqMatePresence: Projection<
  MateProjectKey,
  { readonly presence: MateLiveView["presence"] | null; readonly live: boolean }
> = {
  name: "hqMatePresence",
  keyOf: hqMateOverview.keyOf,
  derive: (read, key) => ({
    presence: overviewOf(read, key)?.presence ?? null,
    live:
      liveOrHeld(read.stream(linkKeys.hq(key.orgId))) &&
      liveOrHeld(read.stream(placementsScope(key.orgId))) &&
      liveOrHeld(read.stream(hqMateScope(key.orgId, key.projectId))),
  }),
  equals: sameValue,
};
export const hqMateLogins: Projection<MateProjectKey, MateLiveView["logins"]> = {
  name: "hqMateLogins",
  keyOf: hqMateOverview.keyOf,
  derive: (read, key) => overviewOf(read, key)?.logins,
  equals: sameValue,
};
export const hqMateReady: Projection<MateProjectKey, boolean | undefined> = {
  name: "hqMateReady",
  keyOf: hqMateOverview.keyOf,
  derive: (read, key) => overviewOf(read, key)?.identity?.runsWithoutSignIn,
  equals: Object.is,
};
