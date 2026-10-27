/**
 * `paths`: every file path at a commit, the file finder's list (`@t3tools/shared/hqGitBrowse/paths`).
 * Pinned to its commit: never read again while held.
 *
 * @module zerops/gitBrowse/paths
 */
import { GitPaths, GitPathsQuery } from "@t3tools/shared/hqGitBrowse/paths";

export const pathsRead = { query: GitPathsQuery, value: GitPaths, moving: false } as const;
