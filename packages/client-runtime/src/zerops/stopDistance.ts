/**
 * How far a stop is from `main`, and what its row's line says about it
 * (the owner, 2026-09-25, "Stage row redesign" v3).
 *
 * `main` is not a row: it is the reference every stop measures itself against.
 * The distance (`+N` on the row) means the same on a stage and on
 * production — the changes on `main` this stop does not run yet — so a stage
 * at none beside a production at `+3` says all three have run on the stage.
 *
 * ## Where the numbers come from
 *
 * Nothing here reads the network. Production's distance is `releaseContents`,
 * the commits `main` has and production does not, per production service. A
 * stage has no read of its own: its commit is placed in that same list — at
 * `main`'s head it is 0 behind, inside the list it is behind by the commits
 * newer than it, at production's commit it is behind by all of them. Anywhere
 * else nothing says how far it is, and the row says nothing rather than guess.
 *
 * The list is Gitea's `compare/{production}...{main}` in whatever order Gitea
 * returns it, which nothing here has measured. The one commit a compare always
 * holds is its head, `main`'s, so the list is oriented by where that sits; a
 * list it is not in cannot be placed, and a stage in it is not measured.
 *
 * One commit reaches several services in a monorepo, so a sha is counted once,
 * as `releaseContentsSummary` counts a release: the row says how many changes,
 * not how many services take them. Shas compare whole — a short one never
 * equals anything.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module stopDistance
 */

import { CHECKING_WHAT_RUNS, NOTHING_DEPLOYED, type Deployment } from "./flow/deployment.ts";
import type { GroupEnvironmentTier } from "./groupEnvironments.ts";
import { PRODUCTION_DEPLOYING, type GroupFlowStop } from "./groupFlow.ts";
import { deployedCommit, deployTone, type EnvironmentServiceState } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import { releaseInFlightReason, shortCommit } from "./release.ts";

/** One commit `main` has and a stop does not run, in the words it was merged under. */
export interface StopChange {
  /** The whole 40-hex commit. */
  readonly sha: string;
  readonly subject: string;
}

/** One production service's share of `releaseContents`. */
export interface ServiceChanges {
  /** The service's hostname. */
  readonly service: string;
  readonly commits: ReadonlyArray<StopChange>;
}

/** How far a stop is behind `main`: the changes, newest first, each once. */
export interface StopDistance {
  readonly count: number;
  readonly changes: ReadonlyArray<StopChange>;
}

const FULL_SHA = /^[0-9a-f]{40}$/iu;

