/**
 * `commit` and `commit-file`: a commit's page and one file's hunks it left for later
 * (`@t3tools/shared/hqGitBrowse/commit`). Both are pinned to the commit: never read again while
 * held.
 *
 * @module zerops/gitBrowse/commit
 */
import {
  GitCommit,
  GitCommitFileHunks,
  GitCommitFileQuery,
  GitCommitQuery,
} from "@t3tools/shared/hqGitBrowse/commit";

export const commitRead = { query: GitCommitQuery, value: GitCommit, moving: false } as const;
export const commitFileRead = {
  query: GitCommitFileQuery,
  value: GitCommitFileHunks,
  moving: false,
} as const;

const FOLDED_NAMES = new Set(["yarn.lock", "pnpm-lock.yaml", "package-lock.json"]);

/** A lockfile or a minified file: its diff starts folded, nobody reads it line by line. */
export const startsFolded = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return FOLDED_NAMES.has(name) || /\.min\.[^.]+$/u.test(name);
};
