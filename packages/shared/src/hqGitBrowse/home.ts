/**
 * `home?rev=`: a repository's home at the commit `rev` names now — that commit, the ref it is,
 * what the repository is beside it, and its README there.
 *
 * @module hqGitBrowse/home
 */
import * as Schema from "effect/Schema";
import { HqRepoGovernance, Sha } from "../hqChanges.ts";
import { GitRef, GitRevision } from "./common.ts";

export const GitHomeQuery = Schema.Struct({
  rev: Schema.optionalKey(GitRevision),
  content: Schema.optionalKey(Schema.Literals(["metadata", "revision"])),
});
export type GitHomeQuery = typeof GitHomeQuery.Type;

/** README bytes a home shows; past them it says the README is cut. */
export const README_MAX_BYTES = 256 * 1024;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const GitHomeAbout = Schema.Struct({
  /** The GitHub repository it is mounted from; none for a repository Mate's git alone holds. */
  remote: Schema.NullOr(Schema.Struct({ url: Schema.String, provider: Schema.Literal("github") })),
  /** How HQ last followed GitHub; none for a repository it does not follow. */
  mirror: Schema.NullOr(
    Schema.Struct({
      syncedAt: Schema.NullOr(Schema.String),
      divergedSince: Schema.NullOr(Schema.String),
      governance: Schema.NullOr(HqRepoGovernance),
    }),
  ),
  /** When `main` last moved; the repository's making before it ever has. */
  updatedAt: Schema.String,
  branchCount: Count,
  tagCount: Count,
  /** HQ's catalog accounting, including history; absent from older metadata answers. */
  storage: Schema.optionalKey(
    Schema.Struct({
      usedBytes: Schema.NullOr(Count),
      limitBytes: Count,
      large: Schema.NullOr(Schema.Boolean),
      routeBodyLimitBytes: Schema.NullOr(Count),
    }),
  ),
});
export type GitHomeAbout = typeof GitHomeAbout.Type;

export const GitReadme = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  truncated: Schema.Boolean,
});
export type GitReadme = typeof GitReadme.Type;

export const GitHome = Schema.Struct({
  /** None while `main` has no commits yet. */
  sha: Schema.NullOr(Sha),
  ref: GitRef,
  about: GitHomeAbout,
  readme: Schema.NullOr(GitReadme),
  pending: Schema.optionalKey(Schema.Boolean),
});
export type GitHome = typeof GitHome.Type;
