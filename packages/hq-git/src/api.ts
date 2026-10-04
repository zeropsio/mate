// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import type * as NodeHttp from "node:http";
import type * as NodeStream from "node:stream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type Principal =
  | { readonly kind: "mate"; readonly mateId: string; readonly appId: string }
  | { readonly kind: "core" }
  /** Core has checked this person's live app write permission; ref policy still applies. */
  | { readonly kind: "person"; readonly userId: string; readonly appId: string }
  | { readonly kind: "reader"; readonly userId: string };

export interface Repo {
  readonly appId: string;
  readonly id: string;
}
/** A smart HTTP service: a fetch's or a push's. */
export type GitService = "git-upload-pack" | "git-receive-pack";
/** What a request asks: its repository, its operation, and the service it is of (none: unknown). */
export interface GitTarget {
  readonly repo: Repo;
  readonly operation: "info/refs" | "git-upload-pack" | "git-receive-pack";
  readonly service: GitService | null;
}
export interface RefUpdate {
  readonly oldSha: string;
  readonly newSha: string;
  readonly ref: string;
}
export type RefDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };
/**
 * A change branch is `refs/heads/mate/<mateId>/<number>`, writable only by its mate while open.
 * Change branches are append-only: every repository keeps `receive.denyNonFastForwards`.
 */
export interface Change {
  readonly appId: string;
  readonly mateId: string;
  readonly number: number;
  /** Whether the change still accepts pushes here, i.e. it is neither merged nor closed. */
  readonly open: boolean;
  readonly merged?: boolean;
}

type Awaitable<A> = A | Promise<A>;
/** Immutable commits captured for every part of a change's review. */
export interface ChangeSnapshot {
  readonly head: string | null;
  readonly main: string | null;
}

export interface HqGitOptions {
  /** One instance per root: opening sweeps reservations and staging left by a crashed instance. */
  readonly rootDir: string;
  /**
   * Ordered delivery after the ref write. Local writes enqueue without waiting, so a handler may
   * call back into the layer. Smart HTTP acknowledges a push only after delivery completes; a
   * failed delivery fails the request. Failure is logged and never rolls back git; there is no
   * retry: Core reconciles from refs and owns the durable log.
   */
  readonly onEvent?: (event: GitEvent) => Awaitable<void>;
  /** Routes default to /git/<appId>/<id>.git; Core may choose another mount prefix. */
  readonly pathPrefix?: string;
  readonly authenticate: (request: NodeHttp.IncomingMessage) => Awaitable<Principal | null>;
  /** Core checks app membership for readers/people, and app identity for mates. Also gates pushes. */
  readonly canRead: (principal: Principal, repo: Repo) => Awaitable<boolean>;
  /** The handler always applies the built-in write rules; Core answers only for change records. */
  readonly lookupChange: (repo: Repo, mateId: string, number: number) => Promise<Change | null>;
  /**
   * Optional narrowing after the built-in rules allowed every update: one decision per update in
   * command order, and it can only refuse more. Any refusal refuses the whole push before git sees
   * it; once authorized, git applies each ref on its own, so a push is all-or-nothing only here.
   */
  readonly authorize?: (
    principal: Principal,
    repo: Repo,
    updates: ReadonlyArray<RefUpdate>,
  ) => Awaitable<ReadonlyArray<RefDecision>>;
  /** Local directories a migration may import from (absolute paths and file: URLs). */
  readonly importRoots?: ReadonlyArray<string>;
  /**
   * Host policy for https imports, given the URL's literal hostname (IPv6 without brackets); the
   * default refuses private, loopback, link-local, and internal names. Residual: no DNS check, so
   * a public name that resolves (or rebinds) to a private address is not refused here.
   */
  readonly allowImportHost?: (host: string) => boolean;
  /** Import fetch bound (default 10 min); on expiry git stops and the partial repository goes. */
  readonly importTimeoutMs?: number;
  /** Per-request deadline (default 30 min); a client that stops reading cannot hold git longer. */
  readonly requestTimeoutMs?: number;
  /**
   * How long a ref write waits for another writer's lock before it answers `busy` (default 5 s):
   * git's own 100 ms is shorter than a writer slowed by IO holds it.
   */
  readonly refLockTimeoutMs?: number;
}
export interface ImportCredentials {
  readonly username: string;
  readonly password: string;
}
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "exists",
    "invalid_id",
    "invalid_config",
    /** A write path git, a case-insensitive checkout, or the existing tree refuses. */
    "invalid_path",
    "not_found",
    "no_main",
    "source_refused",
    "timeout",
    /** A ref write found the ref locked and changed nothing; retrying is safe. */
    "busy",
    "git_failed",
    /** The host withholds the repository for now; the message says why. */
    "unavailable",
  ]),
  /** Never carries server paths, stderr, or credentials. */
  message: Schema.String,
}) {}
export type GitEvent =
  | { readonly kind: "pushed"; readonly repo: Repo; readonly updates: ReadonlyArray<RefUpdate> }
  | {
      readonly kind: "main_moved";
      readonly repo: Repo;
      readonly old: string | null;
      readonly new: string;
      readonly by: "merge" | "commit" | "push";
    }
  | { readonly kind: "tagged"; readonly repo: Repo; readonly name: string; readonly sha: string };
