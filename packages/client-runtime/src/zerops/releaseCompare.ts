/**
 * What a release would put live, and what a rollback takes off production and brings back (main
 * C06, C30), from HQ's comparisons of a repository's commits
 * (`GET /api/apps/:appId/repos/:repo/compare`, git's `base..head`): which to ask for, and how
 * their answers read.
 *
 * HQ compares whole shas only, so production's side is its commit as HQ recorded the deploy
 * (`releaseDeploys`); one known only by a version name's seven hex cannot be asked about.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseCompare
 */

import {
  COMPARE_COUNT_MAX,
  Sha,
  type CompareCommit,
  type CompareQuery,
  type CompareResponse,
} from "@t3tools/shared/hqChanges";
import * as Schema from "effect/Schema";

import type { FlowRelease, ReleaseEntry } from "./release.ts";
import { resolveCommit, sameCommit } from "./versionName.ts";

/** One comparison to ask HQ for, and the production services it answers for. */
export interface CompareRead {
  readonly repository: string;
  readonly query: CompareQuery;
  /** By hostname, in the order the recipe lists them. */
  readonly services: ReadonlyArray<string>;
}

/** The comparisons to ask for, and the services none can be asked for. */
export interface CompareReads {
  readonly reads: ReadonlyArray<CompareRead>;
  /** Production services whose commit is known only short: what moves on them cannot be asked. */
  readonly untold: ReadonlyArray<string>;
}

const isSha = Schema.is(Sha);

/**
 * What production runs, whole where a release lists the commit a version's name spells short for
 * that service: HQ names a version `{tag} {7 hex}`, and the record of its deploy may be gone where
 * the release it deployed is not — an environment the migration brought, say. One no release
 * lists stays short, and is not compared (`untold`).
 */
export function wholeProduction(
  /** `{service: sha}` production runs, whole where HQ recorded it (`releaseDeploys`). */
  production: ReadonlyMap<string, string>,
  releases: ReadonlyArray<Pick<FlowRelease, "entries">>,
): ReadonlyMap<string, string> {
  return new Map(
    [...production].map(([service, sha]) => {
      const listed = releases.flatMap(({ entries }) =>
        entries.filter((entry) => entry.service === service).map((entry) => entry.commit),
      );
      return [service, resolveCommit(sha, listed) ?? sha];
    }),
  );
}

/** `read` among `reads`: one per repository and pair of commits, however many services take it. */
function ask(reads: Array<CompareRead>, read: CompareRead): void {
  const index = reads.findIndex(
    (asked) =>
      asked.repository === read.repository &&
      asked.query.base === read.query.base &&
      asked.query.head === read.query.head,
  );
  const asked = reads[index];
  if (asked === undefined) reads.push(read);
  else reads[index] = { ...asked, services: [...asked.services, ...read.services] };
}

/**
 * What to ask so a release can say what it puts live: per production service, its repository's
 * commits from what production runs to `main`'s head — and from the first commit where production
 * runs nothing yet, which is a first release. A service already at `main` moves nothing and is not
 * asked about.
 */
export function releaseReads(input: {
  /** The repository each production runtime builds from, by hostname (`AppRecipe`). */
  readonly productionRepositories: ReadonlyMap<string, string>;
  /** `{service: whole sha}` its repository's `main` holds (`releaseCandidate`). */
  readonly candidate: ReadonlyMap<string, string>;
  /** `{service: sha}` production runs, whole where HQ recorded it (`releaseDeploys`). */
  readonly production: ReadonlyMap<string, string>;
}): CompareReads {
  const reads: Array<CompareRead> = [];
  const untold: Array<string> = [];
  for (const [service, head] of input.candidate) {
    const repository = input.productionRepositories.get(service);
    const running = input.production.get(service);
    if (repository === undefined || sameCommit(running, head)) continue;
    if (running === undefined) ask(reads, { repository, query: { head }, services: [service] });
    else if (isSha(running))
      ask(reads, { repository, query: { base: running, head }, services: [service] });
    else untold.push(service);
  }
  return { reads, untold };
}

/**
 * What to ask so a rollback can say what it takes off production and what it brings back: per
 * service the release lists, its repository's commits production runs that the release does not
 * (`release..running`), and the ones the release lists that production does not run
 * (`running..release`). Both at once where production moved on past a commit the release has.
 */
export function rollbackReads(input: {
  /** The repository each production runtime builds from, by hostname (`AppRecipe`). */
  readonly productionRepositories: ReadonlyMap<string, string>;
  /** What the release gone back to lists. */
  readonly entries: ReadonlyArray<ReleaseEntry>;
  /** `{service: sha}` production runs, whole where HQ recorded it (`releaseDeploys`). */
  readonly production: ReadonlyMap<string, string>;
}): {
  readonly leaving: ReadonlyArray<CompareRead>;
  readonly comingBack: ReadonlyArray<CompareRead>;
  readonly untold: ReadonlyArray<string>;
} {
  const leaving: Array<CompareRead> = [];
  const comingBack: Array<CompareRead> = [];
  const untold: Array<string> = [];
  for (const { service, commit } of input.entries) {
    const repository = input.productionRepositories.get(service);
    const running = input.production.get(service);
    if (repository === undefined || sameCommit(running, commit)) continue;
    if (running === undefined) {
      ask(comingBack, { repository, query: { head: commit }, services: [service] });
    } else if (isSha(running)) {
      ask(leaving, { repository, query: { base: commit, head: running }, services: [service] });
      ask(comingBack, { repository, query: { base: running, head: commit }, services: [service] });
    } else untold.push(service);
  }
  return { leaving, comingBack, untold };
}

