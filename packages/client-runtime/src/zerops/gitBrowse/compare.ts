/**
 * `compare` and `compare-file`: what one branch, tag or commit adds since it left another, and one
 * file's hunks the page left for later (`@t3tools/shared/hqGitBrowse/compare`). The compare moves
 * with both refs: read again on an explicit ask or a new pick, never on a timer. A file's hunks
 * are pinned to the answered commits: never read again while held.
 *
 * @module zerops/gitBrowse/compare
 */
import { GitCommitFileHunks } from "@t3tools/shared/hqGitBrowse/commit";
import {
  COMPARE_COMMITS_LIMIT,
  GitCompare,
  GitCompareFileQuery,
  GitCompareQuery,
} from "@t3tools/shared/hqGitBrowse/compare";

export const compareRead = { query: GitCompareQuery, value: GitCompare, moving: true } as const;
export const compareFileRead = {
  query: GitCompareFileQuery,
  value: GitCommitFileHunks,
  moving: false,
} as const;

/** A side as a person reads it: a branch's or tag's name, or `Commit abc1234`. */
const nameOf = (side: GitCompare["base"]) =>
  side.ref.kind === "commit" ? `Commit ${side.sha.slice(0, 7)}` : side.ref.name;

/** What a compare says above its commits, and whether there is anything below it. */
export const compareSummary = (
  compare: GitCompare,
): {
  readonly headline: string;
  /** No commit to list and no file to diff. */
  readonly nothing: boolean;
  /** The commits listed are fewer than the total. */
  readonly cut: string | null;
} => {
  const base = nameOf(compare.base);
  const head = nameOf(compare.head);
  const nothing = (headline: string) => ({
    headline: `There is nothing to compare: ${headline}`,
    nothing: true,
    cut: null,
  });
  if (compare.mergeBase === null) return nothing(`${head} and ${base} share no commit.`);
  if (compare.base.sha === compare.head.sha)
    return nothing(`${base} and ${head} are the same commit.`);
  if (compare.totalCommits === 0) return nothing(`${base} already holds every commit of ${head}.`);
  const n = compare.totalCommits;
  return {
    headline: `${head} adds ${n} ${n === 1 ? "commit" : "commits"} since it left ${base}`,
    nothing: false,
    cut:
      compare.commits.length < n
        ? `Showing the newest ${Math.min(compare.commits.length, COMPARE_COMMITS_LIMIT)} of ${n} commits.`
        : null,
  };
};
