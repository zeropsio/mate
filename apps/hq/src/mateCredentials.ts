// @effect-diagnostics nodeBuiltinImport:off -- a nonce and a credential are 256 bits from the system's CSPRNG.
/**
 * A Mate proves itself to HQ without its key ever leaving its container (SPEC §3.3). zcp asks for
 * a challenge, writes its nonce unmarked into its own project's env ({@link CHALLENGE_ENV}) with
 * its own key, and presents the nonce back. HQ reads that env with its own credential
 * (`HQ_ORG_TOKEN`, org Read only, whose direct `env-file` read sees a write at once: T0 §1); the
 * nonce found there proves the caller controls the project, and HQ issues it a Mate credential —
 * only for a project HQ holds as a Mate (`mate` or `devstage`: `can`'s `enroll_mate`), asked at the
 * challenge and again at the issue.
 *
 * Both are 256 random bits and HQ keeps only their SHA-256. A challenge is bound to one project,
 * lives two minutes and enrolls once. A credential is bound to its project and does not expire; a
 * project holds one live credential, so issuing the next one revokes it; a project gone from Zerops
 * loses its credential and its challenges at the structure's reconcile (`structure.ts`). Writes are
 * fenced by the leader.
 *
 * A Mate names its own key's id with its credential — at its enrollment, and again later — so HQ
 * can say which Zerops key is the Mate's to whoever adopts or deletes it: an id, never a value,
 * and never a match on the organization's token list (audit K3; `keyOf`).
 *
 * A project holds one Mate (audit D2): its record names its zcp service, and a zcp names its own at
 * its enrollment. Another zcp service of the project is refused, and never takes the Mate's
 * credential ({@link enrollmentVerdict}).
 *
 * @module mateCredentials
 */
import * as NodeCrypto from "node:crypto";

import { mateKeyReach } from "@t3tools/shared/mateKeyReach";
import { can } from "./permissions.ts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { heldOf, lockProject } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { StructureRefused } from "./structure.ts";
import { ZeropsApi, type ZeropsError, ZeropsRefused } from "./zerops/api.ts";

/** The project env key zcp writes the nonce into. */
export const CHALLENGE_ENV = "MATE_HQ_CHALLENGE";

export class MateRefused extends Schema.TaggedError<MateRefused>()("MateRefused", {
  code: Schema.Literals([
    "unknown_nonce",
    "expired",
    "env_mismatch",
    "project_not_in_org",
    "project_gone",
    "not_a_mate",
    "mate_credential_required",
    "key_not_its_own",
    "not_this_projects_mate",
  ]),
}) {}

export class MateCredentials extends Context.Service<
  MateCredentials,
  {
    readonly challenge: (
      projectId: string,
    ) => Effect.Effect<
      { readonly nonce: string; readonly expiresIn: number },
      MateRefused | NotLeader | SqlError | ZeropsError
    >;
    /**
     * The credential for the project whose env holds the nonce now; `keyTokenId`, the id of the key
     * its container holds, as the Mate names it — else the one its credential before named;
     * `serviceId`, the zcp service it runs in, which must be the one its record names
     * ({@link enrollmentVerdict}).
     */
    readonly issue: (
      projectId: string,
      nonce: string,
      named?: { readonly keyTokenId?: string; readonly serviceId?: string },
    ) => Effect.Effect<
      {
        readonly credential: string;
        /** Whether HQ's word that the Mate's key reads other projects changed ({@link keyWider}). */
        readonly keyWiderMoved: boolean;
      },
      MateRefused | NotLeader | SqlError | ZeropsError
    >;
    /** The project a live credential is bound to; none for an unknown or revoked one. */
    readonly whoami: (
      credential: string,
    ) => Effect.Effect<Option.Option<{ readonly projectId: string }>, SqlError>;
    /**
     * The id of the key its container holds, as the Mate of a live `credential` names it now; true
     * where HQ's word that the key reads other projects changed ({@link keyWider}).
     */
    readonly keepKey: (
      credential: string,
      keyTokenId: string,
    ) => Effect.Effect<boolean, MateRefused | NotLeader | SqlError | ZeropsError>;
    /**
     * Whether the key the Mate of `projectId` last named reads other projects too — the READ_ONLY
     * grants on siblings an earlier client gave a Mate's key (ADR 0003's fallout): it needs Finish
     * setup, whose harden takes them off. Read when the Mate names its key, never on a page's read.
     */
    readonly keyWider: (projectId: string) => Effect.Effect<boolean, SqlError>;
    /**
     * That key read again, for the person `userId` where they may edit the Mate's record — who
     * just finished its setup: once it reads its own project alone, HQ no longer says it is wider,
     * and keeps it as the Mate's key where its live credential names none. True where that changed.
     */
    readonly recheckKey: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<boolean, StructureRefused | NotLeader | SqlError | ZeropsError>;
    /** The id of the key the Mate of `projectId` named with its live credential; none unnamed. */
    readonly keyOf: (projectId: string) => Effect.Effect<string | null, SqlError>;
    /**
     * The key the Mate's container holds, told to the person `userId` where they administer the
     * Mate's project — who adopts it, finishes it, or deletes it (`edit_mate_record`'s rule): the
     * one it last named that reads other projects ({@link keyWider}), which Finish setup's harden
     * sets to its own project alone by this id, else {@link keyOf}.
     */
    readonly keyFor: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<string | null, StructureRefused | SqlError | ZeropsError>;
  }
