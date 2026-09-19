/**
 * A group's history, as one list of commits with what happened to each.
 *
 * The menu draws a project as a timeline of where work *is*; this is the same
 * timeline over *time*, and it is assembled rather than fetched: Gitea answers
 * three separate questions and none of them is "what happened here".
 *
 * - **`listCommits` on the group's default branch** — the spine. `compareCommits`
 *   cannot answer it: it takes two refs and reports what one has that the other
 *   does not, which is the right question for a release and the wrong one here.
 * - **What each environment runs** — the sha in the deployed version's name,
 *   read from Zerops (`groupDeploys.ts`), so a commit knows it is live.
 * - **The release tags** — `listTags` on the group repo, so a commit knows it
 *   was shipped and under what name.
 *
 * A commit nobody deployed and nothing tagged is still a commit, and still a
 * row: the history is the branch's, not the deployments'. That is why this
 * folds annotations *onto* commits instead of interleaving three kinds of
 * event — the interleaved version has to invent an order for a deploy and a
 * tag that share a timestamp, and the answer it invents is arbitrary.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupHistory
 */

import type { GiteaCommit, GiteaTag } from "./giteaClient.ts";
import { shortCommit } from "./groupRows.ts";
import { isReleaseTag, readReleaseMessage, readSemver } from "./release.ts";

/** One commit on the branch, and what reached it. */
export interface HistoryEntry {
  readonly sha: string;
  /** The seven characters a person actually reads. */
  readonly shortSha: string;
  readonly subject: string;
  /** Who Gitea says wrote it — a Mate's squash merge carries its bot. */
  readonly author: string | undefined;
  readonly at: string | undefined;
  /**
   * The environments running this exact commit, in the order they were given —
   * which is the file's order, stage before production (`groupDeploys.ts`).
   */
  readonly deployedTo: ReadonlyArray<string>;
  /** The release that shipped it, where one has — at most one, and its name. */
  readonly tags: ReadonlyArray<string>;
}

/**
 * The branch's commits with every deploy and tag folded onto the one they
 * name.
 *
 * Only a full sha matches. A short sha never compares equal to a long one, and
 * a version somebody deployed by hand is named whatever they typed — neither
 * is a commit this branch can be said to carry, so neither annotates a row.
 */
export function groupHistory(input: {
  readonly commits: ReadonlyArray<GiteaCommit>;
  /** `environment name → the full sha it runs`. */
  readonly deployed: ReadonlyMap<string, string>;
  /** `full sha → the release that shipped it` ({@link releaseTagsByCommit}). */
  readonly tags: ReadonlyMap<string, string>;
}): ReadonlyArray<HistoryEntry> {
  const deployedBySha = new Map<string, Array<string>>();
  for (const [environment, sha] of input.deployed) {
    const at = deployedBySha.get(sha);
    if (at === undefined) deployedBySha.set(sha, [environment]);
    else at.push(environment);
  }
  return input.commits.map((commit) => ({
    sha: commit.sha,
    shortSha: shortCommit(commit.sha),
    subject: commit.subject,
    author: commit.author,
    at: commit.at,
    deployedTo: deployedBySha.get(commit.sha) ?? [],
    tags: (() => {
      const tag = input.tags.get(commit.sha);
      return tag === undefined ? [] : [tag];
    })(),
  }));
}

/**
 * The one line under a commit's subject: who wrote it and what it is running
 * on, never a repetition of the subject above it.
 *
 * `undefined` where neither is known — a row with an empty second line is a
 * row that moved everything below it for nothing.
 */
export function historyLine(entry: HistoryEntry, now?: number): string | undefined {
  const parts = [entry.author, ...entry.deployedTo].filter(
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
 * clock, which Gitea happily stores) reads as `now` rather than as a negative.
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
 * `sha → the release that first put it in front of people`, for any repository.
 *
 * A release tag lives on the group repository and lists every service's commit
 * in its message, so it cannot be matched to a service's history by the tag's
 * own target. It does not have to be: the message carries whole shas, and a
 * sha is unique across every repository in the org. A sha in the message that
 * also appears in this repository's commits *is* this repository's service, so
 * the hostname the entry names is not needed and no tier mapping has to be
 * threaded through to read it.
 *
 * A commit stays listed by every release made while it is still deployed, so
 * the lowest version that names it is the one that shipped it — that is the
 * release a person means by "when did this go live". Tags may arrive in any
 * order; anything that is not a `v{semver}` release of ours is ignored, as is
 * a message this build cannot read (`readReleaseMessage`).
 */
export function releaseTagsByCommit(tags: ReadonlyArray<GiteaTag>): ReadonlyMap<string, string> {
  const releases = tags
    .filter((tag) => isReleaseTag(tag.name))
    .map((tag) => ({ tag, semver: readSemver(tag.name) }))
    .filter(
      (entry): entry is { tag: GiteaTag; semver: NonNullable<typeof entry.semver> } =>
        entry.semver !== undefined,
    )
    .sort(
      (left, right) =>
        left.semver.major - right.semver.major ||
        left.semver.minor - right.semver.minor ||
        left.semver.patch - right.semver.patch,
    );
  const byCommit = new Map<string, string>();
  for (const { tag } of releases) {
    for (const entry of readReleaseMessage(tag.message ?? "")) {
      if (!byCommit.has(entry.commit)) byCommit.set(entry.commit, tag.name);
    }
  }
  return byCommit;
}
