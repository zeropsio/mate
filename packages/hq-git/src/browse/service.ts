// @effect-diagnostics nodeBuiltinImport:off - an archive streams from git as a Node stream.
/**
 * What a person's Git browser reads of a repository, beside the layer's own operations: each read
 * one module of this folder, each run inside the held repository (`repoReader`), each stopped
 * with its process group when its caller's signal ends.
 *
 * @module browse/service
 */
import type * as NodeStream from "node:stream";
import type * as Effect from "effect/Effect";
import type { GitError, Repo } from "../api.ts";
import type { GitRunner } from "../git.ts";
import type { InRepo } from "../operations.ts";
import { readBlame, type BlameRead } from "./blame.ts";
import { archiveAt, type ArchiveFormat } from "./archive.ts";
import { readCommit, readCommitFile, type CommitRead } from "./commit.ts";
import { readCompare, readCompareFile, type CompareRead } from "./compare.ts";
import { listLog, type LogPage, type LogRequest } from "./log.ts";
import { readBlob, type BlobRead } from "./blob.ts";
import { grepAt, type GrepLimits, type GrepRequest, type GrepResult } from "./grep.ts";
import { listPaths, type PathList } from "./paths.ts";
import { findReadme, type Readme } from "./readme.ts";
import { countRefs, listRefs, type RefCounts, type RefsPage, type RefsRequest } from "./refs.ts";
import { resolveRevision, type Resolved } from "./resolve.ts";
import { listTree, type TreeRead } from "./tree.ts";

export type { BlameCommit, BlameRange, BlameRead } from "./blame.ts";
export type { ArchiveFormat } from "./archive.ts";
export type { CompareRead } from "./compare.ts";
export type { LogItem, LogPage, LogRequest } from "./log.ts";
export type { BlobRead } from "./blob.ts";
export type { GrepLimits, GrepMatch, GrepRequest, GrepResult } from "./grep.ts";
export type { PathList } from "./paths.ts";
export type { Readme } from "./readme.ts";
export type { RefCounts, RefItem, RefsPage, RefsRequest } from "./refs.ts";
export type { RefKind, Resolved } from "./resolve.ts";
export type { FolderEntry, FolderEntryType, TreeRead } from "./tree.ts";

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
  /** A folder of a commit: folders first, then files, each by name; at most 1,000 entries. */
  readonly tree: (repo: Repo, sha: string, path: string) => Effect.Effect<TreeRead, GitError>;
  /**
   * A file of a commit, its first `maxBytes`; none of it past `refuseOver`, only its size.
   */
  readonly blob: (
    repo: Repo,
    sha: string,
    path: string,
    options: { readonly maxBytes: number; readonly refuseOver?: number },
  ) => Effect.Effect<BlobRead, GitError>;
  /** A commit and what it changed against its first parent; none where there is no such commit. */
  readonly commit: (repo: Repo, sha: string) => Effect.Effect<CommitRead | null, GitError>;
  /** One file's hunks in a commit, read on request; none where there is no such commit. */
  readonly commitFile: (
    repo: Repo,
    sha: string,
    path: string,
  ) => Effect.Effect<{ readonly hunks: string | null } | null, GitError>;
  /** What `head` adds since it left `base`; none where either commit is absent. */
  readonly compare: (
    repo: Repo,
    base: string,
    head: string,
  ) => Effect.Effect<CompareRead | null, GitError>;
  /** One file's hunks from a compare's merge base to its head, read on request. */
  readonly compareFile: (
    repo: Repo,
    base: string,
    head: string,
    path: string,
  ) => Effect.Effect<{ readonly hunks: string | null } | null, GitError>;
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
  /** Which commit last changed each line of a file at a commit; none past `maxBytes`, only its size. */
  readonly blame: (
    repo: Repo,
    sha: string,
    path: string,
    maxBytes: number,
  ) => Effect.Effect<BlameRead, GitError>;
  /**
   * A commit's files as one archive, streamed; its git runs until the stream ends or is let go.
   * None where the repository has no such commit.
   */
  readonly archive: (
    repo: Repo,
    sha: string,
    format: ArchiveFormat,
  ) => Effect.Effect<NodeStream.Readable | null, GitError>;
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
  tree: (repo, sha, path) =>
    inRepo("browse.tree", repo, (dir, signal) => listTree(git, dir, sha, path, signal)),
  blob: (repo, sha, path, options) =>
    inRepo("browse.blob", repo, (dir, signal) => readBlob(git, dir, sha, path, options, signal)),
  commit: (repo, sha) =>
    inRepo("browse.commit", repo, (dir, signal) => readCommit(git, dir, sha, signal)),
  commitFile: (repo, sha, path) =>
    inRepo("browse.commitFile", repo, (dir, signal) => readCommitFile(git, dir, sha, path, signal)),
  compare: (repo, base, head) =>
    inRepo("browse.compare", repo, (dir, signal) => readCompare(git, dir, base, head, signal)),
  compareFile: (repo, base, head, path) =>
    inRepo("browse.compareFile", repo, (dir, signal) =>
      readCompareFile(git, dir, base, head, path, signal),
    ),
  paths: (repo, sha, max) =>
    inRepo("browse.paths", repo, (dir, signal) => listPaths(git, dir, sha, max, signal)),
  grep: (repo, sha, request, limits, until) =>
    inRepo("browse.grep", repo, (dir, signal) =>
      grepAt(git, dir, sha, request, limits, signal, until),
    ),
  blame: (repo, sha, path, maxBytes) =>
    inRepo("browse.blame", repo, (dir, signal) => readBlame(git, dir, sha, path, maxBytes, signal)),
  archive: (repo, sha, format) =>
    inRepo("browse.archive", repo, (dir, signal) => archiveAt(git, dir, sha, format, signal)),
});