>()("@t3tools/hq/mateCredentials") {}

/** An enrollment's verdict: issued, with the service the Mate's record names after it; or refused. */
export type EnrollmentVerdict =
  | { readonly kind: "issue"; readonly pin: string | null }
  | { readonly kind: "refuse" };

/**
 * One Mate per project (audit D2): its record names its zcp service, and no other service of the
 * project takes its credential. `pinned` is the service the record names, none before its first
 * enrollment that names one; `claim` the service the enrolling zcp names, none from an older zcp;
 * `holder` the service the project's live credential was issued to, null for an older zcp's and
 * undefined when none is live; `pinnedGone`, Zerops no longer has the recorded service, whose place
 * the enrolling one then takes. An older zcp is enrolled as before, unless it would revoke the
 * credential of the Mate the record names.
 */
export function enrollmentVerdict(input: {
  readonly pinned: string | null;
  readonly claim: string | undefined;
  readonly holder: string | null | undefined;
  readonly pinnedGone: boolean;
}): EnrollmentVerdict {
  const { pinned, claim, holder, pinnedGone } = input;
  if (pinned === null || claim === pinned) return { kind: "issue", pin: claim ?? pinned };
  if (pinnedGone) return { kind: "issue", pin: claim ?? null };
  if (claim !== undefined || holder === pinned) return { kind: "refuse" };
  return { kind: "issue", pin: pinned };
}

const CHALLENGE_TTL = Duration.minutes(2);

/** A service's statuses on its way out: its delete under way, or done. */
const GONE_SERVICE_STATUSES: ReadonlySet<string> = new Set(["DELETING", "DELETED"]);

const hashOf = (secret: string) => NodeCrypto.createHash("sha256").update(secret).digest("hex");

const secret = () => NodeCrypto.randomBytes(32).toString("base64url");

