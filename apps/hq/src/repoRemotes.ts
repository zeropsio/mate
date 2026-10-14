import { HqRemoteRefusalReason, remoteRefusalWords } from "@t3tools/shared/hqGitTargets";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HqGitTargetIntent, HqGitOperationReceipt } from "@t3tools/shared/hqGitTargets";
import { RepoName, type HqRepoRemote, type HqRemoteProbe } from "@t3tools/shared/hqChanges";
import { keepGitReceipt, readGitReceipt, GitRequestRefused } from "./gitTargetReceipts.ts";
/** The only owner of a repository's verified connection and sealed credential custody. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { Changes, type ChangeRefused } from "./changes.ts";
import type { GitError } from "@t3tools/hq-git";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { DeployKeys } from "./deployKeys.ts";
import {
  GithubProbes,
  type ProbeRefused,
  type VerifiedRemote,
  tokenExpiryLabel,
} from "./githubProbes.ts";
import { remoteIdentity } from "./gitTransport.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, decidedFresh } from "./roles.ts";

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
export type RemoteError = RemoteRefused | ProbeRefused | SqlError | NotLeader;
export type RemoteConnectError = RemoteError | ChangeRefused | GitError;
export type RemoteRequestError = RemoteConnectError | GitRequestRefused;
export type RemoteIntent = Extract<HqGitTargetIntent, { readonly repo: string }>;
export class Remotes extends Context.Service<
  Remotes,
  {
    readonly changes: Stream.Stream<number>;
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
    readonly disconnect: (userId: string, ref: RemoteRef) => Effect.Effect<void, RemoteError>;
    /** Worker-only credential handoff; the caller captures keptAt before using it. */
    readonly forUse: (
      ref: RemoteRef,
      branch: string,
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
}
const COLUMNS = `app_id::text,repo,url,url_key,host,host_repo_id,sealed,key_id,kept_by,kept_at::text,invalid_since::text,
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
    row.invalid_since !== null ? "invalid" : row.sealed === null ? "missing" : "kept",
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
      const verdict = can({ kind: "person", userId }, "create_app", null, yield* fresh);
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
      checked: VerifiedRemote,
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
          sealed=excluded.sealed,key_id=excluded.key_id,kept_by=excluded.kept_by,kept_at=excluded.kept_at,expires_at=excluded.expires_at,invalid_since=NULL
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
    const safeProbe = (row: RemoteRecord): HqRemoteProbe => ({
      ok: true,
      remote: remoteForWire(row)!,
    });
    const remotes: Remotes["Service"] = Remotes.of({
      changes: SubscriptionRef.changes(ticks),
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
                    }),
                  );
                  const checked = yield* probes.verify(remote, candidate, branch);
                  yield* authorize(userId);
                  return {
                    ok: true,
                    remote: {
                      url: checked.remote.url,
                      repositoryId: checked.hostRepoId,
                      expiresAt: checked.expiresAt,
                      invalidSince: null,
                    },
                  } satisfies HqRemoteProbe;
                }
                const saved = yield* remotes.connect(userId, {
                  ...ref,
                  url,
                  ...(branch === undefined ? {} : { branch }),
                  token: candidate,
                });
                return { probe: safeProbe(saved) };
              }),
            );
            yield* SubscriptionRef.update(ticks, (n) => n + 1);
            return receipt;
          }),
        ),
      get: (ref) => Effect.map(lookup(ref), (row) => (row === undefined ? undefined : record(row))),
      connect: (userId, input) => keep(userId, input, false),
      updateAddress: (userId, input) => keep(userId, input, true),
      invalidate,
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
      }),
      forUse: Effect.fn("Remotes.forUse")(function* (ref: RemoteRef, branch: string) {
        if (!branchValid(branch)) return yield* new RemoteRefused({ reason: "bad_branch" });
        const row = yield* lookup(ref);
        if (!row) return yield* new RemoteRefused({ reason: "no_remote" });
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
