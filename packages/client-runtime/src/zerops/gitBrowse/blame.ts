/**
 * `blame`: which commit last changed each line of a file at a commit
 * (`@t3tools/shared/hqGitBrowse/blame`). Pinned to its commit, it is read once while held.
 *
 * @module zerops/gitBrowse/blame
 */
import {
  BLAME_MAX_BYTES,
  GitBlame,
  GitBlameQuery,
  type GitBlameCommit,
} from "@t3tools/shared/hqGitBrowse/blame";
import type { GitBlob } from "@t3tools/shared/hqGitBrowse/blob";
import { fileShape } from "./blob.ts";

export const blameRead = { query: GitBlameQuery, value: GitBlame, moving: false } as const;

/** Why a file has no blame: blame reads text files up to 256 KiB. */
export type NoBlame = "too-large" | "not-text";

export const noBlame = (blob: GitBlob): NoBlame | null => {
  if (blob.size > BLAME_MAX_BYTES) return "too-large";
  return fileShape(blob).kind === "text" ? null : "not-text";
};

/** Shades of age, newest first: the file's newest commit 0, its oldest {@link BLAME_AGES}` - 1`. */
export const BLAME_AGES = 5;

/**
 * Each commit's shade of age, by where its author time falls between the file's newest and oldest
 * commit; one commit, or commits all made at once, are all newest.
 */
export const blameAges = (
  commits: ReadonlyArray<Pick<GitBlameCommit, "sha" | "authoredAt">>,
): ReadonlyMap<string, number> => {
  const times = commits.map((commit) => Date.parse(commit.authoredAt));
  const newest = Math.max(...times);
  const span = newest - Math.min(...times);
  return new Map(
    commits.map((commit, i) => [
      commit.sha,
      span > 0
        ? Math.min(BLAME_AGES - 1, Math.floor(((newest - times[i]!) / span) * BLAME_AGES))
        : 0,
    ]),
  );
};
