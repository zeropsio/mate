/**
 * `paths?sha=`: every file path at a commit, for the file finder to match a typed name against.
 * The first {@link PATHS_LIMIT}; past them the answer says the finder sees only those.
 *
 * @module hqGitBrowse/paths
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";

/** Paths an answer holds at most. */
export const PATHS_LIMIT = 25_000;

export const GitPathsQuery = Schema.Struct({ sha: Sha });
export type GitPathsQuery = typeof GitPathsQuery.Type;

export const GitPaths = Schema.Struct({
  paths: Schema.Array(Schema.String),
  /** More files than {@link PATHS_LIMIT}: the answer holds the first ones. */
  truncated: Schema.Boolean,
});
export type GitPaths = typeof GitPaths.Type;