/** Whether two commits are the same one — by the whole sha, never a prefix. */
function sameSha(left: string | undefined, right: string | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    FULL_SHA.test(left) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function indexOfSha(commits: ReadonlyArray<StopChange>, target: string | undefined): number {
  return commits.findIndex((commit) => sameSha(commit.sha, target));
}

/**
 * A service's commits newest first, turned by where `main`'s head sits;
 * `undefined` where the head is not in the list to orient it by.
 */
function newestFirst(
  commits: ReadonlyArray<StopChange>,
  head: string | undefined,
): ReadonlyArray<StopChange> | undefined {
  const at = indexOfSha(commits, head);
  if (at === -1) return undefined;
  return at === 0 ? commits : [...commits].reverse();
}

/** Every change once, in the order met. */
function distanceOf(lists: ReadonlyArray<ReadonlyArray<StopChange>>): StopDistance {
  const seen = new Set<string>();
  const changes: Array<StopChange> = [];
  for (const commits of lists) {
    for (const commit of commits) {
      const key = commit.sha.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push(commit);
    }
  }
  return { count: changes.length, changes };
}

/**
 * Production's distance: every change `releaseContents` holds, each once.
 * `undefined` where the contents were not read. A list `main`'s head does not
 * orient is kept in the order it was read — the count stands either way.
 */
export function productionDistance(input: {
  readonly contents: ReadonlyArray<ServiceChanges> | undefined;
  readonly mainHeads: ReadonlyMap<string, string> | undefined;
}): StopDistance | undefined {
  if (input.contents === undefined) return undefined;
  return distanceOf(
    input.contents.map(
      (entry) => newestFirst(entry.commits, input.mainHeads?.get(entry.service)) ?? entry.commits,
    ),
  );
}

/**
 * One stage service's changes not on it yet, newest first; `undefined` where
 * nothing places its commit.
 */
function behindOnService(input: {
  readonly runs: string | undefined;
  readonly head: string | undefined;
  readonly production: string | undefined;
  readonly contents: ServiceChanges | undefined;
}): ReadonlyArray<StopChange> | undefined {
  const { runs, head } = input;
  if (runs === undefined || head === undefined) return undefined;
  if (sameSha(runs, head)) return [];
  if (input.contents === undefined) return undefined;
  const ordered = newestFirst(input.contents.commits, head);
  if (ordered === undefined) return undefined;
  const at = indexOfSha(ordered, runs);
  if (at !== -1) return ordered.slice(0, at);
  return sameSha(runs, input.production) ? ordered : undefined;
}

/**
 * A stage's distance, for a stage that follows `main` and nothing else; a
 * branch-fed stage is not on `main`'s line and has none. `undefined` — shown
 * as nothing — where any of its services cannot be placed: a distance that
 * leaves a service out would call a stage in sync that is not.
 */
export function stageDistance(input: {
  /** `EnvironmentRow.source`: exactly `main`, or the stage is not measured. */
  readonly source: string | undefined;
  /** What each stage service runs, hostname → whole sha (`stageStandings(...).runs`). */
  readonly stage: ReadonlyMap<string, string | undefined>;
  /** `main`'s head per service, as the deploy state read it. */
  readonly mainHeads: ReadonlyMap<string, string> | undefined;
  /** What each production service runs (`releaseDeploys(...).production`). */
  readonly production: ReadonlyMap<string, string>;
  readonly contents: ReadonlyArray<ServiceChanges> | undefined;
}): StopDistance | undefined {
  if (input.source !== "main" || input.stage.size === 0) return undefined;
  const lists: Array<ReadonlyArray<StopChange>> = [];
  for (const [service, runs] of input.stage) {
    const behind = behindOnService({
      runs,
      head: input.mainHeads?.get(service),
      production: input.production.get(service),
      contents: input.contents?.find((entry) => entry.service === service),
    });
    if (behind === undefined) return undefined;
    lists.push(behind);
  }
  return distanceOf(lists);
}

/** Where the main-following stage stands, as much as the marks under production need. */
export interface StageStandings {
  /** What each stage service runs, hostname → whole sha; `undefined` for one nothing names. */
  readonly runs: ReadonlyMap<string, string | undefined>;
  /** The whole sha a build on the stage is deploying now. */
  readonly deploying: string | undefined;
  /**
   * The services whose last deploy of what they run failed. Per service: in a
   * monorepo one service failing says nothing of the commit another runs.
   */
  readonly failed: ReadonlySet<string>;
}

/**
 * The stage's standings from what the surfaces already hold: its environment
 * input (`ZeropsProjectFlow.environmentInputs`) and the platform's deployment.
 * A service whose version name carries no commit runs nothing this can place.
 */
export function stageStandings(input: {
  readonly environment: {
    /** Its name in `environments.yaml`, which the deploy statuses name. */
    readonly environment: string;
    readonly services: ReadonlyArray<EnvironmentServiceState>;
  };
  readonly deployment: Shown<Deployment> | undefined;
}): StageStandings {
  const { deployment, environment } = input;
  return {
    runs: new Map(
      environment.services.map((service) => [
        service.hostname,
        deployedCommit(service.appVersionName),
      ]),
    ),
    deploying:
      deployment?.state === "known" && deployment.value.kind === "deploying"
        ? deployment.value.version.sha
        : undefined,
    failed: new Set(
      environment.services
        .filter(
          (service) =>
            deployTone({ environment: environment.environment, services: [service] }) === "bad",
        )
        .map((service) => service.hostname),
    ),
  };
}

/** Where one change production does not run stands on the stage. */
export type StageMark = "on-stage" | "deploying-on-stage" | "failed-on-stage" | "none";

/** One service's mark for one change of its list. */
function markOnService(input: {
  readonly change: StopChange;
  readonly ordered: ReadonlyArray<StopChange> | undefined;
  readonly head: string | undefined;
  readonly service: string;
  readonly runs: string | undefined;
  readonly stage: StageStandings;
}): StageMark {
  const { change, runs, stage } = input;
  if (stage.failed.has(input.service) && sameSha(runs, change.sha)) return "failed-on-stage";
  if (sameSha(stage.deploying, change.sha)) return "deploying-on-stage";
  if (sameSha(runs, input.head)) return "on-stage";
  if (input.ordered === undefined) return "none";
  const at = indexOfSha(input.ordered, runs);
  return at !== -1 && indexOfSha(input.ordered, change.sha) >= at ? "on-stage" : "none";
}

/** A change several services carry: the worst of theirs, and on stage only where all have it. */
function worstMark(left: StageMark, right: StageMark): StageMark {
  for (const mark of ["failed-on-stage", "deploying-on-stage", "none"] as const)
    if (left === mark || right === mark) return mark;
  return "on-stage";
}

/**
 * Where each change production does not run stands on the first stage that
 * follows `main` — the question the list under production answers: has this
 * been seen running anywhere yet? Keyed by the lower-case sha. With no such
 * stage every change is `none`: nothing says, and a release never waits on a
 * stage anyway (D28).
 */
export function stageMarks(input: {
  readonly contents: ReadonlyArray<ServiceChanges>;
  readonly mainHeads: ReadonlyMap<string, string> | undefined;
  readonly stage: StageStandings | undefined;
}): ReadonlyMap<string, StageMark> {
  const marks = new Map<string, StageMark>();
  for (const entry of input.contents) {
    const head = input.mainHeads?.get(entry.service);
    const ordered = newestFirst(entry.commits, head);
    for (const change of entry.commits) {
      const mark =
        input.stage === undefined
          ? "none"
          : markOnService({
              change,
              ordered,
              head,
              service: entry.service,
              runs: input.stage.runs.get(entry.service),
              stage: input.stage,
            });
      const key = change.sha.toLowerCase();
      const seen = marks.get(key);
      marks.set(key, seen === undefined ? mark : worstMark(seen, mark));
    }
  }
  return marks;
}

/** Which state word leads what a stop's line says it runs, in the order the first match wins. */
export type StopWordKind = "failed" | "deploying" | "releasing" | "empty" | "checking";

/** One change under an opened distance, in words. */
export interface StopRowChange {
  readonly sha: string;
  readonly title: string;
}

/**
 * A stop row's line: the state word where something differs, what it
 * runs, and its distance. `distance` is `undefined` where nothing is behind or
 * nothing says — the row then offers nothing to open.
 */
export interface StopRowLine {
  readonly word: { readonly kind: StopWordKind; readonly text: string } | undefined;
  readonly runs: string | undefined;
  readonly distance:
    | { readonly count: number; readonly changes: ReadonlyArray<StopRowChange> }
    | undefined;
}

/**
 * The words that hide the distance: while a stop fails, deploys or is
 * checked, a distance answers a question nobody can act on yet.
 */
const HIDES_DISTANCE: ReadonlySet<StopWordKind> = new Set([
  "failed",
  "deploying",
  "releasing",
  "checking",
]);

/** The failed word, ahead of what failed: `Failed on v1.2.0`. */
const FAILED_ON = "Failed on";
/** The same word where nothing names what failed. */
const FAILED = "Failed";

/**
 * What a stop's line says after its name, stage or production alike (the owner,
 * 2026-09-25). Quiet unless something differs: in sync and healthy it says
 * only what the stop runs. Otherwise one word leads, first match wins —
 * failed, deploying or releasing, running nothing, checking — and while it
 * does the distance stays hidden, except beside "nothing deployed", where the
 * distance is what the first deploy will bring. A stop being set up is not
 * held by the flow yet: its row says so on its own, with no line of this kind.
 *
 * What it runs is named the same on both tiers: the version's name (a tag),
 * else its short commit (`DeployedVersion.label`). A stage is not tied to a
 * Mate — whatever is pushed to the branch its trigger watches gets deployed —
 * so a change's title never names a stop (the owner, 2026-09-25: "Mate:
 * zitdev" on a stage read as that Mate's). A stage that follows anything but
 * `main` says its source in front (`feat/cart · 3f9c1b2`); `—`, a stage
 * declaring no branch, is not a source worth saying.
 */
export function stopRowLine(input: {
  readonly tier: GroupEnvironmentTier;
  /** The stop as the flow holds it. */
  readonly stop: Pick<GroupFlowStop, "state" | "version" | "source">;
  /** The release tag on its way to production (`releaseInFlight`); production only. */
  readonly releasing: string | undefined;
  /** `productionDistance` or `stageDistance`. */
  readonly distance: StopDistance | undefined;
}): StopRowLine {
  const { stop } = input;
  // Only a stage on `main`'s line is measured against it, whatever a caller hands in.
  const distance =
    input.tier === "production" || stop.source === "main"
      ? distanceLine(input.distance)
      : undefined;
  const word = (kind: StopWordKind, text: string, runs?: string): StopRowLine => ({
    word: { kind, text },
    runs,
    distance: HIDES_DISTANCE.has(kind) ? undefined : distance,
  });
  const name = stop.version?.label;
  const shown =
    input.tier === "stage" &&
    stop.source !== undefined &&
    stop.source !== "main" &&
    stop.source !== "—"
      ? [stop.source, name]
      : [name];
  const runs = shown.filter((part) => part !== undefined).join(" · ") || undefined;
  if (stop.state === "failed") return word("failed", name === undefined ? FAILED : FAILED_ON, runs);
  if (input.tier === "production" && input.releasing !== undefined)
    return word("releasing", releaseInFlightReason(input.releasing));
  if (stop.state === "deploying")
    // No ellipsis after a name: on the stop's one line it is a character the
    // hash needs more (the owner, 2026-09-25: "Deploying 9e4b7d2").
    return word("deploying", name === undefined ? PRODUCTION_DEPLOYING : `Deploying ${name}`);
  if (stop.state === "empty") return word("empty", NOTHING_DEPLOYED);
  if (stop.state === "checking") return word("checking", CHECKING_WHAT_RUNS);
  return { word: undefined, runs, distance };
}

/**
 * The distance in words, or `undefined` where nothing is behind. Each change
 * by the subject it was committed under: this list is about the changes, so
 * their own words name them.
 */
function distanceLine(distance: StopDistance | undefined): StopRowLine["distance"] {
  if (distance === undefined || distance.count === 0) return undefined;
  return {
    count: distance.count,
    changes: distance.changes.map((change) => ({
      sha: change.sha,
      title: change.subject.trim() || shortCommit(change.sha),
    })),
  };
}
