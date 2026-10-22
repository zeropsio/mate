import { HqRemoteRefusalReason, remoteRefusalWords } from "@t3tools/shared/hqGitTargets";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HqGitTargetIntent, HqGitOperationReceipt } from "@t3tools/shared/hqGitTargets";
import {
  HqRepoGovernance,
  RepoName,
  tokenExpiryLabel,
  type HqRepoRemote,
  type MateRepo,
  type HqRemoteProbe,
  type HqTokenCiAccess,
} from "@t3tools/shared/hqChanges";
import { keepGitReceipt, readGitReceipt, GitRequestRefused } from "./gitTargetReceipts.ts";
/** The only owner of a repository's verified connection and sealed credential custody. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { Changes, type ChangeRefused } from "./changes.ts";
import type { GitError } from "@t3tools/hq-git";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { DeployKeys } from "./deployKeys.ts";
import { GitHost } from "./gitHost.ts";
import { GithubAuth, type GithubTokenUse } from "./githubAuth.ts";
import { GithubProbes, type ProbeRefused, type VerifiedRemote } from "./githubProbes.ts";
import { remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, decidedFresh } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** A mirror's kept governance, read only as one HQ still says. */
const decodeGovernance = Schema.decodeUnknownOption(HqRepoGovernance);

export interface RemoteRef {
  readonly appId: string;
  readonly repo: string;
}
export interface ConnectRemote extends RemoteRef {
  readonly url: string;
  readonly token: Redacted.Redacted;
  readonly branch?: string;
}
/** Surface-safe facts; the seal and plaintext never leave custody in this shape. */
export interface RemoteRecord extends RemoteRef {
  readonly url: string;
  readonly urlKey: string;
  readonly host: string;
  readonly hostRepoId: string | null;
  readonly keptBy: string | null;
  /** Exact database timestamp: the attempt's fencing evidence, not a rounded JS date. */
  readonly keptAt: string | null;
  readonly invalidSince: string | null;
  readonly expiresAt: string | null;
  readonly expiryLabel: string;
  readonly credentialState: "kept" | "missing" | "invalid";
  /** How HQ reaches it: the organization's GitHub app (no token kept) or a person's token. */
  readonly via?: "app" | "token";
}
/** Stored custody has one wire projection; neither seal nor token is included. */
export const remoteForWire = (row: RemoteRecord): HqRepoRemote | null =>
  row.keptAt === null || row.keptBy === null
    ? null
    : {
        url: row.url,
        repositoryId: row.hostRepoId,
        expiresAt: row.expiresAt,
        invalidSince: row.invalidSince,
        keptAt: row.keptAt
          .replace(" ", "T")
          .replace(/\+00$/, "Z")
          .replace(/([+-]\d{2})$/, "$1:00"),
        keptBy: row.keptBy,
        via: row.via ?? "token",
      };
export class RemoteRefused extends Schema.TaggedError<RemoteRefused>()("RemoteRefused", {
  repository: Schema.optionalKey(Schema.String),
  applicationName: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  hostRepoId: Schema.optionalKey(Schema.String),
  environments: Schema.optionalKey(Schema.Array(Schema.String)),
  reason: HqRemoteRefusalReason,
}) {
  override get message() {
    return remoteRefusalWords(this);
  }
}
/**
 * Why a Mate's agent gets no credential for a repository (`Remotes.mateCredential`):
 * `not_mounted`, its application mounts no such repository; `no_access`, the Mate does not work in
 * its application now; `app_not_installed`, the organization's app no longer reaches it;
 * `github_unavailable`, GitHub did not answer.
 */
