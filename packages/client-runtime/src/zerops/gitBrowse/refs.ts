/**
 * `refs`: a repository's branches or tags, a page at a time (`@t3tools/shared/hqGitBrowse/refs`).
 * Refs move: a page is read again on an explicit ask or a new visit, never on a timer.
 *
 * @module zerops/gitBrowse/refs
 */
import { GitRefs, GitRefsQuery, type GitRefItem } from "@t3tools/shared/hqGitBrowse/refs";

export const refsRead = { query: GitRefsQuery, value: GitRefs, moving: true } as const;

/**
 * What a page's link names to open a ref: a Mate branch by its name, as a bare name finds it
 * first; every other ref by its full name, so a GitHub branch called `main` opens GitHub's.
 */
export const refRevision = (item: Pick<GitRefItem, "kind" | "name" | "ref">) =>
  item.kind === "branch" || item.kind === "change" ? item.name : item.ref;
