/**
 * `tree?sha=&path=`: a folder of a commit — folders first, then files, each by name, at most
 * {@link TREE_MAX_ENTRIES} of them.
 *
 * @module hqGitBrowse/tree
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { GitPath } from "./common.ts";

/** Entries a folder lists at most; past them it says it stops. */
export const TREE_MAX_ENTRIES = 1000;

export const GitTreeQuery = Schema.Struct({ sha: Sha, path: GitPath });
export type GitTreeQuery = typeof GitTreeQuery.Type;

export const GitTreeEntryType = Schema.Literals(["file", "folder", "symlink", "submodule"]);
export type GitTreeEntryType = typeof GitTreeEntryType.Type;

export const GitTreeEntry = Schema.Struct({
  name: Schema.String,
  /** From the commit's top folder. */
  path: Schema.String,
  type: GitTreeEntryType,
  mode: Schema.String,
  /** The entry's object: a file's or folder's content, a submodule's commit. */
  sha: Sha,
  /** A file's or symbolic link's bytes; none for a folder or submodule. */
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type GitTreeEntry = typeof GitTreeEntry.Type;

export const GitTree = Schema.Struct({
  entries: Schema.Array(GitTreeEntry),
  truncated: Schema.Boolean,
});
export type GitTree = typeof GitTree.Type;
