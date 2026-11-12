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

/** How many changes not live yet the page lists before its card's foot lists the rest. */
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
    production: flow.production.kind !== "absent" && flow.production.kind !== "outside",
    followsMain: flow.production.kind === "outside",
    limit: CHANGES_HELD,
  });
}

/** Changes that went to the same place, said once over their rows: "Live in v0.1.3 · 4". */
export interface ChangeGroup {
  readonly label: string;
  readonly changes: ReadonlyArray<CardChange>;
  /** The release that took them, where one did: its version, and when it was made. */
  readonly release?: { readonly tag: string; readonly at: string | undefined } | undefined;
}

/**
 * The page's changes by what each row needs to say, in two zones. What is not live yet: open ones
 * each with what stops it, then merged ones grouped by where they stand before production, the
 * place said once as the group's label (`groups`). What is live (`live`): merged ones grouped by
 * the release that put them live. Setup files last, each saying it is no part of a release.
 */
export function changeGroups(changes: ReadonlyArray<CardChange>): {
  readonly open: ReadonlyArray<CardChange>;
  readonly groups: ReadonlyArray<ChangeGroup>;
  readonly live: ReadonlyArray<ChangeGroup>;
  readonly setup: ReadonlyArray<CardChange>;
} {
  const groups = new Map<string, { live: boolean; group: ChangeGroup }>();
  for (const change of changes) {
    if (change.open || change.pull.kind === "recipe") continue;
    const label = groupLabel(change);
    const took = change.where?.kind === "released" ? change.where : undefined;
    const held = groups.get(label);
    groups.set(label, {
      live: took?.live === true,
      group: {
        label,
        changes: [...(held?.group.changes ?? []), change],
        ...(took === undefined ? {} : { release: { tag: took.tag, at: took.at } }),
      },
    });
  }
  const zone = (live: boolean) =>
    [...groups.values()].filter((each) => each.live === live).map((each) => each.group);
  return {
    open: changes.filter((change) => change.open),
    groups: zone(false),
    live: zone(true),
    setup: changes.filter((change) => !change.open && change.pull.kind === "recipe"),
  };
}

const ON_MAIN_NOT_LIVE = "On main, not live yet";
const ON_STAGE_READY = "On stage, ready for production";
const ON_MAIN_READY = "On main, ready for production";
/** Where production follows `main`: beside "Live in v0.1.3", what is live with no release of its own. */
export const LIVE_WITH_MAIN = "Live with main";

/**
 * A merged change's place as its group's label, in the line's words: on the stage or on `main`,
 * ready for production; on `main` alone where the project is not live yet; live with `main` where
 * production follows it.
 */
function groupLabel({ words, where }: Pick<CardChange, "words" | "where">): string {
  if (where?.kind === "live-with-main") return LIVE_WITH_MAIN;
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

/** The rows a project's page lists of its changes, and how many of those not live yet it holds back. */
export interface PageChangeRows {
  readonly open: ReadonlyArray<CardChange>;
  readonly groups: ReadonlyArray<ChangeGroup>;
  readonly live: ReadonlyArray<ChangeGroup>;
  readonly setup: ReadonlyArray<CardChange>;
  /** Changes not live yet past the first few: the card's foot lists them (`all`). */
  readonly more: number;
}

/**
 * Which of a project's changes its page lists (`whole`: `changeGroups` of them all). What is not
 * live yet comes first and is never cut without saying so: the first `PAGE_CHANGES` of it, open
 * ones before merged ones, and `more` counts the rest — all of it with `all`. What is live is a
 * record of whole releases, never part of one: the newest always, then older ones while the
 * page's rows have room; the history holds the rest. Setup files stand where room is left.
 */
export function pageChangeRows(
  whole: ReturnType<typeof changeGroups>,
  all: boolean,
): PageChangeRows {
  const waiting =
    whole.open.length + whole.groups.reduce((n, group) => n + group.changes.length, 0);
  let left = all ? waiting : Math.min(waiting, PAGE_CHANGES);
  const shown = left;
  const take = <Row>(rows: ReadonlyArray<Row>): ReadonlyArray<Row> => {
    const taken = rows.slice(0, left);
    left -= taken.length;
    return taken;
  };
  const open = take(whole.open);
  const groups = whole.groups
    .map((group) => ({ ...group, changes: take(group.changes) }))
    .filter((group) => group.changes.length > 0);
  let room = Math.max(PAGE_CHANGES - shown, 0);
  const live = whole.live.filter((group, at) => {
    if (at > 0 && group.changes.length > room) {
      room = 0;
      return false;
    }
    room = Math.max(room - group.changes.length, 0);
    return true;
  });
  return { open, groups, live, setup: whole.setup.slice(0, room), more: waiting - shown };
}
