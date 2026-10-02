// @effect-diagnostics nodeBuiltinImport:off - native Node smart HTTP and real git process boundary.
import type * as NodeHttp from "node:http";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type Principal =
  | { readonly kind: "mate"; readonly mateId: string; readonly appId: string }
  | { readonly kind: "core" }
  | { readonly kind: "reader"; readonly userId: string };

export interface Repo {
  readonly appId: string;
  readonly id: string;
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
}

type Awaitable<A> = A | Promise<A>;
export interface HqGitOptions {
  /** One instance per root: opening sweeps reservations and staging left by a crashed instance. */
  readonly rootDir: string;
  /** Routes default to /git/<appId>/<id>.git; Core may choose another mount prefix. */
  readonly pathPrefix?: string;
  readonly authenticate: (request: NodeHttp.IncomingMessage) => Awaitable<Principal | null>;
  /** Core checks app membership for readers, and app identity for mates. Also gates pushes. */
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
    "not_found",
    "no_main",
    "source_refused",
    "timeout",
    "git_failed",
  ]),
  /** Never carries server paths, stderr, or credentials. */
  message: Schema.String,
}) {}
export interface HqGit {
  readonly create: (repo: Repo) => Effect.Effect<Repo, GitError>;
  /**
   * Fetches branches (except `mate/*`) and tags; HEAD is always main, so a source without main is
   * refused. Credentials travel in environment config, never in a URL or argv.
   */
  readonly import: (
    repo: Repo,
    source: string,
    credentials?: ImportCredentials,
  ) => Effect.Effect<Repo, GitError>;
  readonly list: (appId?: string) => Effect.Effect<ReadonlyArray<Repo>, GitError>;
  /** Core calls this on takeover: converges config and sweeps stale locks and quarantines. */
  readonly convergeRepo: (repo: Repo) => Effect.Effect<void, GitError>;
  readonly handler: NodeHttp.RequestListener;
}