export class MateCredentialRefused extends Schema.TaggedError<MateCredentialRefused>()(
  "MateCredentialRefused",
  {
    reason: Schema.Literals([
      "not_mounted",
      "no_access",
      "app_not_installed",
      "github_unavailable",
    ]),
  },
) {}
/** A git credential a Mate's agent presents to GitHub for one repository, until `expiresAt`. */
export interface MateCredential {
  readonly username: "x-access-token";
  readonly password: Redacted.Redacted;
  readonly expiresAt: string;
}
export type RemoteError = RemoteRefused | ProbeRefused | SqlError | NotLeader;
export type RemoteConnectError = RemoteError | ChangeRefused | GitError;
export type RemoteRequestError = RemoteConnectError | GitRequestRefused;
export type RemoteIntent = Extract<HqGitTargetIntent, { readonly repo: string }>;
export class Remotes extends Context.Service<
  Remotes,
  {
    readonly changes: Stream.Stream<number>;
    readonly listRepos: Changes["Service"]["listRepos"];
    readonly write: (
      userId: string,
      requestId: string,
      intent: RemoteIntent,
      candidate?: Redacted.Redacted,
    ) => Effect.Effect<HqGitOperationReceipt, RemoteRequestError>;
    readonly receipt: (
      userId: string,
      requestId: string,
      intent: HqGitTargetIntent,
    ) => Effect.Effect<HqGitOperationReceipt | null, RemoteRequestError>;
    /** The application's repositories with their connected origins' addresses, for its Mate. */
    readonly mateRepos: (appId: string) => Effect.Effect<ReadonlyArray<MateRepo>, SqlError>;
    /** Internal readers still apply their own application read gate before presenting these facts. */
    readonly get: (ref: RemoteRef) => Effect.Effect<RemoteRecord | undefined, SqlError>;
    readonly connect: (
      userId: string,
      input: ConnectRemote,
    ) => Effect.Effect<RemoteRecord, RemoteConnectError>;
    /** Explicit same-id GitHub address review, never an automatic transfer of authority. */
    readonly updateAddress: (
      userId: string,
      input: ConnectRemote,
    ) => Effect.Effect<RemoteRecord, RemoteConnectError>;
    readonly disconnect: (
      userId: string,
      ref: RemoteRef,
    ) => Effect.Effect<void, RemoteError | GitError>;
    /**
     * Worker-only credential handoff; the caller captures keptAt before using it. Through the
     * app, a token for `purpose` alone: the branch's git, or that and its CI's reads.
     */
    readonly forUse: (
      ref: RemoteRef,
      branch: string,
      purpose: "git" | "ci",
    ) => Effect.Effect<
      {
        readonly remote: RemoteRecord;
        readonly token: Redacted.Redacted;
        readonly branchRules?: "none_on_plan";
      },
      RemoteError
    >;
    readonly invalidate: (
      ref: RemoteRef,
      attemptedKeptAt: string,
    ) => Effect.Effect<void, SqlError | NotLeader>;
    /** What a token may read of the chosen branch's CI on GitHub; nothing for other hosts. */
    readonly ciAccess: (
      url: string,
      token: Redacted.Redacted,
      branch?: string,
    ) => Effect.Effect<{ readonly ci?: HqTokenCiAccess }>;
    /**
     * A token for a call on the repository's host's API that pushes nothing — an issue's comment, a
     * webhook (`intake.ts`). To `act` (the default), the organization's GitHub app's wherever it
     * reaches the repository, so what HQ writes there is the app's; else, and for `kept`, the
     * person's kept token: its custodian still a member, the token not known invalid. A remote
     * reached through the app has only the app's, for `purpose` alone. `as` names whose it is.
     * No probe.
     */
    readonly tokenOf: (
      ref: RemoteRef,
      purpose: GithubTokenUse,
      use?: "act" | "kept",
    ) => Effect.Effect<
      {
        readonly remote: RemoteRecord;
        readonly token: Redacted.Redacted;
        readonly as: "app" | "token";
      },
      RemoteError
    >;
    /**
     * The credential the Mate of `projectId`'s agent fetches and pushes `path` (`owner/name`) on
     * `host` with, while its application mounts that repository and the Mate works in it, as HQ
     * decides the Mate's push to its own git, over roles read for this ask. Mounted through the organization's app: the app's
     * token for that repository alone, for the `agent`'s use. Followed by another remote: a
     * read-only token, only where the app reaches the repository; a person's kept token is never
     * handed on. Minted for this call, kept nowhere.
     */
    readonly mateCredential: (
      projectId: string,
      host: string,
      path: string,
    ) => Effect.Effect<MateCredential, MateCredentialRefused | SqlError | NotLeader | ZeropsError>;
    /**
     * The repository's remote made the GitHub repository `repository` (as the app's installation
     * lists it), reached through the organization's GitHub app: no token kept. A remote of
     * the same address with a token is replaced; one of another address is refused.
     */
    readonly connectViaApp: (
      userId: string,
      ref: RemoteRef,
      repository: { readonly fullName: string; readonly id: number },
    ) => Effect.Effect<RemoteRecord, RemoteConnectError>;
    /**
     * The repository's code kept in HQ while it follows the GitHub repository at `url`: its Mates
     * fetch it, nothing pushes to it, no token is kept. Made in HQ if new, as connecting it would.
     * A remote connected to it says how its code is kept instead (`mateRepos`).
     */
    readonly follow: (
      userId: string,
      ref: RemoteRef,
      url: string,
    ) => Effect.Effect<void, RemoteConnectError>;
  }
>()("@t3tools/hq/repoRemotes/Remotes") {}

interface RemoteRow {
  readonly app_id: string;
  readonly repo: string;
  readonly url: string;
  readonly url_key: string;
  readonly host: string;
  readonly host_repo_id: string | null;
  readonly sealed: Uint8Array | null;
  readonly key_id: string | null;
  readonly kept_by: string | null;
  readonly kept_at: string | null;
  readonly invalid_since: string | null;
  readonly expires_at: string | null;
  readonly via: "app" | "token";
}
const COLUMNS = `app_id::text,repo,url,url_key,host,host_repo_id,sealed,key_id,kept_by,kept_at::text,invalid_since::text,via,
  to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at`;
