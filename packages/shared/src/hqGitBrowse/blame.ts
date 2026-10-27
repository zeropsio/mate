/**
 * `blame?sha=&path=`: which commit last changed each line of a file at a commit, as runs of lines
 * (`ranges`, in line order) and the commits they name (`commits`, each once). Only files up to
 * {@link BLAME_MAX_BYTES} are read; past it HQ refuses `too_large`. Pinned to the commit, so it
 * never changes.
 *
 * @module hqGitBrowse/blame
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { FilePath, SOURCE_FILE_MAX_BYTES } from "./common.ts";

/** The largest file blame reads: the most of a file the browser shows. */
export const BLAME_MAX_BYTES = SOURCE_FILE_MAX_BYTES;

export const GitBlameQuery = Schema.Struct({ sha: Sha, path: FilePath });
export type GitBlameQuery = typeof GitBlameQuery.Type;

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** Lines `start` to `start + count - 1` (from 1), last changed by `commit`. */
export const GitBlameRange = Schema.Struct({ start: Line, count: Line, commit: Sha });
export type GitBlameRange = typeof GitBlameRange.Type;

export const GitBlameCommit = Schema.Struct({
  sha: Sha,
  subject: Schema.String,
  authorName: Schema.String,
  authoredAt: Schema.String,
  /**
   * The file as the commit's parent had it, where blame goes on before the commit: its path
   * there may differ. None for a commit that added the file.
   */
  previous: Schema.optionalKey(Schema.Struct({ sha: Sha, path: Schema.String })),
  /** The change merged as this commit. */
  change: Schema.optionalKey(Schema.Struct({ mateId: Schema.String, number: Schema.Int })),
});
export type GitBlameCommit = typeof GitBlameCommit.Type;

export const GitBlame = Schema.Struct({
  ranges: Schema.Array(GitBlameRange),
  commits: Schema.Array(GitBlameCommit),
});
export type GitBlame = typeof GitBlame.Type;
