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
import { linkKeys, type ScopeKey } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { MateProjectKey } from "./mateAttention.ts";
import { sameValue } from "./equal.ts";
import { liveOrHeld } from "../streamMachine.ts";
import { scopeSlow } from "./freshness.ts";

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

/** Whether HQ answered this target's attention demand, including a definitive refusal. */
export const hqMateAnswered: Projection<MateProjectKey, boolean> = {
  name: "hqMateAnswered",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const scope = hqMateScope(orgId, projectId);
    return (
      read.fact("hqMate", projectId).kind === "known" ||
      read.coverage(scope) === "complete" ||
      read.stream(scope).phase === "refused"
    );
  },
  equals: Object.is,
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
      return hqMateAnswered.derive(read, { orgId, projectId });
    }),
  equals: Object.is,
};

/**
 * Where HQ's index of the Mates the reader observes stands for the organization — whether it may
 * still name the project an environment's Mate serves:
 *
 * - `answered`: its placements are read whole and each placed Mate relayed the environment it
 *   serves, had its scope refused (that Mate is not the reader's to open), or never connected
 *   (`neverConnected`): an environment none of them names is none of its Mates. What it said so
 *   stands through a later outage.
 * - `slow`: that answer is not whole, and a scope it waits on is slow (`scopeSlow`): HQ's
 *   connection is open and the scope still waits past a first answer's patience — the menu's own
 *   word for HQ slow.
 * - `due`: that answer is not whole — placements unread or a row of them unknown, or a placed
 *   Mate relayed no environment (an overview without one, or none) — and nothing says HQ is slow.
 *   Its silence proves nothing; an outage is the menu's to say (`hqOutage`).
 */
export type HqIndexWord = "answered" | "slow" | "due";

export const hqIndexWord: Projection<string, HqIndexWord> = {
  name: "hqIndexWord",
  keyOf: (orgId) => orgId,
  derive: (read, orgId) => {
    const placements = placementsScope(orgId);
    const waiting: ScopeKey[] = [];
    if (read.coverage(placements) !== "complete") waiting.push(placements);
    for (const projectId of read.members(placements).ids) {
      const placement = read.fact("placement", projectId);
      if (placement.kind !== "known") {
        waiting.push(placements);
        continue;
      }
      if (placement.value.mate == null || neverConnected(read, projectId, placement.value.appId))
        continue;
      const scope = hqMateScope(orgId, projectId);
      if (read.stream(scope).phase === "refused") continue;
      const mate = read.fact("hqMate", projectId);
      if (mate.kind === "known" && mate.value.overview?.identity?.environmentId != null) continue;
      waiting.push(scope);
    }
    if (waiting.length === 0) return "answered";
    return waiting.some((scope) => scopeSlow(read, scope)) ? "slow" : "due";
  },
  equals: Object.is,
};

/**
 * Whether HQ says the project's Mate never connected: its application still holds the Mate's
 * birth open. HQ ends a birth on the Mate's first admitted link (mate-hq `matelink/link.go`, the
 * `hq_birth_intent SET ended_at` on link) and lists only open ones (`structure/read.go`,
 * `ended_at IS NULL`), so an open birth bound to the project is a Mate that has never had the
 * HQ link a conversation's ticket needs. A Chief's birth stays open past its link until it is
 * registered, and an adopted one may name a Mate that linked before: neither says so.
 */
function neverConnected(
  read: ProjectionReads,
  projectId: string,
  appId: string | null | undefined,
): boolean {
  if (appId == null) return false;
  const app = read.fact("hqApp", appId);
  return (
    app.kind === "known" &&
    (app.value.births ?? []).some(
      (birth) => birth.projectId === projectId && birth.chief !== true && birth.adopted !== true,
    )
  );
}

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
