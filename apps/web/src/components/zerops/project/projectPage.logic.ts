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
import { mergedChangeWords } from "../system/ChangeRow.logic";
import {
  broughtBy,
  cardChanges,
  mateChangesForReview,
  placeLabel,
  type CardChange,
  type PlaceLine,
} from "../projects/projectCard.logic";

/** How many recent changes the page lists before *All history* or *All changes*. */
export const PAGE_CHANGES = 6;

/** How many recent changes the page holds for *All changes*. */
export const CHANGES_HELD = 40;

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
    limit: CHANGES_HELD,
  });
}

/** Changes that went to the same place, said once over their rows: "Live in v0.1.3 · 4". */
export interface ChangeGroup {
  readonly label: string;
  readonly changes: ReadonlyArray<CardChange>;
}

/**
 * The page's changes by what each row needs to say: open ones each with what stops it; merged ones
 * grouped by where they went, the place said once as the group's label; setup files last, each
 * saying it is no part of a release.
 */
export function changeGroups(changes: ReadonlyArray<CardChange>): {
  readonly open: ReadonlyArray<CardChange>;
  readonly groups: ReadonlyArray<ChangeGroup>;
  readonly setup: ReadonlyArray<CardChange>;
} {
  const groups = new Map<string, CardChange[]>();
  for (const change of changes) {
    if (change.open || change.pull.kind === "recipe") continue;
    const label = groupLabel(change.words);
    groups.set(label, [...(groups.get(label) ?? []), change]);
  }
  return {
    open: changes.filter((change) => change.open),
    groups: [...groups].map(([label, rows]) => ({ label, changes: rows })),
    setup: changes.filter((change) => !change.open && change.pull.kind === "recipe"),
  };
}

/** A merged change's place as its group's label: on `main` where nothing took it live yet. */
function groupLabel(words: string): string {
  if (words === mergedChangeWords({ kind: "merged" })) return "On main, not live yet";
  if (words === mergedChangeWords({ kind: "waits-for-production" })) return "Ready for production";
  return words;
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

/** One address of the project's page: its host, and the place that serves it. */
export interface PageAddress extends GroupFlowAddress {
  readonly host: string;
  /** The place it belongs to, `Production` or a stage by its name (`placeLabel`). */
  readonly place: string;
}

/** Every address the project's places serve at, production first, each once. */
export function pageAddresses(lines: ReadonlyArray<PlaceLine>): ReadonlyArray<PageAddress> {
  const seen = new Set<string>();
  return linesProductionFirst(lines).flatMap((line) =>
    line.nothingDeployed === true
      ? []
      : line.addresses.flatMap((address) => {
          if (seen.has(address.url)) return [];
          seen.add(address.url);
          return [{ ...address, host: hostOf(address.url), place: placeLabel(line) }];
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
