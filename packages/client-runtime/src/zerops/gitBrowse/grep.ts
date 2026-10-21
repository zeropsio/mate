/**
 * `grep`: the lines at a commit that hold a text (`@t3tools/shared/hqGitBrowse/grep`). Pinned to
 * its commit: read again only on the person's ask, as when HQ was busy or the search stopped.
 *
 * @module zerops/gitBrowse/grep
 */
import { GitGrep, GitGrepQuery, type GitGrepMatch } from "@t3tools/shared/hqGitBrowse/grep";

export const grepRead = { query: GitGrepQuery, value: GitGrep, moving: false } as const;

export interface GrepFile {
  readonly path: string;
  readonly matches: ReadonlyArray<GitGrepMatch>;
}

/** Matches grouped per file, files and lines in HQ's order. */
export const grepFiles = (matches: ReadonlyArray<GitGrepMatch>): ReadonlyArray<GrepFile> => {
  const files = new Map<string, GitGrepMatch[]>();
  for (const match of matches) {
    const file = files.get(match.path);
    if (file === undefined) files.set(match.path, [match]);
    else file.push(match);
  }
  return [...files].map(([path, grouped]) => ({ path, matches: grouped }));
};