export const mateCredentialsLayer = (options: {
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
}): Layer.Layer<MateCredentials, never, Leader | Roles | SqlClient.SqlClient | ZeropsApi> =>
  Layer.effect(
    MateCredentials,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const sql = yield* SqlClient.SqlClient;
      const api = yield* ZeropsApi;
      const roles = yield* Roles;
      const own = Effect.fromOption(options.credential).pipe(
        Effect.mapError(
          () =>
            new ZeropsRefused({
              operation: "mate",
              reason: "unauthorized",
              status: 0,
              code: "noCredential",
            }),
        ),
      );
      /** `read` as HQ's credential; the platform's no about the project is the Mate's refusal. */
      const ofProject = <A>(
        read: (credential: Redacted.Redacted) => Effect.Effect<A, ZeropsError>,
      ) =>
        Effect.flatMap(own, read).pipe(
          Effect.catchTag(
            "ZeropsRefused",
            (error): Effect.Effect<never, MateRefused | ZeropsRefused> =>
              error.reason === "not_found"
                ? Effect.fail(new MateRefused({ code: "project_gone" }))
                : error.reason === "forbidden"
                  ? Effect.fail(new MateRefused({ code: "project_not_in_org" }))
                  : Effect.fail(error),
          ),
        );
      /** Whether HQ holds the project as a Mate now, over the org as a write is decided. */
      const enrollable = (projectId: string) =>
        confirmingRefusal(
          Effect.gen(function* () {
            const decision = can(
              { kind: "mate", projectId },
              "enroll_mate",
              { projectId, held: yield* heldOf(sql, projectId) },
              yield* roles.forWrite,
            );
            if (decision.allow) return;
            return yield* new MateRefused({
              code: decision.reason === "project_gone" ? "project_gone" : "not_a_mate",
            });
          }),
        );
      /**
       * What `keyTokenId` reaches (`mateKeyReach`), read by its id with HQ's own credential: `own`,
       * the Mate's key — never a deploy key, a person's token, nor another Mate's key; `wider`, a
       * Mate's key an earlier client widened, never taken for its key; `none` otherwise. A token
       * Zerops refuses to show HQ, whatever its reason, is none.
       */
      const keyReach = (projectId: string, keyTokenId: string) =>
        Effect.gen(function* () {
          const { orgId } = yield* roles.view;
          const credential = yield* own;
          const grants = api.tokenProjects(orgId, keyTokenId);
          return yield* grants(credential).pipe(
            // The one definition the client's harden shares, so the two never loop.
            Effect.map((projects) => mateKeyReach(projects, projectId)),
            Effect.catchTag("ZeropsRefused", () => Effect.succeed("none" as const)),
          );
        });
      /**
       * HQ's word that the Mate's key reads other projects, from what the key it named reaches:
       * said for a wider key, unsaid for its own; true where the word changed.
       */
      const noteReach = (
        sqlClient: SqlClient.SqlClient,
        projectId: string,
        keyTokenId: string,
        reach: "own" | "wider" | "none",
      ) =>
        reach === "none"
          ? Effect.succeed(false)
          : Effect.map(
              reach === "wider"
                ? sqlClient`
                    UPDATE hq_mate SET key_wider_token_id = ${keyTokenId}
                    WHERE project_id = ${projectId}
                      AND key_wider_token_id IS DISTINCT FROM ${keyTokenId}
                    RETURNING 1`
                : sqlClient`
                    UPDATE hq_mate SET key_wider_token_id = NULL
                    WHERE project_id = ${projectId} AND key_wider_token_id IS NOT NULL
                    RETURNING 1`,
              (rows) => rows.length > 0,
            );
      /**
       * The Mate of the project as HQ holds it ({@link enrollmentVerdict}): the zcp service its
       * record names, and the one its live credential was issued to.
       */
      const standingOf = (projectId: string) =>
        Effect.map(
          sql<{
            readonly pinned: string | null;
            readonly holder: string | null;
            readonly live: boolean;
          }>`
            SELECT (SELECT service_id FROM hq_mate WHERE project_id = ${projectId}) AS pinned,
              credential.service_id AS holder, credential.project_id IS NOT NULL AS live
            FROM (SELECT 1) AS one
            LEFT JOIN hq_mate_credential AS credential
              ON credential.project_id = ${projectId} AND credential.revoked_at IS NULL`,
          ([row]) => ({
            pinned: row?.pinned ?? null,
            holder: row?.live === true ? row.holder : undefined,
          }),
        );
      /**
       * Whether Zerops no longer has the service, read by its id with HQ's own credential: its
       * record being deleted, or its "not found" once it is; Zerops not answering is HQ's to try
       * again.
       */
      const serviceGone = (serviceId: string) =>
        Effect.flatMap(own, (credential) => api.service(serviceId)(credential)).pipe(
          Effect.map((service) => GONE_SERVICE_STATUSES.has(service.status)),
          Effect.catchTag("ZeropsRefused", (error) => Effect.succeed(error.reason === "not_found")),
        );
      const keyOf = (projectId: string) =>
        Effect.map(
          sql<{ readonly key_token_id: string | null }>`
            SELECT key_token_id FROM hq_mate_credential
            WHERE project_id = ${projectId} AND revoked_at IS NULL`,
          (rows) => rows[0]?.key_token_id ?? null,
        );
      return MateCredentials.of({
        challenge: (projectId) =>
          Effect.gen(function* () {
            yield* enrollable(projectId);
            const nonce = secret();
            yield* leader.write(
              Effect.andThen(
                sql`DELETE FROM hq_mate_challenge WHERE expires_at < now() - interval '10 minutes'`,
                sql`
                  INSERT INTO hq_mate_challenge (nonce_hash, project_id, expires_at)
                  VALUES (${hashOf(nonce)}, ${projectId},
                    now() + ${`${String(Duration.toMillis(CHALLENGE_TTL))} milliseconds`}::interval)`,
              ),
            );
            return { nonce, expiresIn: Duration.toSeconds(CHALLENGE_TTL) };
          }),
        issue: (projectId, nonce, { keyTokenId, serviceId } = {}) =>
          Effect.gen(function* () {
            const nonceHash = hashOf(nonce);
            const [challenge] = yield* sql<{ readonly live: boolean }>`
              SELECT expires_at > now() AS live FROM hq_mate_challenge
              WHERE nonce_hash = ${nonceHash} AND project_id = ${projectId} AND used_at IS NULL`;
            if (challenge === undefined) return yield* new MateRefused({ code: "unknown_nonce" });
            if (!challenge.live) return yield* new MateRefused({ code: "expired" });
            yield* enrollable(projectId);
            const env = yield* ofProject(api.projectEnv(projectId));
            if (env.get(CHALLENGE_ENV) !== nonce) {
              return yield* new MateRefused({ code: "env_mismatch" });
            }
            // Decided first on the Mate as HQ holds it, so a refusal writes nothing — and only once
            // Zerops still has the service its record names.
            const standing = yield* standingOf(projectId);
            const pinnedGone =
              standing.pinned !== null &&
              enrollmentVerdict({ ...standing, claim: serviceId, pinnedGone: false }).kind ===
                "refuse" &&
              (yield* serviceGone(standing.pinned));
            if (
              enrollmentVerdict({ ...standing, claim: serviceId, pinnedGone }).kind === "refuse"
            ) {
              return yield* new MateRefused({ code: "not_this_projects_mate" });
            }
            // A key id its Mate names is kept only where it names the Mate's own key; the
            // enrollment goes on without it otherwise, and Zerops not answering keeps none. A key
            // an earlier client widened is said (`keyWider`), and never kept.
            const reach =
              keyTokenId === undefined
                ? ("none" as const)
                : yield* keyReach(projectId, keyTokenId).pipe(
                    Effect.catchTag("ZeropsUnavailable", () => Effect.succeed("none" as const)),
                  );
            const namedKey = reach === "own" ? keyTokenId : undefined;
            let keyWiderMoved = false;
            const credential = secret();
            // The nonce is spent in the transaction that issues: of two presentations racing, one
            // finds it already spent. Enrollments of one project are decided one after another,
            // each on the Mate as the one before left it.
            const issued = yield* leader.write(
              Effect.gen(function* () {
                yield* lockProject(sql, projectId);
                const spent = yield* sql`
                  UPDATE hq_mate_challenge SET used_at = now()
                  WHERE nonce_hash = ${nonceHash} AND used_at IS NULL AND expires_at > now()
                  RETURNING 1`;
                if (spent.length === 0) return false;
                const now = yield* standingOf(projectId);
                const verdict = enrollmentVerdict({
                  ...now,
                  claim: serviceId,
                  pinnedGone: pinnedGone && now.pinned === standing.pinned,
                });
                if (verdict.kind === "refuse") {
                  return yield* new MateRefused({ code: "not_this_projects_mate" });
                }
                yield* sql`
                  UPDATE hq_mate SET service_id = ${verdict.pin}
                  WHERE project_id = ${projectId} AND service_id IS DISTINCT FROM ${verdict.pin}`;
                const [before] = yield* sql<{ readonly key_token_id: string | null }>`
                  UPDATE hq_mate_credential SET revoked_at = now()
                  WHERE project_id = ${projectId} AND revoked_at IS NULL
                  RETURNING key_token_id`;
                yield* sql`
                  INSERT INTO hq_mate_credential
                    (credential_hash, project_id, key_token_id, service_id)
                  VALUES (${hashOf(credential)}, ${projectId},
                    ${namedKey ?? before?.key_token_id ?? null}, ${serviceId ?? null})`;
                if (keyTokenId !== undefined) {
                  keyWiderMoved = yield* noteReach(sql, projectId, keyTokenId, reach);
                }
                return true;
              }),
            );
            if (!issued) return yield* new MateRefused({ code: "unknown_nonce" });
            return { credential, keyWiderMoved };
          }),
        keepKey: (credential, keyTokenId) =>
          Effect.gen(function* () {
            const [held] = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_mate_credential
              WHERE credential_hash = ${hashOf(credential)} AND revoked_at IS NULL`;
            if (held === undefined) {
              return yield* new MateRefused({ code: "mate_credential_required" });
            }
            const reach = yield* keyReach(held.project_id, keyTokenId);
            // A key an earlier client widened is said (`keyWider`), and never kept as its key.
            const moved = yield* leader.write(noteReach(sql, held.project_id, keyTokenId, reach));
            // The structure shows the word on its next read: a refusal pushes nothing.
            if (reach !== "own") return yield* new MateRefused({ code: "key_not_its_own" });
            const kept = yield* leader.write(sql`
              UPDATE hq_mate_credential SET key_token_id = ${keyTokenId}
              WHERE credential_hash = ${hashOf(credential)} AND revoked_at IS NULL
              RETURNING 1`);
            if (kept.length === 0) {
              return yield* new MateRefused({ code: "mate_credential_required" });
            }
            return moved;
          }),
        keyOf,
        keyWider: (projectId) =>
          Effect.map(
            sql<{ readonly wider: boolean }>`
              SELECT key_wider_token_id IS NOT NULL AS wider FROM hq_mate
              WHERE project_id = ${projectId}`,
            (rows) => rows[0]?.wider === true,
          ),
        recheckKey: (userId, projectId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              const decision = can(
                { kind: "person", userId },
                "edit_mate_record",
                { projectId, held: yield* heldOf(sql, projectId) },
                yield* roles.forWrite,
              );
              if (!decision.allow) {
                return yield* new StructureRefused({ code: "forbidden", reason: decision.reason });
              }
              const [row] = yield* sql<{ readonly key: string | null }>`
                SELECT key_wider_token_id AS key FROM hq_mate WHERE project_id = ${projectId}`;
              const wider = row?.key ?? null;
              if (wider === null) return false;
              // Only a positive reading of it narrow clears the word: a key now writing
              // elsewhere, gone, or refused keeps it, and Zerops not answering fails the call.
              const reach = yield* keyReach(projectId, wider);
              if (reach !== "own") return false;
              return yield* leader.write(
                Effect.gen(function* () {
                  // Its own key now: kept as the Mate's where its live credential names none.
                  yield* sql`
                    UPDATE hq_mate_credential SET key_token_id = ${wider}
                    WHERE project_id = ${projectId} AND revoked_at IS NULL
                      AND key_token_id IS NULL`;
                  const cleared = yield* sql`
                    UPDATE hq_mate SET key_wider_token_id = NULL
                    WHERE project_id = ${projectId} AND key_wider_token_id = ${wider}
                    RETURNING 1`;
                  return cleared.length > 0;
                }),
              );
            }),
          ),
        keyFor: (userId, projectId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              const decision = can(
                { kind: "person", userId },
                "edit_mate_record",
                { projectId, held: yield* heldOf(sql, projectId) },
                yield* roles.forWrite,
              );
              if (!decision.allow) {
                return yield* new StructureRefused({ code: "forbidden", reason: decision.reason });
              }
              const [row] = yield* sql<{ readonly key: string | null }>`
                SELECT key_wider_token_id AS key FROM hq_mate WHERE project_id = ${projectId}`;
              return row?.key ?? (yield* keyOf(projectId));
            }),
          ),
        whoami: (credential) =>
          sql<{ readonly project_id: string }>`
            SELECT project_id FROM hq_mate_credential
            WHERE credential_hash = ${hashOf(credential)} AND revoked_at IS NULL`.pipe(
            Effect.map((rows) =>
              Option.map(Option.fromNullishOr(rows[0]), (row) => ({ projectId: row.project_id })),
            ),
          ),
      });
    }),
  );