export interface Author {
  readonly name: string;
  readonly email: string;
}
export type Mergeability =
  | { readonly kind: "clean" }
  | { readonly kind: "conflict"; readonly paths: ReadonlyArray<string> }
  | { readonly kind: "empty" | "already_merged" | "no_change" | "unrelated" };
export interface SquashOptions {
  readonly mateId: string;
  readonly number: number;
  readonly expectedMain: string;
  /** The change head Core reviewed: a later push refuses the merge as `head_moved`. */
  readonly expectedHead: string;
  /**
   * Caller composes title and body, kept verbatim. A blank first line or git's scissors line is
   * refused; the trusted trailers and `Mate-Change` always form the last paragraph.
   */
  readonly message: string;
  /** A key with several values is written once per value, in order. */
  readonly trailers: Readonly<Record<string, string | ReadonlyArray<string>>>;
  readonly author: Author;
}
export interface SquashNames {
  readonly main: string;
  readonly head: string;
  readonly files: Bounded<{ readonly path: string; readonly status: string }>;
}
export interface TagRead {
  readonly name: string;
  readonly sha: string;
  readonly message: string;
  readonly taggedAt: string;
}
export interface CommitFilesOptions {
  /** Content or null to delete an existing file; a path git or a case-folding checkout refuses is `invalid_path`. */
  readonly files: Readonly<Record<string, string | Uint8Array | null>>;
  /** A `Mate-Change` trailer is refused: it would mark a change merged. */
  readonly message: string;
  readonly author: Author;
  /** null creates an unborn ref. Only refs/heads/* outside mate/* are Core-owned here. */
  readonly expectedHead: string | null;
}
export interface Bounded<A> {
  readonly items: ReadonlyArray<A>;
  readonly truncated: boolean;
}
export interface TreeEntry {
  readonly path: string;
  readonly sha: string;
  readonly mode: string;
  readonly type: string;
}
export interface FileRead {
  readonly content: Buffer;
  readonly binary: boolean;
  readonly truncated: boolean;
}
export interface CommitSummary {
  readonly sha: string;
  readonly message: string;
  readonly author: Author;
  readonly parents: ReadonlyArray<string>;
  /** The committer date, ISO 8601 with its offset. */
  readonly committedAt: string;
}
export interface FileStat {
  readonly path: string;
  readonly added: number | null;
  readonly deleted: number | null;
}
export interface CommitRead extends CommitSummary {
  readonly files: ReadonlyArray<FileStat>;
  readonly truncated: boolean;
}
export interface DiffFile extends FileStat {
  readonly hunks: string;
  readonly binary: boolean;
  readonly truncated: boolean;
}
/** All reads have hard ceilings; optional requested bounds may only narrow them. */
export interface HqGit {
  readonly create: (repo: Repo) => Effect.Effect<Repo, GitError>;
  /**
   * A repository made from a bundle `bundle` wrote: every ref as it was, its objects checked as a
   * push's are, then converged like every repository; an empty one for `null` (a repository that had
   * no ref). An existing repository is `exists`.
   */
  readonly restore: (repo: Repo, bundle: string | null) => Effect.Effect<Repo, GitError>;
  /**
   * Fetches branches (except `mate/*`) and tags; HEAD is always main, so a source without main is
   * refused. Credentials travel in environment config, never in a URL or argv. The repository
   * appears with all its refs at once or not at all.
   */
  readonly import: (
    repo: Repo,
    source: string,
    credentials?: ImportCredentials,
  ) => Effect.Effect<Repo, GitError>;
  readonly list: (appId?: string) => Effect.Effect<ReadonlyArray<Repo>, GitError>;
  /**
   * The repository gone: moved out of `list`'s sight at once, then deleted; its application's
   * directory with its last repository. One already gone is removed already. What a crash leaves of
   * it is swept on the next open.
   */
  readonly remove: (repo: Repo) => Effect.Effect<void, GitError>;
  /** Core calls this on takeover: converges config and sweeps stale locks, quarantines, scratch. */
  readonly convergeRepo: (repo: Repo) => Effect.Effect<void, GitError>;
  readonly changeHead: (
    repo: Repo,
    mateId: string,
    number: number,
  ) => Effect.Effect<string | null, GitError>;
  /**
   * `already_merged` when Core's change record says merged, or a `Mate-Change` trailer for the
   * change sits on main's first-parent line past its merge base with the change. A walk past the
   * history bound fails closed with `invalid_config`: Core reconciles before retrying. A change
   * that merged main after an earlier squash moves its base past that squash, so for it only
   * Core's record guards. An unborn main is `no_main`.
   */
  readonly mergeability: (
    repo: Repo,
    mateId: string,
    number: number,
    snapshot?: ChangeSnapshot,
  ) => Effect.Effect<Mergeability, GitError>;
  /** Mergeability's verdict, then one commit on main by CAS: never a moved main or change head. */
  readonly squashMerge: (
    repo: Repo,
    options: SquashOptions,
  ) => Effect.Effect<
    | { readonly merged: string }
    | Exclude<Mergeability, { readonly kind: "clean" }>
    | { readonly kind: "main_moved" | "head_moved" },
    GitError
  >;
  readonly commitFiles: (
    repo: Repo,
    ref: string,
    options: CommitFilesOptions,
  ) => Effect.Effect<{ readonly sha: string } | { readonly kind: "head_moved" }, GitError>;
  /** An existing tag is `exists_same` when it peels to the same commit, else `conflict`. */
  readonly createTag: (
    repo: Repo,
    name: string,
    sha: string,
    message: string,
  ) => Effect.Effect<{ readonly kind: "created" | "exists_same" | "conflict" }, GitError>;
  readonly branches: (
    repo: Repo,
  ) => Effect.Effect<Bounded<{ readonly ref: string; readonly sha: string }>, GitError>;
  /** Git's content hash of a commit's tree, for delivery equality. */
  readonly treeId: (repo: Repo, sha: string) => Effect.Effect<string, GitError>;
  readonly tree: (
    repo: Repo,
    rev: string,
    path: string,
  ) => Effect.Effect<Bounded<TreeEntry>, GitError>;
  readonly file: (
    repo: Repo,
    rev: string,
    path: string,
    maxBytes: number,
  ) => Effect.Effect<FileRead, GitError>;
  /** Opaque cursor pins the initial tip and offset, so pagination survives ref movement. */
  readonly log: (
    repo: Repo,
    rev: string,
    options: { readonly cursor?: string; readonly limit: number },
  ) => Effect.Effect<Bounded<CommitSummary> & { readonly cursor: string | null }, GitError>;
  readonly commit: (repo: Repo, sha: string) => Effect.Effect<CommitRead, GitError>;
  /**
   * Whether the commit `sha` is main's head or before it on main's history; false for an object
   * that is no commit, one the repository lacks, or an unborn main.
   */
  readonly onMain: (repo: Repo, sha: string) => Effect.Effect<boolean, GitError>;
  /**
   * The repository whole, as one git bundle written to `file`: every ref and every object they
   * reach, with the refs it holds. A repository with no ref writes no file and names none.
   */
  readonly bundle: (
    repo: Repo,
    file: string,
  ) => Effect.Effect<
    { readonly refs: ReadonlyArray<{ readonly ref: string; readonly sha: string }> },
    GitError
  >;
  /**
   * The repository's tags: each by the commit it names, its message and when it was tagged (empty
   * for a lightweight tag, which has neither).
   */
  readonly tags: (repo: Repo) => Effect.Effect<Bounded<TagRead>, GitError>;
  /**
   * Every change branch, `refs/heads/mate/<mateId>/<number>`, by its Mate and number. Past the
   * history ceiling it fails closed (`invalid_config`) rather than answer part.
   */
  readonly changeRefs: (
    repo: Repo,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly mateId: string; readonly number: number; readonly sha: string }>,
    GitError
  >;
  /** Which of `shas` the repository has no commit of: missing, or another kind of object. */
  readonly missingCommits: (
    repo: Repo,
    shas: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string>, GitError>;
  /** The change's merge base with main; null without a change head, a main, or shared history. */
  readonly mergeBase: (
    repo: Repo,
    mateId: string,
    number: number,
    snapshot?: ChangeSnapshot,
  ) => Effect.Effect<string | null, GitError>;
  /**
   * The commits `base..head` names — reachable from `head` and not from `base`, every one up to
   * `head` without a `base` — children before parents, at most `limit`; and how many there are,
   * counted up to the history bound (that many means at least as many). `base` need not come before
   * `head`. Both are full shas, and a commit the repository lacks is `not_found`.
   */
  readonly range: (
    repo: Repo,
    base: string | null,
    head: string,
    options: { readonly limit: number },
  ) => Effect.Effect<Bounded<CommitSummary> & { readonly total: number }, GitError>;
  /**
   * The change's commits not on main or before its own base (the previously landed head),
   * children before parents, at most `limit`;
   * without a main, all of the change's. None without a change head.
   */
  readonly changeLog: (
    repo: Repo,
    mateId: string,
    number: number,
    options: { readonly limit: number; readonly base?: string; readonly snapshot?: ChangeSnapshot },
  ) => Effect.Effect<Bounded<CommitSummary>, GitError>;
  /**
   * What squashing the change into main would do to main now: each file of the merged tree that
   * differs from main's, and how — git's name-status letter, `A` added, `M` modified, `D` deleted,
   * `T` its type changed — renames never detected; a change that would do nothing names none. Named
   * against the `main` and change `head` it read, which a squash takes as expected, so what lands is
   * what was named. A change that does not merge so is its verdict instead; an unborn main is
   * `no_main`. Bounded like every read.
   */
  readonly squashNames: (
    repo: Repo,
    mateId: string,
    number: number,
  ) => Effect.Effect<
    SquashNames | Exclude<Mergeability, { readonly kind: "clean" | "empty" }>,
    GitError
  >;
  /**
   * The trailers of `keys` across every commit of the change not on main (`main..head`), oldest
   * commit first, as git's own trailer parser reads each message: folded values unfolded, keys
   * matched without case and answered as asked. Past the history ceiling it fails closed
   * (`invalid_config`) rather than answer part; none without a change head.
   */
  readonly changeTrailers: (
    repo: Repo,
    mateId: string,
    number: number,
    keys: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<{ readonly key: string; readonly value: string }>, GitError>;
  readonly changeDiff: (
    repo: Repo,
    mateId: string,
    number: number,
    options: {
      readonly maxFiles: number;
      readonly maxBytesPerFile: number;
      readonly snapshot?: ChangeSnapshot;
    },
  ) => Effect.Effect<Bounded<DiffFile>, GitError>;
  /** Stream belongs to the consumer: destroy it on cancellation; layer scope also stops git. */
  readonly archive: (repo: Repo, sha: string) => Effect.Effect<NodeStream.Readable, GitError>;
  readonly handler: NodeHttp.RequestListener;
}
