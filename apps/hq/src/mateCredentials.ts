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
 * @module mateCredentials
 */
import * as NodeCrypto from "node:crypto";

import { can } from "@t3tools/shared/zeropsPermissions";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { heldOf } from "./held.ts";
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
     * its container holds, as the Mate names it — else the one its credential before named.
     */
    readonly issue: (
      projectId: string,
      nonce: string,
      keyTokenId?: string,
    ) => Effect.Effect<
      { readonly credential: string },
      MateRefused | NotLeader | SqlError | ZeropsError
    >;
    /** The project a live credential is bound to; none for an unknown or revoked one. */
    readonly whoami: (
      credential: string,
    ) => Effect.Effect<Option.Option<{ readonly projectId: string }>, SqlError>;
    /** The id of the key its container holds, as the Mate of a live `credential` names it now. */
    readonly keepKey: (
      credential: string,
      keyTokenId: string,
    ) => Effect.Effect<void, MateRefused | NotLeader | SqlError>;
    /** The id of the key the Mate of `projectId` named with its live credential; none unnamed. */
    readonly keyOf: (projectId: string) => Effect.Effect<string | null, SqlError>;
    /**
     * {@link keyOf}, told to the person `userId` where they administer the Mate's project — who
     * adopts it, or deletes it (`edit_mate_record`'s rule).
     */
    readonly keyFor: (
      userId: string,
      projectId: string,
    ) => Effect.Effect<string | null, StructureRefused | SqlError | ZeropsError>;
  }
>()("@t3tools/hq/mateCredentials") {}

const CHALLENGE_TTL = Duration.minutes(2);

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
        issue: (projectId, nonce, keyTokenId) =>
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
            const credential = secret();
            // The nonce is spent in the transaction that issues: of two presentations racing, one
            // finds it already spent.
            const issued = yield* leader.write(
              Effect.gen(function* () {
                const spent = yield* sql`
                  UPDATE hq_mate_challenge SET used_at = now()
                  WHERE nonce_hash = ${nonceHash} AND used_at IS NULL AND expires_at > now()
                  RETURNING 1`;
                if (spent.length === 0) return false;
                const [before] = yield* sql<{ readonly key_token_id: string | null }>`
                  UPDATE hq_mate_credential SET revoked_at = now()
                  WHERE project_id = ${projectId} AND revoked_at IS NULL
                  RETURNING key_token_id`;
                yield* sql`
                  INSERT INTO hq_mate_credential (credential_hash, project_id, key_token_id)
                  VALUES (${hashOf(credential)}, ${projectId},
                    ${keyTokenId ?? before?.key_token_id ?? null})`;
                return true;
              }),
            );
            if (!issued) return yield* new MateRefused({ code: "unknown_nonce" });
            return { credential };
          }),
        keepKey: (credential, keyTokenId) =>
          Effect.gen(function* () {
            const kept = yield* leader.write(sql`
              UPDATE hq_mate_credential SET key_token_id = ${keyTokenId}
              WHERE credential_hash = ${hashOf(credential)} AND revoked_at IS NULL
              RETURNING 1`);
            if (kept.length === 0) {
              return yield* new MateRefused({ code: "mate_credential_required" });
            }
          }),
        keyOf,
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
              return yield* keyOf(projectId);
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