/**
 * What to ask so each release can say what it carried (main C25): per repository it moved, named
 * by its first service that moved, the commits from the one the nearest older release lists — for
 * that service, else for another of its repository — to its own; with none older, from the
 * repository's first commit. A refused release never deployed, so it is no release's baseline; a
 * rollback to an older commit carries nothing new, which git's `base..head` answers by itself.
 */
export function carriedReads(input: {
  /** Newest first, the whole list. */
  readonly releases: ReadonlyArray<Pick<FlowRelease, "tag" | "entries" | "verdict">>;
  /** `hostname → repository`. */
  readonly repositoryOf: ReadonlyMap<string, string>;
}): ReadonlyMap<string, ReadonlyArray<CompareRead>> {
  return new Map(
    input.releases.map((release, index) => {
      const older = input.releases
        .slice(index + 1)
        .filter((earlier) => earlier.verdict !== "refused")
        .flatMap((earlier) => earlier.entries);
      const reads: Array<CompareRead> = [];
      for (const { service, commit } of release.entries) {
        const repository = input.repositoryOf.get(service);
        if (repository === undefined) continue;
        const base = (
          older.find((entry) => entry.service === service) ??
          older.find((entry) => input.repositoryOf.get(entry.service) === repository)
        )?.commit;
        if (sameCommit(base, commit) || reads.some((read) => read.repository === repository))
          continue;
        reads.push({
          repository,
          query: base === undefined ? { head: commit } : { base, head: commit },
          services: [service],
        });
      }
      return [release.tag, reads];
    }),
  );
}

/** What a read is held under: its repository and pair of commits. */
export function compareReadKey(read: CompareRead): string {
  return JSON.stringify([read.repository, read.query.base ?? null, read.query.head]);
}

/** One comparison's commits, and the production services they move on. */
export interface Moved {
  readonly repository: string;
  readonly services: ReadonlyArray<string>;
  /** Newest first, at most `COMPARE_COMMITS_MAX`. */
  readonly commits: ReadonlyArray<CompareCommit>;
  /** How many move, counted up to `COMPARE_COUNT_MAX`: more than `commits` lists when truncated. */
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * What moves: known once HQ answered every comparison asked; else why one went unanswered, and
 * until then still being read.
 */
export type MovedCommits =
  | { readonly state: "known"; readonly moved: ReadonlyArray<Moved> }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "reading" };

/** `answer` where it compares the read's own pair of commits; HQ names both in every answer. */
function answerTo(
  read: CompareRead,
  answer: CompareResponse | undefined,
): CompareResponse | undefined {
  if (answer === undefined) return undefined;
  const same = answer.base === (read.query.base ?? null) && answer.head === read.query.head;
  return same ? answer : undefined;
}

/**
 * The commits each read moves, from HQ's answers held under {@link compareReadKey}. Two commits
 * compare the same for ever, so an answer held stands beside a later failure to read it again.
 */
export function movedCommits(input: {
  readonly reads: ReadonlyArray<CompareRead>;
  readonly answers: ReadonlyMap<string, CompareResponse>;
  /** Why a read was not answered, in words, under {@link compareReadKey}. */
  readonly failures: ReadonlyMap<string, string>;
}): MovedCommits {
  const moved: Array<Moved> = [];
  let reading = false;
  for (const read of input.reads) {
    const key = compareReadKey(read);
    const answer = answerTo(read, input.answers.get(key));
    if (answer === undefined) {
      const failure = input.failures.get(key);
      if (failure !== undefined) return { state: "failed", reason: failure };
      reading = true;
      continue;
    }
    moved.push({
      repository: read.repository,
      services: read.services,
      commits: answer.commits,
      total: answer.total,
      truncated: answer.truncated,
    });
  }
  return reading ? { state: "reading" } : { state: "known", moved };
}

/**
 * How many commits move, each once however many reads of its repository list it. A repository's
 * reads that list every commit they count are counted exactly; one cut short counts as HQ counted,
 * and a count HQ stopped at ({@link COMPARE_COUNT_MAX}) is at least that many. Two reads of one
 * repository (services on different commits of it) overlap, and where either is cut short the
 * commits they share cannot be told apart: the larger count is at least how many move.
 */
export function movedCount(moved: ReadonlyArray<Moved>): {
  readonly count: number;
  readonly atLeast: boolean;
} {
  let count = 0;
  let atLeast = moved.some((read) => read.total >= COMPARE_COUNT_MAX);
  for (const repository of new Set(moved.map((read) => read.repository))) {
    const reads = moved.filter((read) => read.repository === repository);
    const listed = new Set(reads.flatMap((read) => read.commits.map((commit) => commit.sha))).size;
    if (!reads.some((read) => read.truncated)) count += listed;
    else {
      count += Math.max(listed, ...reads.map((read) => read.total));
      atLeast ||= reads.length > 1;
    }
  }
  return { count, atLeast };
}
