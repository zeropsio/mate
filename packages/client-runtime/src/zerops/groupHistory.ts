/**
 * A group's history, as one list of commits with what happened to each.
 *
 * The menu draws a project as a timeline of where work *is*; this is the same timeline over
 * *time*, and it is assembled rather than fetched, from three answers:
 *
 * - **What `main` holds** — HQ's comparison from the repository's first commit to `main`'s head
 *   (`compare` on HQ's scope socket), newest first and bounded: the spine. Each commit
 *   names the change of HQ's that landed it, where one did.
 * - **What each environment runs** — the sha in the deployed version's name, read from Zerops
 *   (`groupDeploys.ts`), so a commit knows it is live.
 * - **The releases** — HQ's records, so a commit knows it was shipped and under what name.
 *
 * A commit nobody deployed and nothing released is still a commit, and still a row: the history
 * is the branch's, not the deployments'. That is why this folds annotations *onto* commits instead
 * of interleaving three kinds of event — the interleaved version has to invent an order for a
 * deploy and a release that share a timestamp, and the answer it invents is arbitrary.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupHistory
 */

import { COMPARE_COUNT_MAX, type CompareCommit } from "@t3tools/shared/hqChanges";
import { compareReleaseTags } from "@t3tools/shared/hqRelease";

import { rolledBackTo, shortCommit, type FlowRelease } from "./release.ts";
import { resolveCommit } from "./versionName.ts";

/** One commit on the branch, and what reached it. */
export interface HistoryEntry {
  readonly sha: string;
  /** The seven characters a person actually reads. */
  readonly shortSha: string;
  readonly subject: string;
  /** Who git says wrote it. */
  readonly author: string | undefined;
  readonly at: string | undefined;
  /** The change of HQ's that landed it, and the Mate whose it is; `null` for a commit none did. */
  readonly change: CompareCommit["change"];
  /**
   * The environments running this exact commit, in the order they were given —
   * which is the file's order, stage before production (`groupDeploys.ts`).
   */
  readonly deployedTo: ReadonlyArray<string>;
  /** The releases that shipped it — the first, then the roll backs that brought it back. */
  readonly tags: ReadonlyArray<string>;
}

/**
 * The branch's commits with every deploy and tag folded onto the one they
 * name.
 *
 * A version's name spells its commit whole or, since 2026-09-30, short: it
 * annotates the one commit of the branch it begins (`resolveCommit`), and none
 * where it begins two. A version somebody deployed by hand is named whatever
 * they typed — not a commit this branch can be said to carry, so it annotates
 * no row.
 */
export function groupHistory(input: {
  /** `main`'s commits, newest first, as HQ compares them. */
  readonly commits: ReadonlyArray<CompareCommit>;
  /** `environment name → the sha it runs`, whole or short as its version name spells it. */
  readonly deployed: ReadonlyMap<string, string>;
  /** `full sha → the releases that shipped it` ({@link releaseTagsByCommit}). */
  readonly tags: ReadonlyMap<string, ReadonlyArray<string>>;
}): ReadonlyArray<HistoryEntry> {
  const deployedBySha = new Map<string, Array<string>>();
  const branch = input.commits.map((commit) => commit.sha);
  for (const [environment, named] of input.deployed) {
    const sha = resolveCommit(named, branch);
    if (sha === undefined) continue;
    const at = deployedBySha.get(sha);
    if (at === undefined) deployedBySha.set(sha, [environment]);
    else at.push(environment);
  }
  return input.commits.map((commit) => ({
    sha: commit.sha,
    shortSha: shortCommit(commit.sha),
    subject: commit.subject,
    author: commit.authorName,
    at: commit.at,
    change: commit.change,
    deployedTo: deployedBySha.get(commit.sha.toLowerCase()) ?? [],
    tags: input.tags.get(commit.sha) ?? [],
  }));
}

/**
 * The one line under a commit's subject: who wrote it and what it is running
 * on, never a repetition of the subject above it.
 *
 * `undefined` where neither is known — a row with an empty second line is a
 * row that moved everything below it for nothing.
 */
