/**
 * Where the changes a release would carry stand on the stage that follows
 * `main`: has each been seen running anywhere yet? The release review marks
 * its list with it ("stage ran it").
 *
 * Nothing here reads the network: the stage's standing comes from what the
 * surfaces already hold (its environment input and the platform's
 * deployment), and a change is placed by the whole sha in the list Gitea's
 * `compare/{production}...{main}` returned, oriented by where `main`'s head
 * sits. Shas compare whole: a version name that spells the stage's commit
 * short (`versionName.ts`) is first resolved to the one listed commit — or
 * `main`'s head — it begins, and one that begins none, or two, places nothing.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module stageMarks
 */

import type { Deployment } from "./flow/deployment.ts";
import { deployedCommit, deployTone, type EnvironmentServiceState } from "./groupRows.ts";
import { isWholeSha, resolveCommit } from "./versionName.ts";
import type { Shown } from "./knowledge/known.ts";

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

/** Whether two commits are the same one — by the whole sha, never a prefix (`resolveCommit` first). */
function sameSha(left: string | undefined, right: string | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    isWholeSha(left) &&
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

/** Where the main-following stage stands, as much as the marks under production need. */
export interface StageStandings {
  /**
   * What each stage service runs, hostname → sha as its version name spells it, whole or short;
   * `undefined` for one nothing names.
   */
  readonly runs: ReadonlyMap<string, string | undefined>;
  /** The sha a build on the stage is deploying now, whole or short. */
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
  readonly environment: { readonly services: ReadonlyArray<EnvironmentServiceState> };
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
        .filter((service) => deployTone([service]) === "bad")
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
  /** What the service runs and deploys, resolved to whole shas. */
  readonly runs: string | undefined;
  readonly deploying: string | undefined;
  readonly stage: StageStandings;
}): StageMark {
  const { change, runs, stage } = input;
  if (stage.failed.has(input.service) && sameSha(runs, change.sha)) return "failed-on-stage";
  if (sameSha(input.deploying, change.sha)) return "deploying-on-stage";
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
    const known = [head, ...entry.commits.map((commit) => commit.sha)];
    const runs = resolveCommit(input.stage?.runs.get(entry.service), known);
    const deploying = resolveCommit(input.stage?.deploying, known);
    for (const change of entry.commits) {
      const mark =
        input.stage === undefined
          ? "none"
          : markOnService({
              change,
              ordered,
              head,
              service: entry.service,
              runs,
              deploying,
              stage: input.stage,
            });
      const key = change.sha.toLowerCase();
      const seen = marks.get(key);
      marks.set(key, seen === undefined ? mark : worstMark(seen, mark));
    }
  }
  return marks;
}
