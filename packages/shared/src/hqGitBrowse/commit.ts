/**
 * `commit?sha=`: a commit's message, people and what it changed against its first parent, each
 * file's hunks while the page's budget lasts; `commit-file?sha=&path=`: one file's hunks, read
 * on request. Both are pinned to the commit, so neither ever changes.
 *
 * @module hqGitBrowse/commit
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";

export const GitCommitQuery = Schema.Struct({ sha: Sha });
export type GitCommitQuery = typeof GitCommitQuery.Type;

export const GitCommitFileQuery = Schema.Struct({
  sha: Sha,
  path: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(4096),
    Schema.makeFilter((path: string) => (path.includes("\0") ? "Expected a path" : undefined)),
  ),
});
export type GitCommitFileQuery = typeof GitCommitFileQuery.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const GitCommitFile = Schema.Struct({
  path: Schema.String,
  status: Schema.Literals(["added", "modified", "deleted"]),
  additions: Count,
  deletions: Count,
  binary: Schema.Boolean,
  /** The file's patch as git wrote it; none for a binary file or one not read with the page. */
  hunks: Schema.NullOr(Schema.String),
  /** Its hunks were left for later: `commit-file` reads them. Otherwise none is too long to show. */
  loadable: Schema.Boolean,
});
export type GitCommitFile = typeof GitCommitFile.Type;

export const GitCommit = Schema.Struct({
  sha: Sha,
  parents: Schema.Array(Sha),
  subject: Schema.String,
  body: Schema.String,
  /** The message was longer than a page reads: its end is not here. */
  messageCut: Schema.Boolean,
  authorName: Schema.String,
  authoredAt: Schema.String,
  committerName: Schema.String,
  committedAt: Schema.String,
  /** The change merged as this commit. */
  change: Schema.optionalKey(Schema.Struct({ mateId: Schema.String, number: Schema.Int })),
  files: Schema.Array(GitCommitFile),
  totalFiles: Count,
  filesTruncated: Schema.Boolean,
});
export type GitCommit = typeof GitCommit.Type;

/** One file's hunks; none where they are too long to read here. */
export const GitCommitFileHunks = Schema.Struct({ hunks: Schema.NullOr(Schema.String) });
export type GitCommitFileHunks = typeof GitCommitFileHunks.Type;