const record = (row: RemoteRow): RemoteRecord => ({
  appId: row.app_id,
  repo: row.repo,
  url: row.url,
  urlKey: row.url_key,
  host: row.host,
  hostRepoId: row.host_repo_id,
  keptBy: row.kept_by,
  keptAt: row.kept_at,
  invalidSince: row.invalid_since,
  expiresAt: row.expires_at,
  expiryLabel: tokenExpiryLabel(row.expires_at),
  credentialState:
    row.via === "app"
      ? "kept"
      : row.invalid_since !== null
        ? "invalid"
        : row.sealed === null
          ? "missing"
          : "kept",
  via: row.via,
});
const isRepoName = Schema.is(RepoName);

// Matches Git's branch constraints without launching a credentialed Git command to validate input.
const branchValid = (branch: string) =>
  branch.length > 0 &&
  branch.length <= 255 &&
  branch !== "@" &&
  [...branch].every(
    (char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127 && !"~^:?*[\\".includes(char),
  ) &&
  !branch.includes("..") &&
  !branch.includes("@{") &&
  !branch.startsWith("-") &&
  !branch.endsWith(".") &&
  branch
    .split("/")
    .every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));

export const repoRemotesLayer = Layer.effect(
  Remotes,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ticks = yield* SubscriptionRef.make(0);
    const keys = yield* DeployKeys;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const probes = yield* GithubProbes;
    const changes = yield* Changes;
    const githubAuth = yield* GithubAuth;
    const gitHost = yield* GitHost;
    const appUnavailable = (error?: { readonly reason: string }) =>
      new RemoteRefused({
        reason: error?.reason === "replaced" ? "repository_changed" : "app_unavailable",
      });
    /**
     * The app's token for a remote reached through it: only for the repository it connected, by
     * its id on GitHub, never another made under its name.
     */
    const appTokenOf = Effect.fnUntraced(function* (row: RemoteRow, purpose: GithubTokenUse) {
      // Its app forgotten (`githubApp.ts`): connected through an app again before it works again.
      if (row.invalid_since !== null)
        return yield* new RemoteRefused({ reason: "app_not_installed" });
      const identity = remoteIdentity(row.url);
      const token =
        identity?.kind === "github"
          ? yield* githubAuth
              .tokenFor(identity.path, purpose, row.host_repo_id ?? undefined)
              .pipe(Effect.mapError(appUnavailable))
          : undefined;
      if (token === undefined) return yield* new RemoteRefused({ reason: "app_not_installed" });
      return token;
    });
    const validateRepo = (repo: string) =>
      repo !== RECIPE_REPO && isRepoName(repo)
        ? Effect.void
        : Effect.fail(new RemoteRefused({ reason: "bad_repo" }));
    const lookup = (ref: RemoteRef) =>
      sql<RemoteRow>`SELECT ${sql.literal(COLUMNS)} FROM hq_repo_remote WHERE app_id::text=${ref.appId} AND repo=${ref.repo}`.pipe(
        Effect.map((rows) => rows[0]),
      );
    const fresh = decidedFresh(roles.forWrite).pipe(
      Effect.mapError(() => new RemoteRefused({ reason: "membership_unknown" })),
      Effect.flatMap((view) =>
        view.freshness !== "fresh" || view.members.length === 0
          ? Effect.fail(new RemoteRefused({ reason: "membership_unknown" }))
          : Effect.succeed(view),
      ),
    );
    const authorize = Effect.fnUntraced(function* (userId: string) {
      const verdict = can(
        { kind: "person", userId },
        "connect_remote",
        { projectIds: [] },
        yield* fresh,
      );
      if (!verdict.allow) return yield* new RemoteRefused({ reason: "not_structure_writer" });
    });
    const lockRepo = Effect.fnUntraced(function* (ref: RemoteRef) {
      const rows =
        yield* sql`SELECT name FROM hq_repo WHERE app_id::text=${ref.appId} AND name=${ref.repo} FOR UPDATE`;
      if (rows.length === 0) return yield* new RemoteRefused({ reason: "not_repo" });
    });
    const invalidate = (ref: RemoteRef, attemptedKeptAt: string) =>
      leader
        .write(sql`
    UPDATE hq_repo_remote SET invalid_since=clock_timestamp()
    WHERE app_id::text=${ref.appId} AND repo=${ref.repo} AND kept_at=${attemptedKeptAt}::timestamptz
      AND invalid_since IS NULL`)
        .pipe(Effect.asVoid);
    const custody = Effect.fnUntraced(function* (ref: RemoteRef, row: RemoteRow) {
      const view = yield* fresh;
      if (
        view.members.some((member) => member.userId === row.kept_by && member.status === "ACTIVE")
      )
        return;
      yield* leader.write(sql`UPDATE hq_repo_remote SET sealed=NULL,key_id=NULL,expires_at=NULL,invalid_since=clock_timestamp()
      WHERE app_id::text=${ref.appId} AND repo=${ref.repo} AND kept_at IS NOT DISTINCT FROM ${row.kept_at}::timestamptz`);
      return yield* new RemoteRefused({ reason: "custodian_removed" });
    });
    const checkIdentity = (old: RemoteRow, checked: VerifiedRemote, reviewed = false) => {
      if (old.host_repo_id !== checked.hostRepoId)
        return Effect.fail(new RemoteRefused({ reason: "repository_changed" }));
      if (old.url_key !== checked.remote.key && !reviewed)
        return Effect.fail(
          new RemoteRefused({
            reason: "address_review",
            url: checked.remote.url,
            ...(checked.hostRepoId === null ? {} : { hostRepoId: checked.hostRepoId }),
          }),
        );
      return Effect.void;
    };
    const refuseOccupiedRemote = Effect.fnUntraced(function* (
      userId: string,
      checked: Pick<VerifiedRemote, "remote" | "hostRepoId">,
    ) {
      const owners = yield* sql<{ readonly id: string; readonly name: string }>`
        SELECT a.id::text, a.name FROM hq_repo_remote r JOIN hq_app a ON a.id=r.app_id
        WHERE r.url_key=${checked.remote.key}
          OR (r.host=${checked.remote.host} AND r.host_repo_id=${checked.hostRepoId})
        LIMIT 1`;
      const owner = owners[0];
      let applicationName: string | undefined;
      if (owner) {
        const projects = yield* sql<{ readonly project_id: string }>`
          SELECT project_id FROM hq_app_project WHERE app_id::text=${owner.id}`;
        const view = yield* fresh.pipe(Effect.option);
        if (
          view._tag === "Some" &&
          can(
            { kind: "person", userId },
            "read_app",
            { projectIds: projects.map((project) => project.project_id) },
            view.value,
          ).allow
        )
          applicationName = owner.name;
      }
      return yield* new RemoteRefused({
        reason: "remote_taken",
        repository: checked.remote.path,
        ...(applicationName === undefined ? {} : { applicationName }),
      });
    });
    const keep = Effect.fn("Remotes.keep")(function* (
      userId: string,
      input: ConnectRemote,
      review: boolean,
    ) {
      yield* authorize(userId);
      yield* validateRepo(input.repo);
      const remote = remoteIdentity(input.url);
      if (!remote) return yield* new RemoteRefused({ reason: "bad_address" });
      if (input.branch !== undefined && !branchValid(input.branch))
        return yield* new RemoteRefused({ reason: "bad_branch" });
      const old = yield* lookup(input);
      if (review) {
        if (!old) return yield* new RemoteRefused({ reason: "no_remote" });
        if (old.host_repo_id === null || remote.kind !== "github" || old.host !== remote.host)
          return yield* new RemoteRefused({ reason: "disconnect_required" });
      } else if (old && old.url_key !== remote.key)
        return yield* new RemoteRefused({ reason: "disconnect_required" });
      const checked = yield* probes.verify(remote, input.token, input.branch);
      if (checked.remote.key !== remote.key)
        return yield* new RemoteRefused({
          reason: "address_review",
          url: checked.remote.url,
          ...(checked.hostRepoId === null ? {} : { hostRepoId: checked.hostRepoId }),
        });
      if (old) yield* checkIdentity(old, checked, review);
      const sealed = keys.sealRemote(input.appId, input.repo, input.token);
      if (!sealed) return yield* new RemoteRefused({ reason: "no_key" });
      // Fresh authority at acceptance as well as before the candidate's read-only host I/O.
      yield* authorize(userId);
      const known =
        yield* sql`SELECT 1 FROM hq_repo WHERE app_id::text=${input.appId} AND name=${input.repo}`;
      if (known.length === 0 && !review) {
        // Git storage outlives a SQL rollback; refuse known ownership before creating it.
        const occupied = yield* sql`
          SELECT 1 FROM hq_repo_remote
          WHERE (url_key=${checked.remote.key}
            OR (host=${checked.remote.host} AND host_repo_id=${checked.hostRepoId}))
            AND (app_id::text<>${input.appId} OR repo<>${input.repo})
          LIMIT 1`;
        if (occupied.length > 0) return yield* refuseOccupiedRemote(userId, checked);
        yield* changes.ensurePersonRepo(userId, input.appId, input.repo).pipe(
          Effect.catchTags({
            ZeropsRefused: () => Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
            ZeropsUnavailable: () =>
              Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
            ZeropsUnexpectedAnswer: () =>
              Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
          }),
        );
      }
      return yield* leader
        .write(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* lockRepo(input);
              const current = yield* lookup(input);
              if (current?.kept_at !== old?.kept_at || current?.url_key !== old?.url_key)
                return yield* new RemoteRefused({ reason: "changed" });
              const rows =
                yield* sql<RemoteRow>`INSERT INTO hq_repo_remote(app_id,repo,url,url_key,host,host_repo_id,sealed,key_id,kept_by,kept_at,expires_at)
        VALUES (${input.appId}::uuid,${input.repo},${checked.remote.url},${checked.remote.key},${checked.remote.host},${checked.hostRepoId},${sealed.sealed},${sealed.keyId},${userId},clock_timestamp(),${checked.expiresAt}::timestamptz)
        ON CONFLICT (app_id,repo) DO UPDATE SET url=excluded.url,url_key=excluded.url_key,host=excluded.host,host_repo_id=excluded.host_repo_id,
          sealed=excluded.sealed,key_id=excluded.key_id,kept_by=excluded.kept_by,kept_at=excluded.kept_at,expires_at=excluded.expires_at,invalid_since=NULL,via='token'
        RETURNING ${sql.literal(COLUMNS)}`;
              return record(rows[0]!);
            }),
          ),
        )
        .pipe(
          Effect.catchTags({
            SqlError: (error) =>
              error.reason._tag === "UniqueViolation" &&
              ["hq_repo_remote_url_key_key", "hq_repo_remote_host_id"].includes(
                error.reason.constraint,
              )
                ? refuseOccupiedRemote(userId, checked)
                : Effect.fail(error),
          }),
        );
    });
    /** The token test's optional CI rows: GitHub remotes, read on a chosen branch only. */
    const ciAccess = (url: string, token: Redacted.Redacted, branch?: string) => {
      const remote = remoteIdentity(url);
      return remote?.kind === "github" && branch !== undefined
        ? Effect.map(probes.ciAccess(remote, token, branch), (ci) => ({ ci }))
        : Effect.succeed({});
    };
    const safeProbe = (row: RemoteRecord): HqRemoteProbe => ({
      ok: true,
      remote: remoteForWire(row)!,
    });
    const remotes: Remotes["Service"] = Remotes.of({
      changes: SubscriptionRef.changes(ticks),
      mateCredential: Effect.fn("Remotes.mateCredential")(function* (projectId, host, path) {
        // The view decides: git asks on each fetch and push, and its token lives an hour regardless.
        const appId = yield* changes.mateApp(projectId, "open_change").pipe(
          Effect.catchTags({
            ChangeRefused: () => Effect.fail(new MateCredentialRefused({ reason: "no_access" })),
          }),
        );
        const notMounted = new MateCredentialRefused({ reason: "not_mounted" });
        const identity = remoteIdentity(`https://${host}/${path}`);
        if (identity?.kind !== "github") return yield* notMounted;
        const [row] = yield* sql<RemoteRow>`SELECT ${sql.literal(COLUMNS)} FROM hq_repo_remote
          WHERE app_id::text=${appId} AND url_key=${identity.key}`;
        if (row === undefined) return yield* notMounted;
        const mounted = row.via === "app";
        const issued =
          mounted && row.invalid_since === null
            ? githubAuth.issue(identity.path, "agent", row.host_repo_id ?? undefined)
            : !mounted && identity.host === "github.com"
              ? githubAuth.issue(identity.path, "upstream")
              : Effect.succeed(undefined);
        const given = yield* issued.pipe(
          Effect.catchTags({
            GithubAuthUnavailable: (error) =>
              error.reason === "unreachable"
                ? Effect.fail(new MateCredentialRefused({ reason: "github_unavailable" }))
                : Effect.succeed(undefined),
          }),
        );
        if (given === undefined)
          return yield* mounted
            ? new MateCredentialRefused({ reason: "app_not_installed" })
            : notMounted;
        return {
          username: "x-access-token" as const,
          password: given.token,
          expiresAt: given.expiresAt,
        };
      }),
      listRepos: Effect.fn("Remotes.listRepos")(function* (userId, appId) {
        const repos = yield* changes.listRepos(userId, appId);
        // A mirror says since when its histories diverged, and through the app whether GitHub
        // lets only what Mate approved reach its default branch (`githubMirror.ts`).
        const mirrors = new Map(
          (yield* sql<{
            readonly repo: string;
            readonly since: string | null;
            readonly governance: string | null;
          }>`
            SELECT repo, governance,
              to_char(diverged_since AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS since
            FROM hq_repo_mirror WHERE app_id::text=${appId}`).map(
            (row) => [row.repo, row] as const,
          ),
        );
        return yield* Effect.forEach(repos, (repo) =>
          Effect.map(remotes.get({ appId, repo: repo.name }), (row) => {
            const remote = row === undefined ? null : remoteForWire(row);
            const mirror = mirrors.get(repo.name);
            const governance = Option.getOrUndefined(decodeGovernance(mirror?.governance));
            return {
              ...repo,
              remote:
                remote === null
                  ? remote
                  : {
                      ...remote,
                      ...(mirror?.since == null ? {} : { divergedSince: mirror.since }),
                      ...(remote.via !== "app" || governance === undefined ? {} : { governance }),
                    },
            };
          }),
        );
      }),
      receipt: (userId, requestId, intent) =>
        decidedFresh(
          Effect.gen(function* () {
            yield* authorize(userId);
            return yield* readGitReceipt(sql, userId, requestId, intent);
          }),
        ),
      write: (userId, requestId, intent, candidate) =>
        decidedFresh(
          Effect.gen(function* () {
            yield* authorize(userId);
            const view = yield* fresh;
            if (intent.orgId !== view.orgId)
              return yield* new RemoteRefused({ reason: "not_structure_writer" });
            const receipt = yield* keepGitReceipt(
              sql,
              leader,
              userId,
              requestId,
              intent,
              Effect.gen(function* () {
                const ref = { appId: intent.appId, repo: intent.repo };
                const branch = "branch" in intent ? intent.branch : undefined;
                if (intent.kind === "disconnect-git-remote") {
                  yield* remotes.disconnect(userId, ref);
                  return undefined;
                }
                const old = yield* lookup(ref);
                if (intent.kind === "update-git-remote-address") {
                  if (!old) return yield* new RemoteRefused({ reason: "no_remote" });
                  yield* custody(ref, old);
                  const token =
                    old.sealed !== null && old.key_id !== null
                      ? keys.openRemote(ref.appId, ref.repo, {
                          sealed: old.sealed,
                          keyId: old.key_id,
                        })
                      : undefined;
                  if (!token) return yield* new RemoteRefused({ reason: "key_unavailable" });
                  yield* remotes.updateAddress(userId, {
                    ...ref,
                    url: intent.url,
                    ...(branch === undefined ? {} : { branch }),
                    token,
                  });
                  return undefined;
                }
                if (intent.kind === "run-git-again")
                  return yield* new RemoteRefused({ reason: "not_repo" });
                if (!candidate) return yield* new RemoteRefused({ reason: "credential_invalid" });
                const url = intent.kind === "replace-git-remote-token" ? old?.url : intent.url;
                if (!url) return yield* new RemoteRefused({ reason: "no_remote" });
                if (intent.kind === "probe-git-remote") {
                  const remote = remoteIdentity(url);
                  if (!remote) return yield* new RemoteRefused({ reason: "bad_address" });
                  if (branch !== undefined && !branchValid(branch))
                    return yield* new RemoteRefused({ reason: "bad_branch" });
                  yield* validateRepo(ref.repo);
                  yield* changes.personGit(userId, ref.appId, true).pipe(
                    decidedFresh,
                    Effect.catchTags({
                      ZeropsRefused: () =>
                        Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
                      ZeropsUnavailable: () =>
                        Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
                      ZeropsUnexpectedAnswer: () =>
                        Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
                    }),
                  );
                  const checked = yield* probes.verify(remote, candidate, branch);
                  const ci = yield* ciAccess(checked.remote.url, candidate, branch);
                  yield* authorize(userId);
                  return {
                    ok: true,
                    remote: {
                      url: checked.remote.url,
                      repositoryId: checked.hostRepoId,
                      expiresAt: checked.expiresAt,
                      invalidSince: null,
                    },
                    ...ci,
                  } satisfies HqRemoteProbe;
                }
                const saved = yield* remotes.connect(userId, {
                  ...ref,
                  url,
                  ...(branch === undefined ? {} : { branch }),
                  token: candidate,
                });
                return {
                  probe: {
                    ...safeProbe(saved),
                    ...(yield* ciAccess(saved.url, candidate, branch)),
                  },
                };
              }),
            );
            yield* SubscriptionRef.update(ticks, (n) => n + 1);
            return receipt;
          }),
        ),
      mateRepos: Effect.fn("Remotes.mateRepos")(function* (appId: string) {
        const repos = yield* sql<{
          readonly name: string;
          readonly upstream: string | null;
        }>`SELECT name, upstream FROM hq_repo WHERE app_id::text=${appId} ORDER BY name`;
        return yield* Effect.forEach(repos, ({ name, upstream }) =>
          Effect.map(remotes.get({ appId, repo: name }), (row) => {
            const remote = row === undefined ? null : remoteForWire(row);
            // Through the organization's app GitHub keeps the code (`githubMirror.ts` follows
            // it); with a person's token, or only followed, HQ keeps it, GitHub an upstream.
            return remote !== null
              ? {
                  name,
                  origin: {
                    url: remote.url,
                    mode: remote.via === "app" ? ("github" as const) : ("follow" as const),
                  },
                }
              : upstream !== null
                ? { name, origin: { url: upstream, mode: "follow" as const } }
                : { name };
          }),
        );
      }),
      get: (ref) => Effect.map(lookup(ref), (row) => (row === undefined ? undefined : record(row))),
      connect: (userId, input) => keep(userId, input, false),
      updateAddress: (userId, input) => keep(userId, input, true),
      invalidate,
      ciAccess,
      disconnect: Effect.fn("Remotes.disconnect")(function* (userId: string, ref: RemoteRef) {
        yield* authorize(userId);
        yield* leader.write(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* lockRepo(ref);
              const dependencies = yield* sql<{
                name: string;
              }>`SELECT name FROM hq_environment WHERE app_id::text=${ref.appId} AND target='git' ORDER BY declared_seq,name`;
              if (dependencies.length > 0)
                return yield* new RemoteRefused({
                  reason: "in_use",
                  environments: dependencies.map((row) => row.name),
                });
              yield* sql`DELETE FROM hq_repo_remote WHERE app_id::text=${ref.appId} AND repo=${ref.repo}`;
            }),
          ),
        );
        // GitHub's branches and tags HQ followed go with the connection; a repository git does not
        // hold has none. Asked again, a disconnect removes what a failed one left.
        const git = yield* gitHost.git;
        yield* git.unfollowRefs({ appId: ref.appId, id: ref.repo }).pipe(
          Effect.catchIf(
            (error) => error.reason === "not_found",
            () => Effect.void,
          ),
        );
      }),
      connectViaApp: Effect.fn("Remotes.connectViaApp")(function* (
        userId: string,
        ref: RemoteRef,
        reached: { readonly fullName: string; readonly id: number },
      ) {
        yield* authorize(userId);
        yield* validateRepo(ref.repo);
        // A token GitHub gives the app for it: installed there, and not suspended.
        const token = yield* githubAuth
          .tokenFor(reached.fullName, "reach")
          .pipe(Effect.mapError(appUnavailable));
        if (token === undefined) return yield* new RemoteRefused({ reason: "app_not_installed" });
        const remote = remoteIdentity(`https://github.com/${reached.fullName}.git`);
        if (!remote) return yield* new RemoteRefused({ reason: "bad_address" });
        const hostRepoId = String(reached.id);
        const checked = { remote, hostRepoId };
        const old = yield* lookup(ref);
        if (old && old.url_key !== remote.key)
          return yield* new RemoteRefused({ reason: "disconnect_required" });
        if (old && old.host_repo_id !== null && old.host_repo_id !== hostRepoId)
          return yield* new RemoteRefused({ reason: "repository_changed" });
        yield* authorize(userId);
        const known =
          yield* sql`SELECT 1 FROM hq_repo WHERE app_id::text=${ref.appId} AND name=${ref.repo}`;
        if (known.length === 0) {
          const occupied = yield* sql`
            SELECT 1 FROM hq_repo_remote
            WHERE (url_key=${remote.key} OR (host=${remote.host} AND host_repo_id=${hostRepoId}))
              AND (app_id::text<>${ref.appId} OR repo<>${ref.repo})
            LIMIT 1`;
          if (occupied.length > 0) return yield* refuseOccupiedRemote(userId, checked);
          yield* changes.ensurePersonRepo(userId, ref.appId, ref.repo).pipe(
            Effect.catchTags({
              ZeropsRefused: () => Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
              ZeropsUnavailable: () =>
                Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
              ZeropsUnexpectedAnswer: () =>
                Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
            }),
          );
        }
        const saved = yield* leader
          .write(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* lockRepo(ref);
                const current = yield* lookup(ref);
                if (current?.kept_at !== old?.kept_at || current?.url_key !== old?.url_key)
                  return yield* new RemoteRefused({ reason: "changed" });
                const rows = yield* sql<RemoteRow>`
                  INSERT INTO hq_repo_remote(app_id,repo,url,url_key,host,host_repo_id,sealed,key_id,kept_by,kept_at,expires_at,via)
                  VALUES (${ref.appId}::uuid,${ref.repo},${remote.url},${remote.key},${remote.host},${hostRepoId},NULL,NULL,${userId},clock_timestamp(),NULL,'app')
                  ON CONFLICT (app_id,repo) DO UPDATE SET url=excluded.url,url_key=excluded.url_key,host=excluded.host,
                    host_repo_id=excluded.host_repo_id,sealed=NULL,key_id=NULL,kept_by=excluded.kept_by,
                    kept_at=excluded.kept_at,expires_at=NULL,invalid_since=NULL,via='app'
                  RETURNING ${sql.literal(COLUMNS)}`;
                return record(rows[0]!);
              }),
            ),
          )
          .pipe(
            Effect.catchTags({
              SqlError: (error) =>
                error.reason._tag === "UniqueViolation" &&
                ["hq_repo_remote_url_key_key", "hq_repo_remote_host_id"].includes(
                  error.reason.constraint,
                )
                  ? refuseOccupiedRemote(userId, checked)
                  : Effect.fail(error),
            }),
          );
        yield* SubscriptionRef.update(ticks, (n) => n + 1);
        return saved;
      }),
      follow: Effect.fn("Remotes.follow")(function* (userId: string, ref: RemoteRef, url: string) {
        yield* authorize(userId);
        yield* validateRepo(ref.repo);
        const remote = remoteIdentity(url);
        if (remote?.kind !== "github") return yield* new RemoteRefused({ reason: "bad_address" });
        const known =
          yield* sql`SELECT 1 FROM hq_repo WHERE app_id::text=${ref.appId} AND name=${ref.repo}`;
        if (known.length === 0)
          yield* changes.ensurePersonRepo(userId, ref.appId, ref.repo).pipe(
            Effect.catchTags({
              ZeropsRefused: () => Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
              ZeropsUnavailable: () =>
                Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
              ZeropsUnexpectedAnswer: () =>
                Effect.fail(new RemoteRefused({ reason: "membership_unknown" })),
            }),
          );
        yield* leader.write(
          sql`UPDATE hq_repo SET upstream=${remote.url} WHERE app_id::text=${ref.appId} AND name=${ref.repo}`,
        );
        yield* SubscriptionRef.update(ticks, (n) => n + 1);
      }),
      tokenOf: Effect.fn("Remotes.tokenOf")(function* (
        ref: RemoteRef,
        purpose: GithubTokenUse,
        use: "act" | "kept" = "act",
      ) {
        const row = yield* lookup(ref);
        if (!row) return yield* new RemoteRefused({ reason: "no_remote" });
        if (row.via === "app")
          return {
            remote: record(row),
            token: yield* appTokenOf(row, purpose),
            as: "app" as const,
          };
        const identity = remoteIdentity(row.url);
        if (use === "act" && identity?.kind === "github" && identity.host === "github.com") {
          const app = yield* githubAuth
            .tokenFor(identity.path, purpose)
            .pipe(Effect.mapError(appUnavailable));
          if (app !== undefined) return { remote: record(row), token: app, as: "app" as const };
        }
        yield* custody(ref, row);
        if (row.invalid_since !== null)
          return yield* new RemoteRefused({ reason: "credential_invalid" });
        const token =
          row.sealed !== null && row.key_id !== null
            ? keys.openRemote(ref.appId, ref.repo, { sealed: row.sealed, keyId: row.key_id })
            : undefined;
        if (!token) return yield* new RemoteRefused({ reason: "key_unavailable" });
        return { remote: record(row), token, as: "token" as const };
      }),
      forUse: Effect.fn("Remotes.forUse")(function* (
        ref: RemoteRef,
        branch: string,
        purpose: "git" | "ci",
      ) {
        if (!branchValid(branch)) return yield* new RemoteRefused({ reason: "bad_branch" });
        const row = yield* lookup(ref);
        if (!row) return yield* new RemoteRefused({ reason: "no_remote" });
        if (row.via === "app") {
          // The app's token: nobody's custody, and GitHub's hour-long expiry is none of the remote's.
          const appToken = yield* appTokenOf(row, purpose);
          const identity = remoteIdentity(row.url);
          if (!identity) return yield* new RemoteRefused({ reason: "bad_address" });
          const verified = yield* probes.verify(identity, appToken, branch);
          yield* checkIdentity(row, verified);
          return {
            remote: record(row),
            token: appToken,
            ...(verified.branchRules === undefined ? {} : { branchRules: verified.branchRules }),
          };
        }
        yield* custody(ref, row);
        if (row.invalid_since !== null)
          return yield* new RemoteRefused({ reason: "credential_invalid" });
        const token =
          row.sealed !== null && row.key_id !== null
            ? keys.openRemote(ref.appId, ref.repo, { sealed: row.sealed, keyId: row.key_id })
            : undefined;
        if (!token) return yield* new RemoteRefused({ reason: "key_unavailable" });
        const remote = remoteIdentity(row.url);
        if (!remote) return yield* new RemoteRefused({ reason: "bad_address" });
        const checked = yield* probes.verify(remote, token, branch).pipe(
          Effect.catchTags({
            ProbeRefused: (error) =>
              (error.reason === "token_invalid" || error.reason === "push_not_granted") &&
              row.kept_at !== null
                ? Effect.andThen(invalidate(ref, row.kept_at), Effect.fail(error))
                : Effect.fail(error),
          }),
        );
        yield* checkIdentity(row, checked);
        yield* custody(ref, row);
        return yield* leader.write(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* lockRepo(ref);
              const current = yield* lookup(ref);
              if (
                !current ||
                current.kept_at !== row.kept_at ||
                current.invalid_since !== null ||
                current.sealed === null
              )
                return yield* new RemoteRefused({ reason: "changed" });
              // A conditional update keeps an old attempt from replacing a rotation's expiry evidence.
              yield* sql`UPDATE hq_repo_remote SET expires_at=${checked.expiresAt}::timestamptz
          WHERE app_id::text=${ref.appId} AND repo=${ref.repo} AND kept_at=${row.kept_at}::timestamptz`;
              return {
                remote: record({ ...current, expires_at: checked.expiresAt }),
                token,
                ...(checked.branchRules === undefined ? {} : { branchRules: checked.branchRules }),
              };
            }),
          ),
        );
      }),
    });
    return remotes;
  }),
);
