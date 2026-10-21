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
import { readCommit, readCommitFile, type CommitRead } from "./commit.ts";
import { listLog, type LogPage, type LogRequest } from "./log.ts";
import { findReadme, type Readme } from "./readme.ts";
import { countRefs, listRefs, type RefCounts, type RefsPage, type RefsRequest } from "./refs.ts";
import { resolveRevision, type Resolved } from "./resolve.ts";

export type { LogItem, LogPage, LogRequest } from "./log.ts";
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
  /** A commit and what it changed against its first parent; none where there is no such commit. */
  readonly commit: (repo: Repo, sha: string) => Effect.Effect<CommitRead | null, GitError>;
  /** One file's hunks in a commit, read on request; none where there is no such commit. */
  readonly commitFile: (
    repo: Repo,
    sha: string,
    path: string,
  ) => Effect.Effect<{ readonly hunks: string | null } | null, GitError>;
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
  commit: (repo, sha) =>
    inRepo("browse.commit", repo, (dir, signal) => readCommit(git, dir, sha, signal)),
  commitFile: (repo, sha, path) =>
    inRepo("browse.commitFile", repo, (dir, signal) => readCommitFile(git, dir, sha, path, signal)),
});
