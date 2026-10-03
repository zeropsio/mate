/**
 * Where the changes a release would carry stand on the stage that follows
 * `main`: is each running there, deploying, or failed? The release review
 * marks its list with it ("stage ran it").
 *
 * Nothing here reads the network: the stage's standing comes from what the
 * surfaces already hold (its environment input, with HQ's deploys), and a
 * change is placed by the whole sha in the list. Shas compare whole: a commit
 * spelled short is first resolved to the one listed commit it begins, and one
 * that begins none, or two, places nothing.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module stageMarks
 */

import type { EnvironmentServiceState } from "./groupRows.ts";
import { isWholeSha, resolveCommit } from "./versionName.ts";

/** One commit `main` has and a stop does not run, in the words it was merged under. */
export interface StopChange {
  /** The whole 40-hex commit. */
  readonly sha: string;
  readonly subject: string;
}

/** One comparison of what a release puts live (`Moved`), and the production services it moves. */
export interface ServiceChanges {
  /** The repository compared, where it is named: whose `main` head says the stage runs it all. */
  readonly repository?: string | undefined;
  /** The services' hostnames. */
  readonly services: ReadonlyArray<string>;
  /** Newest first, as HQ compares them. */
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

/**
 * Where the main-following stage stands, as much as the marks under production need: per service,
 * from HQ's deploys — the same for everyone who sees the application, whatever their grant lets
 * them read of the stage's own project (F25, e2e 2026-10-03: the owner read "1 of 4", the
 * Developer, whose grant does not reach the stage, "0 of 4").
 */
export interface StageStandings {
  /** What each stage service runs: the commit HQ last put live there; `undefined` where none. */
  readonly runs: ReadonlyMap<string, string | undefined>;
  /** The commit HQ is putting on each service now, where it is. */
  readonly deploying: ReadonlyMap<string, string>;
  /**
   * The commit whose deploy failed on each service, where its newest deploy did. Per service: in a
   * monorepo one service failing says nothing of the commit another runs.
   */
  readonly failed: ReadonlyMap<string, string>;
}

/**
 * The stage's standings from its environment input (`ZeropsProjectFlow.environmentInputs`), whose
 * services carry HQ's deploys: what each runs is the commit HQ last put live there, never a
 * version name only some viewers can read; a service HQ never put live runs nothing this can place.
 */
export function stageStandings(environment: {
  readonly services: ReadonlyArray<EnvironmentServiceState>;
}): StageStandings {
  const deploying = new Map<string, string>();
  const failed = new Map<string, string>();
  for (const { hostname, deploy } of environment.services) {
    const latest = deploy?.latest;
    if (latest?.state === "pending" || latest?.state === "deploying")
      deploying.set(hostname, latest.sha);
    if (latest?.state === "failed") failed.set(hostname, latest.sha);
  }
  return {
    runs: new Map(
      environment.services.map((service) => [service.hostname, service.deploy?.live?.sha]),
    ),
    deploying,
    failed,
  };
}

/**
 * Whether the stage says what any of its services runs: one HQ never put anything live on places
 * no change, and is no "0 of N".
 */
export function stageRead(stage: StageStandings): boolean {
  return [...stage.runs.values()].some((sha) => sha !== undefined);
}

/** Where one change production does not run stands on the stage. */
export type StageMark = "on-stage" | "deploying-on-stage" | "failed-on-stage" | "none";

/** One service's mark for one change of its list. */
function markOnService(input: {
  readonly change: StopChange;
  /** The list, newest first: a stage running one of them runs every one listed after it. */
  readonly commits: ReadonlyArray<StopChange>;
  /** The repository's `main` head, where known: a stage running it runs every change listed. */
  readonly head: string | undefined;
  /** What the service runs, deploys and failed to deploy, resolved to whole shas. */
  readonly runs: string | undefined;
  readonly deploying: string | undefined;
  readonly failed: string | undefined;
}): StageMark {
  const { change, commits, runs } = input;
  if (sameSha(input.failed, change.sha)) return "failed-on-stage";
  if (sameSha(input.deploying, change.sha)) return "deploying-on-stage";
  if (sameSha(runs, input.head)) return "on-stage";
  const at = commits.findIndex((listed) => sameSha(runs, listed.sha));
  return at !== -1 && commits.indexOf(change) >= at ? "on-stage" : "none";
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
 * been seen running anywhere yet? Keyed by the lower-case sha. A stage running
 * a listed commit runs every change listed before it too, and one running its
 * repository's `main` head runs them all (main #177; F25, e2e 2026-10-03: a
 * stage on main's head read "Stage runs 1 of 4 changes"). With no such stage
 * every change is `none`: nothing says, and a release never waits on a stage
 * anyway (D28).
 */
export function stageMarks(input: {
  readonly contents: ReadonlyArray<ServiceChanges>;
  readonly stage: StageStandings | undefined;
  /** Each repository's `main` head, by name (`ZeropsProjectFlow.repos`). */
  readonly mainHeads?: ReadonlyMap<string, string> | undefined;
}): ReadonlyMap<string, StageMark> {
  const marks = new Map<string, StageMark>();
  for (const entry of input.contents) {
    const head =
      entry.repository === undefined ? undefined : input.mainHeads?.get(entry.repository);
    const known = [...(head === undefined ? [] : [head]), ...entry.commits.map(({ sha }) => sha)];
    for (const service of entry.services) {
      const runs = resolveCommit(input.stage?.runs.get(service), known);
      const deploying = resolveCommit(input.stage?.deploying.get(service), known);
      const failed = resolveCommit(input.stage?.failed.get(service), known);
      for (const change of entry.commits) {
        const mark =
          input.stage === undefined
            ? "none"
            : markOnService({ change, commits: entry.commits, head, runs, deploying, failed });
        const key = change.sha.toLowerCase();
        const seen = marks.get(key);
        marks.set(key, seen === undefined ? mark : worstMark(seen, mark));
      }
    }
  }
  return marks;
}
