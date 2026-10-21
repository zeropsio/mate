/**
 * What every Git browse read shares on the wire (`GET /api/apps/:appId/repos/:repo/browse/<read>`):
 * one file per read beside this one, each a query whose encoded side is a URL's search parameters
 * and an answer.
 *
 * @module hqGitBrowse/common
 */
import * as Schema from "effect/Schema";

/** What a person reads a ref as; `commit` where the page names a commit, not a ref. */
export const GitRefKind = Schema.Literals([
  "branch",
  "tag",
  "change",
  "github-branch",
  "github-tag",
  "commit",
]);
export type GitRefKind = typeof GitRefKind.Type;

export const GitRef = Schema.Struct({ name: Schema.String, kind: GitRefKind });
export type GitRef = typeof GitRef.Type;

/**
 * A moving revision only `home` and `refs` accept: a branch, `refs/heads/x`, `refs/tags/x`,
 * `refs/github/{heads,tags}/x`, or a 7-40 hex commit. Every other read takes the commit it answered.
 */
export const GitRevision = Schema.String.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((rev: string) =>
    rev === "" || rev.startsWith("-") || rev.includes("\0")
      ? "Expected a branch, tag or commit"
      : undefined,
  ),
);
