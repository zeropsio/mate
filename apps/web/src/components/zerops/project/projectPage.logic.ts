/**
 * What a project's page says, from the reads its overview card already takes: its recent changes,
 * what the live release brought and its code's copies elsewhere. Pure: no React.
 */
import type {
  EnvironmentSlotRow,
  FlowPullRequest,
  GroupFlow,
} from "@t3tools/client-runtime/zerops";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";

import { hostWords, repoState } from "../gitMirror.logic";
import { applicationStage } from "../system/applicationPlaces.logic";
import { mergedChangeWords } from "../system/ChangeRow.logic";
import type { LineCopy, LineGroup } from "../system/projectLine.logic";
import {
  broughtBy,
  cardChanges,
  mateChangesForReview,
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

const ON_MAIN_NOT_LIVE = "On main, not live yet";
const ON_STAGE_READY = "On stage, ready for production";
const ON_MAIN_READY = "On main, ready for production";

/**
 * A merged change's place as its group's label, in the line's words: on the stage or on `main`,
 * ready for production; on `main` alone where the project is not live yet.
 */
function groupLabel(words: string): string {
  if (words === mergedChangeWords({ kind: "merged" })) return ON_MAIN_NOT_LIVE;
  if (words === mergedChangeWords({ kind: "waits-for-production" })) return ON_MAIN_READY;
  if (words === mergedChangeWords({ kind: "on-stage" })) return ON_STAGE_READY;
  return words;
}

/**
 * The segment of the project's line a group's changes stand on, which its count leads from: on
 * their way to the stage, or merged and not live.
 */
export function lineGroupOf(group: ChangeGroup): LineGroup | undefined {
  if (group.label === mergedChangeWords({ kind: "deploying-to-stage" })) return "deploying";
  return group.label === ON_STAGE_READY ||
    group.label === ON_MAIN_READY ||
    group.label === ON_MAIN_NOT_LIVE
    ? "ready"
    : undefined;
}

/**
 * The project's code copies elsewhere, as its line in full hangs them under `main`: in sync,
 * pushing, paused on diverged mains, stopped on a refused token or a GitHub app that left — in the
 * words its Code row says (`repoState`; the organization's apps are not read for it, so an app's
 * stop names no reason). Code kept in Mate alone draws nothing.
 */
export function lineCopies(
  repos: ZeropsProjectFlow["repos"],
  context: { readonly orgName: string | undefined; readonly now: number },
): ReadonlyArray<LineCopy> {
  return (repos ?? []).flatMap((repo): ReadonlyArray<LineCopy> => {
    if (repo.name === RECIPE_REPO || repo.remote == null) return [];
    const state = repoState(repo, { apps: null, ...context });
    if (state.destination === null) return [];
    return [
      {
        key: repo.name,
        host: hostWords(repo.remote.url),
        name: state.destination.label,
        line: state.line,
        tone:
          state.tone === "bad"
            ? "danger"
            : state.tone === "busy"
              ? "info"
              : state.tone === "warn"
                ? "warning"
                : undefined,
      },
    ];
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