export function historyLine(
  entry: HistoryEntry,
  now?: number,
  names?: {
    /** `projectId → the Mate's name`, so a bot login never reaches the line. */
    readonly mateNames?: ReadonlyMap<string, string> | undefined;
  },
): string | undefined {
  // A change a Mate landed is the Mate's, whoever git says wrote its commit: named, or not said.
  const who =
    entry.change === null ? entry.author : names?.mateNames?.get(entry.change.mateProjectId);
  // Each stop by its project's name under its application (`projectNameInApp`).
  const parts = [who, ...entry.deployedTo].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  // A history with no time in it is a list, not a history: the age is the one
  // thing every other VCS puts on the row and this one was dropping.
  const age = now === undefined ? undefined : historyAge(entry.at, now);
  if (age !== undefined) parts.push(age);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/**
 * How long ago, in the shortest true form — `3m`, `4h`, `6d`, `2mo`, `1y`.
 *
 * Short because it sits at the end of a line that already carries a name and
 * wherever it went live; a full date would be the longest thing on the row and
 * the least often read. A commit dated in the future (a skewed committer
 * clock, which git happily stores) reads as `now` rather than as a negative.
 */
export function historyAge(at: string | undefined, now: number): string | undefined {
  if (at === undefined) return undefined;
  const then = Date.parse(at);
  if (Number.isNaN(then)) return undefined;
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${String(months)}mo`;
  return `${String(Math.floor(months / 12))}y`;
}

/**
 * What a history says in place of its rows: the read under way, or a branch with nothing on it.
 * A failed read says its own reason instead.
 */
export function historyNote(kind: "reading" | "empty"): string {
  switch (kind) {
    case "reading":
      return "Reading the history…";
    case "empty":
      return "Nothing has landed on this repository yet.";
  }
}

/**
 * What a history says under its rows where HQ listed only the newest of them: how many earlier
 * commits it counted, and at least that many where it stopped counting
 * (`COMPARE_COUNT_MAX`); `undefined` where every commit is shown.
 */
export function historyEarlier(shown: number, total: number): string | undefined {
  const earlier = total - shown;
  if (earlier <= 0) return undefined;
  const atLeast = total >= COMPARE_COUNT_MAX ? "+" : "";
  return `${String(earlier)}${atLeast} earlier ${earlier === 1 && atLeast === "" ? "commit" : "commits"}`;
}

/**
 * `sha → the releases that put it in front of people`, for any repository: the one that first did,
 * and every roll back that brought it back (`rolledBackTo`).
 *
 * A release lists every service's commit, whole, and a sha is unique across every repository of
 * the application: a sha a release lists that also appears in this repository's commits *is* this
 * repository's service, so no tier mapping has to be threaded through to read it.
 *
 * A commit stays listed by every release made while it is still deployed, so the lowest version
 * that names it is the one that shipped it — the release a person means by "when did this go
 * live". A roll back put back what an earlier release shipped: it names the commits it brought
 * back — those the release just before it did not list for their service — and no other (e2e
 * 2026-10-03: after B rolled back to v0.1.0, History named 30f75f9 v0.1.0 alone). A release HQ
 * refused never went live, and names nothing. Oldest first.
 */
export function releaseTagsByCommit(
  releases: ReadonlyArray<Pick<FlowRelease, "tag" | "entries" | "verdict">>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const byCommit = new Map<string, Array<string>>();
  const oldestFirst = releases
    .filter((release) => release.verdict !== "refused")
    .sort((left, right) => compareReleaseTags(left.tag, right.tag));
  oldestFirst.forEach((release, index) => {
    const previous = oldestFirst[index - 1];
    const back = rolledBackTo(release, oldestFirst) !== undefined;
    for (const entry of release.entries) {
      const named = byCommit.get(entry.commit);
      if (named === undefined) {
        byCommit.set(entry.commit, [release.tag]);
        continue;
      }
      const before = previous?.entries.find(({ service }) => service === entry.service)?.commit;
      if (back && before !== entry.commit) named.push(release.tag);
    }
  });
  return byCommit;
}
