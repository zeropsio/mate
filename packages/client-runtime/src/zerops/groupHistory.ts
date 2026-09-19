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

import type { GiteaCommit } from "./giteaClient.ts";
import { shortCommit } from "./groupRows.ts";

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
  /** Release tags pointing at it, newest first as they were given. */
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
  /** `tag name → the full sha it points at`. */
  readonly tags: ReadonlyMap<string, string>;
}): ReadonlyArray<HistoryEntry> {
  const deployedBySha = new Map<string, Array<string>>();
  for (const [environment, sha] of input.deployed) {
    const at = deployedBySha.get(sha);
    if (at === undefined) deployedBySha.set(sha, [environment]);
    else at.push(environment);
  }
  const tagsBySha = new Map<string, Array<string>>();
  for (const [tag, sha] of input.tags) {
    const at = tagsBySha.get(sha);
    if (at === undefined) tagsBySha.set(sha, [tag]);
    else at.push(tag);
  }
  return input.commits.map((commit) => ({
    sha: commit.sha,
    shortSha: shortCommit(commit.sha),
    subject: commit.subject,
    author: commit.author,
    at: commit.at,
    deployedTo: deployedBySha.get(commit.sha) ?? [],
    tags: tagsBySha.get(commit.sha) ?? [],
  }));
}

/**
 * The one line under a commit's subject: who wrote it and what it is running
 * on, never a repetition of the subject above it.
 *
 * `undefined` where neither is known — a row with an empty second line is a
 * row that moved everything below it for nothing.
 */
export function historyLine(entry: HistoryEntry): string | undefined {
  const parts = [entry.author, ...entry.deployedTo].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length === 0 ? undefined : parts.join(" · ");
}
