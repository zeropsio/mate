/**
 * Each Mate's attention as the menu and the badge read it: the newest value its family holds,
 * whichever path brought it, whether that value is of now, and how many of its results the person
 * has not seen, as HQ counts them from that person's acknowledgements.
 *
 * Of now is end-to-end (HANDOFF §4.2): the Mate's own link to this page is live, or HQ's link is
 * live and HQ relays this very revision while its own link to the Mate is up. A live HQ never makes
 * the word of a Mate it cannot hear live. No clock decides it.
 *
 * @module data/projections/mateAttention
 */
import type { MateAttention } from "@t3tools/contracts";

import { hqMateScope } from "../families/hqMate.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import { hqMateAttentionScope, mateAttentionScope } from "../families/mateAttention.ts";
import { linkKeys, type StreamKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface MateAttentionRead {
  /** The Mate's attention; `null` while none was said — or the Mate predates the value. */
  readonly attention: MateAttention | null;
  /** Whether it is the Mate's word of now. */
  readonly live: boolean;
  /** Its results the person has not seen, as HQ counts them; `null` while HQ has not said. */
  readonly unseen: number | null;
}

const isLive = (read: ProjectionReads, key: StreamKey) => read.stream(key).phase === "live";

function attentionOf(read: ProjectionReads, orgId: string, projectId: string): MateAttentionRead {
  const placement = read.fact("placement", projectId);
  const unseen =
    placement.kind === "known" && read.members(placementsScope(orgId)).ids.includes(projectId)
      ? (placement.value.person?.unseen ?? null)
      : null;
  const fact = read.fact("mateAttention", projectId);
  if (fact.kind !== "known") return { attention: null, live: false, unseen };
  const direct =
    isLive(read, linkKeys.mate(projectId)) && isLive(read, mateAttentionScope(projectId));
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

export const matesAttention: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  Readonly<Record<string, MateAttentionRead>>
> = {
  name: "matesAttention",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { orgId, projectIds }) =>
    Object.fromEntries(
      projectIds.map((projectId) => [projectId, attentionOf(read, orgId, projectId)]),
    ),
  equals: sameValue,
};
