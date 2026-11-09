/**
 * What a place's page says beyond its header: the changes that go next — merged ones waiting for
 * production's next release, or a stage's open changes waiting to be approved for it — and whose
 * they are.
 *
 * Pure: no React.
 */
import {
  changeState,
  type FlowPullRequest,
  type FlowReleaseRow,
  type GroupEnvironmentTier,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { NOTHING_DEPLOYED, type StopView } from "@t3tools/client-runtime/zerops/flow";

import type { FixProblem } from "~/zerops/fixRequest";
import type { PlaceDot, PlaceLine } from "../projects/projectCard.logic";
import { placeStatus } from "./place.logic";

/** Whose the next changes are, after their commits: "from Juno", "from Juno and Theo", "from 4 Mates". */
export function changesFrom(names: ReadonlyArray<string | undefined>): string | undefined {
  const unique = [...new Set(names.filter((name): name is string => name !== undefined))];
  if (unique.length === 0) return undefined;
  if (unique.length === 1) return `from ${unique[0] ?? ""}`;
  if (unique.length === 2) return `from ${unique[0] ?? ""} and ${unique[1] ?? ""}`;
  return `from ${String(unique.length)} Mates`;
}

const newestFirst = (left: string | undefined, right: string | undefined) =>
  (right ?? "").localeCompare(left ?? "");

/**
 * The Mates' merged changes production does not run yet, newest first: what its next release
 * carries. Production runs what its live release names — a roll back's, what it went back to — so
 * every change merged after that is waiting, a release that didn't go live or was rolled back past
 * included; where what runs is not told, the newest release HQ made stands for it. Before any
 * release, every merged change waits. A change to the setup
 * repository goes to no release, so it is not one of them.
 */
export function changesWaitingForRelease(
  merged: ReadonlyArray<FlowPullRequest>,
  releases: ReadonlyArray<
    Pick<FlowReleaseRow, "tag" | "taggedAt" | "standing" | "rollbackOf" | "verdict">
  >,
): ReadonlyArray<FlowPullRequest> {
  // What production runs is not told: the newest release HQ made stands for it.
  const live =
    releases.find((release) => release.standing === "live") ??
    releases.find((release) => release.verdict !== "refused");
  const runs =
    live?.rollbackOf === undefined
      ? live
      : (releases.find((release) => release.tag === live.rollbackOf) ?? live);
  const since = runs === undefined ? undefined : Date.parse(runs.taggedAt);
  return merged
    .filter(
      (pull) =>
        pull.kind !== "recipe" &&
        pull.mergedAt !== undefined &&
        (since === undefined || Number.isNaN(since) || Date.parse(pull.mergedAt) > since),
    )
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt));
}

/**
 * The waiting changes while a release is on its way: those it carries are the card's, the ones
 * merged after it was made wait for the next and are only counted. The release's own record of
 * its changes decides (`history.changes`); one made before HQ kept that is split by when it was
 * made. Without the release — HQ has not listed it yet — everything waiting is what was just sent.
 */
export function changesOfRelease(
  waiting: ReadonlyArray<FlowPullRequest>,
  release: Pick<FlowReleaseRow, "taggedAt" | "history"> | undefined,
): {
  readonly carried: ReadonlyArray<FlowPullRequest>;
  /** The titles of changes it carries that the merged list no longer holds. */
  readonly unlisted: ReadonlyArray<string>;
  /** How many merged after it. */
  readonly later: number;
} {
  if (release === undefined) return { carried: waiting, unlisted: [], later: 0 };
  const made = Date.parse(release.taggedAt);
  const after = (pull: FlowPullRequest) =>
    pull.mergedAt !== undefined && !Number.isNaN(made) && Date.parse(pull.mergedAt) > made;
  const changes = release.history?.changes;
  if (changes === undefined) {
    const carried = waiting.filter((pull) => !after(pull));
    return { carried, unlisted: [], later: waiting.length - carried.length };
  }
  const own = (pull: FlowPullRequest) =>
    changes.some((change) => change.repo === pull.repository && change.number === pull.number);
  const carried = waiting.filter(own);
  return {
    carried,
    unlisted: changes
      .filter(
        (change) =>
          !carried.some((pull) => pull.repository === change.repo && pull.number === change.number),
      )
      .map((change) => change.title),
    later: waiting.filter((pull) => !own(pull) && after(pull)).length,
  };
}

/** "1 more change waits for the next release", under a release on its way. */
export function laterChangesLine(count: number): string | undefined {
  if (count <= 0) return undefined;
  return `${String(count)} more ${count === 1 ? "change waits" : "changes wait"} for the next release`;
}

/**
 * What production's next release does before it deploys, on its card's line: it creates the
 * services its setup files declare and Zerops lacks there — "creates db in production first".
 */
