/**
 * What a person's Git browser reads of a repository, beside the layer's own operations: each read
 * one module of this folder, each run inside the held repository (`repoReader`), each stopped
 * with its process group when its caller's signal ends.
 *
 * @module browse/service
 */
import type * as Effect from "effect/Effect";
import type { GitError, Repo } from "../api.ts";
import type { GitRunner } from "../git.ts";
import type { InRepo } from "../operations.ts";
import { listLog, type LogPage, type LogRequest } from "./log.ts";
import { grepAt, type GrepLimits, type GrepRequest, type GrepResult } from "./grep.ts";
import { listPaths, type PathList } from "./paths.ts";
import { findReadme, type Readme } from "./readme.ts";
import { countRefs, listRefs, type RefCounts, type RefsPage, type RefsRequest } from "./refs.ts";
import { resolveRevision, type Resolved } from "./resolve.ts";

export type { LogItem, LogPage, LogRequest } from "./log.ts";
export type { GrepLimits, GrepMatch, GrepRequest, GrepResult } from "./grep.ts";
export type { PathList } from "./paths.ts";
export type { Readme } from "./readme.ts";
export type { RefCounts, RefItem, RefsPage, RefsRequest } from "./refs.ts";
export type { RefKind, Resolved } from "./resolve.ts";

export interface HqGitBrowse {
  /**
   * The commit `rev` names, and the ref it is: a branch, `refs/heads/x`, `refs/tags/x`,
   * `refs/github/{heads,tags}/x`, or a 7-40 hex commit. A bare name is looked up in that order;
   * absent, `main`.
   */
  readonly resolve: (repo: Repo, rev: string | undefined) => Effect.Effect<Resolved, GitError>;
  readonly refs: (repo: Repo, request: RefsRequest) => Effect.Effect<RefsPage, GitError>;
  readonly refCounts: (repo: Repo) => Effect.Effect<RefCounts, GitError>;
  /** The README at a commit, its first `maxBytes`; none where the repository has none there. */
  readonly readme: (
    repo: Repo,
    sha: string,
    maxBytes: number,
  ) => Effect.Effect<Readme | null, GitError>;
  /** A page of the commits reachable from `sha`, or of those that touched a path; none where the commit is absent. */
  readonly log: (repo: Repo, request: LogRequest) => Effect.Effect<LogPage | null, GitError>;
  /** Every file path at a commit, the first `max`; none where the repository has no such commit. */
  readonly paths: (
    repo: Repo,
    sha: string,
    max: number,
  ) => Effect.Effect<PathList | null, GitError>;
  /**
   * The lines at a commit's text files that match, within `limits`; at `until`'s abort, what it
   * found until then.
   */
  readonly grep: (
    repo: Repo,
    sha: string,
    request: GrepRequest,
    limits: GrepLimits,
    until: AbortSignal,
  ) => Effect.Effect<GrepResult, GitError>;
}

export const makeHqGitBrowse = (git: GitRunner, inRepo: InRepo): HqGitBrowse => ({
  resolve: (repo, rev) =>
    inRepo("browse.resolve", repo, (dir, signal) => resolveRevision(git, dir, rev, signal)),
  refs: (repo, request) =>
    inRepo("browse.refs", repo, (dir, signal) => listRefs(git, dir, request, signal)),
  refCounts: (repo) =>
    inRepo("browse.refCounts", repo, (dir, signal) => countRefs(git, dir, signal)),
  readme: (repo, sha, maxBytes) =>
    inRepo("browse.readme", repo, (dir, signal) => findReadme(git, dir, sha, maxBytes, signal)),
  log: (repo, request) =>
    inRepo("browse.log", repo, (dir, signal) => listLog(git, dir, request, signal)),
  paths: (repo, sha, max) =>
    inRepo("browse.paths", repo, (dir, signal) => listPaths(git, dir, sha, max, signal)),
  grep: (repo, sha, request, limits, until) =>
    inRepo("browse.grep", repo, (dir, signal) =>
      grepAt(git, dir, sha, request, limits, signal, until),
    ),
});
