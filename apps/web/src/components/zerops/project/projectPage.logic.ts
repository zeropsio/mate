/**
 * What a project's page says, from the reads its overview card already takes: its recent changes,
 * what the live release brought, and every address it serves at. Pure: no React.
 */
import type {
  EnvironmentSlotRow,
  FlowPullRequest,
  GroupFlow,
  GroupFlowAddress,
} from "@t3tools/client-runtime/zerops";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import { applicationStage } from "../system/applicationPlaces.logic";
import {
  broughtBy,
  cardChanges,
  mateChangesForReview,
  type CardChange,
  type PlaceLine,
} from "../projects/projectCard.logic";

/** How many recent changes the page lists before *All history*. */
export const PAGE_CHANGES = 6;

/**
 * The page's recent changes: the open ones first, then the merged ones newest first, each by where
 * it went — "Merged · waits for production", "Live in v0.1.3".
 */
export function pageChanges(input: {
  readonly flow: Pick<GroupFlow, "pullRequests" | "stages" | "production">;
  readonly read: ZeropsProjectFlow | undefined;
}): ReadonlyArray<CardChange> {
  const { flow, read } = input;
  return cardChanges({
    open: flow.pullRequests.map((change) => change.pull),
    merged: read?.merged ?? [],
    releases: read?.releasesKnown === true ? read.releases : [],
    // A stage whose deploys are unread runs nothing this can tell.
    stage:
      flow.stages.length === 0
        ? undefined
        : (applicationStage(read)?.stage ?? { runs: [], deploying: [], mainHeads: new Map() }),
    production: flow.production.kind !== "absent",
    limit: PAGE_CHANGES,
  });
}

/** How many of what the live release brought are named before "+ N". */
export const BROUGHT_SHOWN = 3;

/** What production's live release brought, by title; none while its releases are unread. */
export function liveBrought(read: ZeropsProjectFlow | undefined): ReadonlyArray<FlowPullRequest> {
  if (read === undefined || !read.releasesKnown) return [];
  return broughtBy(read.merged, read.releases);
}

/** A Mate's changes that wait for the person's review, newest first, as its wait counts them. */
export function waitingChanges(
  flow: Pick<GroupFlow, "pullRequests">,
  mateProjectId: string,
): ReadonlyArray<FlowPullRequest> {
  return mateChangesForReview(flow, mateProjectId);
}

/** Every address the project's places serve at, production first, each once. */
export function pageAddresses(
  lines: ReadonlyArray<PlaceLine>,
): ReadonlyArray<GroupFlowAddress & { readonly host: string }> {
  const seen = new Set<string>();
  return linesProductionFirst(lines).flatMap((line) =>
    line.nothingDeployed === true
      ? []
      : line.addresses.flatMap((address) => {
          if (seen.has(address.url)) return [];
          seen.add(address.url);
          return [{ ...address, host: hostOf(address.url) }];
        }),
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Production's slot, then every stage's — the order the project's card says them in. */
export function productionFirst(
  slots: ReadonlyArray<EnvironmentSlotRow>,
): ReadonlyArray<EnvironmentSlotRow> {
  const production = (slot: EnvironmentSlotRow) => "tier" in slot && slot.tier === "production";
  return [...slots.filter(production), ...slots.filter((slot) => !production(slot))];
}

/** Production's line, then every stage's. */
export function linesProductionFirst(lines: ReadonlyArray<PlaceLine>): ReadonlyArray<PlaceLine> {
  return [
    ...lines.filter((line) => line.kind === "production"),
    ...lines.filter((line) => line.kind === "stage"),
  ];
}
