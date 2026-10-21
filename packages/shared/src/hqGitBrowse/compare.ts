/**
 * `compare?base=&head=`: what `head` adds since it left `base` (three dots) — the commits it adds,
 * newest first, the first 100 and how many in all, and what changed from where the two split, each
 * file's hunks while the page's budget lasts. Both refs move, so the answer names the commits they
 * named and is never cached. `compare-file?base=&head=&path=`: one file's hunks from the answered
 * merge base to the answered head, read on request; pinned, so it never changes.
 *
 * @module hqGitBrowse/compare
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { GitCommitFile, GitCommitFileQuery } from "./commit.ts";
import { GitRef, GitRevision } from "./common.ts";
import { GitLogItem } from "./log.ts";

/** Commits a compare lists at most. */
export const COMPARE_COMMITS_LIMIT = 100;

export const GitCompareQuery = Schema.Struct({ base: GitRevision, head: GitRevision });
export type GitCompareQuery = typeof GitCompareQuery.Type;

export const GitCompareFileQuery = Schema.Struct({
  base: Sha,
  head: Sha,
  path: GitCommitFileQuery.fields.path,
});
export type GitCompareFileQuery = typeof GitCompareFileQuery.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Named = Schema.Struct({ sha: Sha, ref: GitRef });

export const GitCompare = Schema.Struct({
  /** The commit each side named when it was read. */
  base: Named,
  head: Named,
  /** Where `head` left `base`; none where the two histories never met. */
  mergeBase: Schema.NullOr(Sha),
  /** What `head` adds, newest first: the first {@link COMPARE_COMMITS_LIMIT}. */
  commits: Schema.Array(GitLogItem),
  totalCommits: Count,
  files: Schema.Array(GitCommitFile),
  totalFiles: Count,
  filesTruncated: Schema.Boolean,
});
export type GitCompare = typeof GitCompare.Type;
