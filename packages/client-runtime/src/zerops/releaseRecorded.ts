/**
 * What a release carries and what a roll back takes off and brings back, said from what HQ already
 * stores: the changes it recorded for a release (`releaseChanges`, `Release.history`) joined with
 * the application's change list for their Mate and merge. No repository is compared: a fact HQ
 * has not recorded reads "not known yet", never a box read on view.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseRecorded
 */

import type { HqChange } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";

import type { Moved, MovedCommits } from "./releaseCompare.ts";

/** A change a release carries, as HQ records it. */
export interface CarriedChange {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
}

type ChangeFacts = Pick<HqChange, "repo" | "number" | "mateProjectId" | "mergedSha" | "mergedAt">;

/**
 * The changes as the comparison's commits would list them, one commit per change, newest merge
 * first: the merge commit where the change list holds it, else a stand-in no stage can sit on. The
 * services of a repository are the production runtimes built from it.
 */
export function carriedMoved(input: {
  readonly changes: ReadonlyArray<CarriedChange>;
  /** The application's change list; a carried change it lacks has no Mate and no merge time. */
  readonly known: ReadonlyArray<ChangeFacts>;
  /** `hostname → repository` of the production runtimes. */
  readonly repositories: ReadonlyMap<string, string> | undefined;
}): ReadonlyArray<Moved> {
  const facts = new Map(
    input.known.map((change) => [`${change.repo}#${String(change.number)}`, change]),
  );
  const byRepository = new Map<string, Moved["commits"][number][]>();
  const seen = new Set<string>();
  for (const { repo, number, title } of input.changes) {
    const id = `${repo}#${String(number)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const change = facts.get(id);
    const commits = byRepository.get(repo) ?? [];
    commits.push({
      sha: change?.mergedSha ?? id,
      subject: title,
      authorName: "",
      at: change?.mergedAt ?? "",
      change: { number, title, mateProjectId: change?.mateProjectId ?? "" },
    });
    byRepository.set(repo, commits);
  }
  return [...byRepository].map(([repository, commits]) => ({
    repository,
    services: [...(input.repositories ?? [])].flatMap(([hostname, repo]) =>
      repo === repository ? [hostname] : [],
    ),
    commits: [...commits].sort((a, b) => b.at.localeCompare(a.at)),
    total: commits.length,
    truncated: false,
  }));
}

/** A commit a release carries that no change landed, as HQ stores it. */
export interface OutsideCommit {
  readonly repo: string;
  readonly sha: string;
  readonly subject: string;
  readonly authorName: string;
  readonly at: string;
}

/** HQ's stored commits outside changes as the comparison would list them: no change on a commit. */
export function outsideMoved(input: {
  readonly commits: ReadonlyArray<OutsideCommit>;
  readonly repositories: ReadonlyMap<string, string> | undefined;
}): ReadonlyArray<Moved> {
  const byRepository = new Map<string, Moved["commits"][number][]>();
  for (const { repo, sha, subject, authorName, at } of input.commits) {
    byRepository.set(repo, [
      ...(byRepository.get(repo) ?? []),
      { sha, subject, authorName, at, change: null },
    ]);
  }
  return [...byRepository].map(([repository, commits]) => ({
    repository,
    services: [...(input.repositories ?? [])].flatMap(([hostname, repo]) =>
      repo === repository ? [hostname] : [],
    ),
    commits: [...commits].sort((a, b) => b.at.localeCompare(a.at)),
    total: commits.length,
    truncated: false,
  }));
}

/** What a release would put live from HQ's records: `reading` until HQ recorded the changes. */
export function carriedByRecords(input: {
  readonly carried:
    | { readonly state: "pending" }
    | { readonly state: "known"; readonly changes: ReadonlyArray<CarriedChange> };
  readonly known: ReadonlyArray<ChangeFacts>;
  readonly repositories: ReadonlyMap<string, string> | undefined;
}): MovedCommits {
  return input.carried.state === "pending"
    ? { state: "reading" }
    : {
        state: "known",
        moved: carriedMoved({
          changes: input.carried.changes,
          known: input.known,
          repositories: input.repositories,
        }),
      };
}

/** One side of a roll back as HQ's release histories say it. */
export type RecordedSide =
  | {
      readonly state: "known";
      readonly changes: ReadonlyArray<CarriedChange>;
    }
  /** A release in between has no recorded membership (made before HQ recorded it). */
  | { readonly state: "unrecorded" };

const NOTHING: RecordedSide = { state: "known", changes: [] };
const UNRECORDED: RecordedSide = { state: "unrecorded" };

/**
 * What a roll back from the release production runs to `target` takes off production and brings
 * back, from the releases' recorded histories (each lists what it carried over the one before it).
 * Going to an older release, what leaves is what the releases between carried and nothing comes
 * back; to a newer one, the reverse. A roll back in between makes the line no line: its
 * membership is not what its tag lists, so neither side is told.
 */
export function rollbackFromHistories(input: {
  /** Newest first, as HQ lists them. */
  readonly releases: ReadonlyArray<Pick<Release, "tag" | "state" | "rollbackOf" | "history">>;
  readonly live: string | undefined;
  readonly target: string;
}): { readonly leaving: RecordedSide; readonly comingBack: RecordedSide } {
  const deployed = input.releases.filter((release) => release.state === "approved");
  const liveAt = deployed.findIndex((release) => release.tag === input.live);
  const targetAt = deployed.findIndex((release) => release.tag === input.target);
  if (liveAt < 0 || targetAt < 0) return { leaving: UNRECORDED, comingBack: UNRECORDED };
  if (liveAt === targetAt) return { leaving: NOTHING, comingBack: NOTHING };
  const older = targetAt > liveAt;
  const between = deployed.slice(older ? liveAt : targetAt, older ? targetAt : liveAt);
  if (between.some((release) => release.rollbackOf !== null)) {
    return { leaving: UNRECORDED, comingBack: UNRECORDED };
  }
  const side: RecordedSide = between.some((release) => release.history === undefined)
    ? UNRECORDED
    : {
        state: "known",
        changes: [
          ...new Map(
            between
              .flatMap((release) => release.history?.changes ?? [])
              .map((change) => [`${change.repo}#${String(change.number)}`, change]),
          ).values(),
        ],
      };
  return older ? { leaving: side, comingBack: NOTHING } : { leaving: NOTHING, comingBack: side };
}
