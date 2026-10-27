/**
 * Each Mate's attention as the menu and the badge read it: the newest value its family holds,
 * whichever path brought it, whether that value is of now, and how many of its results the person
 * has not seen, as HQ counts them from that person's acknowledgements.
 *
 * Of now is end-to-end: the Mate's own link to this page is live, or HQ's link is
 * live and HQ relays this very revision while its own link to the Mate is up. A live HQ never makes
 * the word of a Mate it cannot hear live. No clock decides it.
 *
 * @module data/projections/mateAttention
 */
import type { MateAttention } from "@t3tools/contracts";

import { SHOWN_MATES } from "../families/mateLink.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { hqMateAttentionScope, mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import { liveOrHeld } from "../streamMachine.ts";

export interface MateAttentionRead {
  /** The Mate's attention; `null` while none was said — or the Mate predates the value. */
  readonly attention: MateAttention | null;
  /** Whether it is the Mate's word of now. */
  readonly live: boolean;
  /** Its results the person has not seen, as HQ counts them; `null` while HQ has not said. */
  readonly unseen: number | null;
}

const isLive = (read: ProjectionReads, key: StreamKey) => liveOrHeld(read.stream(key));

function attentionOf(
  read: ProjectionReads,
  orgId: string,
  projectId: string,
  listed: boolean,
): MateAttentionRead {
  const placement = read.fact("placement", projectId);
  const unseen =
    placement.kind === "known" && listed ? (placement.value.person?.unseen ?? null) : null;
  const fact = read.fact("mateAttention", projectId);
  if (fact.kind !== "known") return { attention: null, live: false, unseen };
  const direct =
    fact.scope === mateAttentionScope(projectId) &&
    isLive(read, linkKeys.mate(projectId)) &&
    isLive(read, mateAttentionScope(projectId));
  const relayed = read.fact("hqMate", projectId);
  const relayedNow =
    relayed.kind === "known" &&
    relayed.value.attentionState === "live" &&
    relayed.value.attention !== null &&
    sameValue(relayed.value.attention.source, fact.value.source) &&
    isLive(read, linkKeys.hq(orgId)) &&
    isLive(read, hqMateScope(orgId, projectId)) &&
    isLive(read, hqMateAttentionScope(orgId, projectId));
  return { attention: fact.value, live: direct || relayedNow, unseen };
}

export interface MateProjectKey {
  readonly orgId: string;
  readonly projectId: string;
}

/** One logical row, independent of every list or subset a surface draws. */
export const mateAttention: Projection<MateProjectKey, MateAttentionRead> = {
  name: "mateAttention",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) =>
    attentionOf(
      read,
      orgId,
      projectId,
      read.members(placementsScope(orgId)).ids.includes(projectId),
    ),
  equals: sameValue,
};

/** Current source membership, plus direct targets belonging to this organization or no listing. */
export const attentionProjects: Projection<string, ReadonlyArray<string>> = {
  name: "attentionProjects",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const ids = new Set(read.members(placementsScope(orgId)).ids);
    for (const key of read.index(SHOWN_MATES.name, SHOWN_MATES.key)) {
      const link = read.fact("mateLink", key);
      if (link.kind === "known" && (link.value.orgId === null || link.value.orgId === orgId))
        ids.add(link.value.projectId);
    }
    return [...ids].sort();
  },
  equals: sameValue,
};

/** Pure subset composition for callers that already hold current membership; never cached by list. */
export function readAttentionProjects(
  read: ProjectionReads,
  { orgId, projectIds }: { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
): Readonly<Record<string, MateAttentionRead>> {
  const listed = new Set(read.members(placementsScope(orgId)).ids);
  return Object.fromEntries(
    projectIds.map((id) => [id, attentionOf(read, orgId, id, listed.has(id))]),
  );
}

/** Enumerating consumers share one reader per organization, regardless of list order or churn. */
export const matesAttention: Projection<string, Readonly<Record<string, MateAttentionRead>>> = {
  name: "matesAttention",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    // Membership is read once even when every Mate has an attention value.
    const membership = read.members(placementsScope(orgId));
    const members = {
      ...read,
      members: (scope: Parameters<ProjectionReads["members"]>[0]) =>
        scope === placementsScope(orgId) ? membership : read.members(scope),
    };
    return readAttentionProjects(members, {
      orgId,
      projectIds: attentionProjects.derive(members, orgId),
    });
  },
  equals: sameValue,
};
