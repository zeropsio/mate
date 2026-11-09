/**
 * What a place's page says beyond its header: what is live now and what that release brought, and
 * the changes that go next — merged ones waiting for production's next release, or a stage's open
 * changes waiting to be merged to it.
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

import type { PlaceDot, PlaceLine } from "../projects/projectCard.logic";
import { releaseOfLanding } from "../projects/projectHistory.logic";
import { placeStatus } from "./place.logic";

/** How many of a live release's changes its line names before "+ N". */
const BROUGHT_NAMED = 3;

const newestFirst = (left: string | undefined, right: string | undefined) =>
  (right ?? "").localeCompare(left ?? "");

/** "Live now"'s fact: "v0.1.3, released by Dana K. 7d ago"; who only where the person is known. */
export function liveNowFact(input: {
  readonly tag: string;
  readonly by: string | undefined;
  readonly age: string | undefined;
}): string {
  const released = ["released", input.by === undefined ? undefined : `by ${input.by}`, input.age]
    .filter((part) => part !== undefined && part.length > 0)
    .join(" ");
  return `${input.tag}, ${released}`;
}

/**
 * What a live release brought, from its recorded membership: the first changes' titles and how
 * many more. `undefined` on a release recorded before membership was, or one that brought none.
 */
export function releaseBrought(
  release: Pick<FlowReleaseRow, "history">,
): { readonly titles: ReadonlyArray<string>; readonly more: number } | undefined {
  const changes = release.history?.changes;
  if (changes === undefined || changes.length === 0) return undefined;
  return {
    titles: changes.slice(0, BROUGHT_NAMED).map((change) => change.title),
    more: Math.max(0, changes.length - BROUGHT_NAMED),
  };
}

/**
 * The Mates' merged changes no release has put live yet, newest first: what production's next
 * release carries. A change to the setup repository goes to no release, so it is not one of them.
 */
export function changesWaitingForRelease(
  merged: ReadonlyArray<FlowPullRequest>,
  releases: ReadonlyArray<Pick<FlowReleaseRow, "tag" | "taggedAt" | "verdict" | "rollbackOf">>,
): ReadonlyArray<FlowPullRequest> {
  return merged
    .filter(
      (pull) =>
        pull.kind !== "recipe" &&
        pull.mergedAt !== undefined &&
        releaseOfLanding(pull.mergedAt, releases) === undefined,
    )
    .toSorted((left, right) => newestFirst(left.mergedAt, right.mergedAt));
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

/** "2 changes ready to merge to stage", or how many are open where none is ready yet. */
export function stageNextTitle(open: ReadonlyArray<FlowPullRequest>): string {
  const ready = open.filter((pull) => changeState(pull)?.word === READY_TO_MERGE).length;
  const count = ready > 0 ? ready : open.length;
  const changes = `${String(count)} ${count === 1 ? "change" : "changes"}`;
  return ready > 0 ? `${changes} ready to merge to stage` : `${changes} open, not ready to merge`;
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
            [input.tier === "production" ? "Release failed" : "Deploy failed", ...stillRuns(label)],
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
