/**
 * `refs?kind=&q=&cursor=&limit=`: a repository's branches or tags, a page at a time — `main`
 * first, then the newest commit first, filtered before paging.
 *
 * @module hqGitBrowse/refs
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { GitRefKind } from "./common.ts";

/** Rows a page holds at most. */
export const REFS_PAGE_LIMIT = 100;
/** Characters a filter holds at most. */
export const REFS_QUERY_MAX = 200;

export const GitRefsQuery = Schema.Struct({
  kind: Schema.Literals(["branch", "tag"]),
  q: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(REFS_QUERY_MAX))),
  cursor: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2048))),
  limit: Schema.optionalKey(
    Schema.FiniteFromString.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(REFS_PAGE_LIMIT),
    ),
  ),
});
export type GitRefsQuery = typeof GitRefsQuery.Type;

export const GitRefItem = Schema.Struct({
  name: Schema.String,
  ref: Schema.String,
  sha: Sha,
  kind: GitRefKind,
  committedAt: Schema.String,
  subject: Schema.String,
  /** A change's branch, `mate/<mateId>/<number>`. */
  change: Schema.optionalKey(Schema.Struct({ mateId: Schema.String, number: Schema.Int })),
  /** Followed from GitHub, never written by Mate. */
  outsideMate: Schema.Boolean,
});
export type GitRefItem = typeof GitRefItem.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const GitRefs = Schema.Union([
  Schema.Struct({
    items: Schema.Array(GitRefItem),
    next: Schema.NullOr(Schema.String),
    total: Count,
  }),
  Schema.Struct({
    items: Schema.Array(GitRefItem),
    next: Schema.NullOr(Schema.String),
    /** More refs than one answer reads: at least this many match. */
    totalAtLeast: Count,
  }),
]);
export type GitRefs = typeof GitRefs.Type;