export function createsFirstLine(missing: ReadonlyArray<string>): string | undefined {
  if (missing.length === 0) return undefined;
  const names =
    missing.length === 1
      ? (missing[0] ?? "")
      : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1) ?? ""}`;
  return `creates ${names} in production first`;
}

/** A stage's next: the open changes that merge to it, those ready to merge first, then newest. */
export function changesWaitingForStage(
  open: ReadonlyArray<FlowPullRequest>,
): ReadonlyArray<FlowPullRequest> {
  const ready = (pull: FlowPullRequest) => changeState(pull)?.word === READY_TO_MERGE;
  return open
    .filter((pull) => pull.kind !== "recipe" && pull.mateGone !== true)
    .toSorted(
      (left, right) =>
        Number(ready(right)) - Number(ready(left)) || newestFirst(left.updatedAt, right.updatedAt),
    );
}

/** An open change nothing stops, in `changeState`'s words. */
const READY_TO_MERGE = "Ready to merge";

/** "2 changes to approve for Stage", or how many are open where none asks for approval yet. */
export function stageNextTitle(open: ReadonlyArray<FlowPullRequest>, stage: string): string {
  const ready = open.filter((pull) => changeState(pull)?.word === READY_TO_MERGE).length;
  const count = ready > 0 ? ready : open.length;
  const changes = `${String(count)} ${count === 1 ? "change" : "changes"}`;
  return ready > 0 ? `${changes} to approve for ${stage}` : `${changes} open, none ready yet`;
}

/**
 * The place's own line, beside its title (`PlaceLine` in `header` density): its state, what runs,
 * since when, its address — and in place of the calm words, what is not calm: a release on its way,
 * one whose deploy failed with what still runs, a deploy under way, a place that is down.
 */
export function placeHeaderLine(input: {
  readonly tier: GroupEnvironmentTier;
  readonly name: string;
  readonly projectId: string | undefined;
  readonly view: Pick<StopView, "tone" | "word" | "version">;
  /** The release on its way to production; production only. */
  readonly releasing: string | undefined;
  /** A deploy of the place failed: production's release, or a stage's deploy. */
  readonly failed: boolean;
  readonly releasedAge: string | undefined;
  readonly since: string | undefined;
  readonly source: string;
  readonly routes: ReadonlyArray<Pick<ZeropsPublicRoute, "service" | "url">>;
}): PlaceLine {
  const { view } = input;
  const label = view.version?.label;
  const calm = placeStatus({
    tier: input.tier,
    view,
    releasedAge: input.releasedAge,
    since: input.since,
    source: input.source,
    services: 0,
  }).text.split(" · ");
  const [dot, words]: readonly [PlaceDot, ReadonlyArray<string>] =
    input.tier === "production" && input.releasing !== undefined
      ? ["releasing", [`Releasing ${input.releasing}`, ...stillRuns(label)]]
      : input.failed
        ? [
            "failed",
            // A stage names the commit that failed, never one that still runs.
            input.tier === "production"
              ? ["Release failed", ...stillRuns(label)]
              : ["Deploy failed"],
          ]
        : view.tone === "pending"
          ? ["releasing", calm]
          : view.tone === "bad"
            ? ["down", calm]
            : view.tone === "good"
              ? ["running", calm]
              : view.word === NOTHING_DEPLOYED
                ? ["none", calm]
                : ["unknown", calm];
  return {
    projectId: input.projectId,
    kind: input.tier,
    name: input.name,
    dot,
    words,
    trouble: dot === "failed" || dot === "down",
    addresses: input.routes.map((route) => ({ service: route.service, url: route.url })),
    ...(dot === "none" ? { nothingDeployed: true as const } : {}),
  };
}

const stillRuns = (label: string | undefined): ReadonlyArray<string> =>
  label === undefined ? [] : [`${label} still runs`];

/**
 * What "Ask <your Mate> to fix it" writes into the Mate's composer from a place's failure panel,
 * in the words the menu's production chip writes it in (`fixProblemOf`): what failed, HQ's words
 * for why, and the ask. Nothing where the panel says no failure.
 */
export function placeFixProblem(input: {
  readonly tier: GroupEnvironmentTier;
  /** The place as its page names it: "Production", "Stage", "Client demo". */
  readonly title: string;
  /** The panel's sentence and HQ's words under it. */
  readonly text: string;
  readonly detail: string | undefined;
  readonly down: boolean;
  /** What still serves there, where it is told. */
  readonly serving: string | undefined;
}): FixProblem {
  const what = input.text.replace(/[.]$/u, "");
  if (input.down) return { what, error: input.detail, ask: "Find out why and bring it back." };
  const serving = input.serving === undefined ? "" : `${input.serving} is still serving. `;
  return {
    what: input.tier === "production" ? what : `${input.title}: ${what}`,
    error: input.detail,
    ask:
      input.tier === "production"
        ? `${serving}Find out why, fix it, and release again.`
        : "Find out why and fix it.",
  };
}
