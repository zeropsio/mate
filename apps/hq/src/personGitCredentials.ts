// @effect-diagnostics nodeBuiltinImport:off -- Git passwords use the system CSPRNG; only their digests are durable.
import * as NodeCrypto from "node:crypto";
import type { GitCredential, GitCredentialRecord } from "@t3tools/shared/hqGit";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { Leader, type NotLeader } from "./leader.ts";
import type { Principal } from "./sessions.ts";

export interface GitHolder extends Principal {
  readonly appId: string;
}
export class PersonGitCredentials extends Context.Service<
  PersonGitCredentials,
  {
    readonly issue: (holder: GitHolder) => Effect.Effect<GitCredential, SqlError | NotLeader>;
    readonly resolve: (token: string) => Effect.Effect<Option.Option<GitHolder>, SqlError>;
    readonly list: (
      holder: GitHolder,
    ) => Effect.Effect<ReadonlyArray<GitCredentialRecord>, SqlError>;
    readonly revoke: (holder: GitHolder, id: string) => Effect.Effect<void, SqlError | NotLeader>;
  }
>()("@t3tools/hq/personGitCredentials") {}

const hash = (token: string) => NodeCrypto.createHash("sha256").update(token).digest("hex");
const COLUMNS = `id::text AS id, app_id::text AS "appId", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt", to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "expiresAt"`;
export const personGitCredentialsLayer = Layer.effect(
  PersonGitCredentials,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    return PersonGitCredentials.of({
      issue: (holder) =>
        Effect.gen(function* () {
          const token = NodeCrypto.randomBytes(32).toString("base64url");
          const rows = yield* leader.write(sql<GitCredentialRecord>`
        INSERT INTO hq_git_credential(token_hash, user_id, org_id, app_id, expires_at)
        VALUES (${hash(token)}, ${holder.userId}, ${holder.orgId}, ${holder.appId}, now() + interval '12 hours')
        RETURNING ${sql.literal(COLUMNS)}`);
          return { ...rows[0]!, token };
        }),
      resolve: (token) =>
        sql<{ readonly user_id: string; readonly org_id: string; readonly app_id: string }>`
      SELECT user_id, org_id, app_id::text AS app_id FROM hq_git_credential
      WHERE token_hash=${hash(token)} AND revoked_at IS NULL AND expires_at > now()`.pipe(
          Effect.map((rows) =>
            Option.map(Option.fromNullishOr(rows[0]), (row) => ({
              userId: row.user_id,
              orgId: row.org_id,
              appId: row.app_id,
            })),
          ),
        ),
      list: (
        holder,
      ) => sql<GitCredentialRecord>`SELECT ${sql.literal(COLUMNS)} FROM hq_git_credential
      WHERE user_id=${holder.userId} AND org_id=${holder.orgId} AND app_id::text=${holder.appId}
        AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC, id`,
      revoke: (holder, id) =>
        leader.write(sql`UPDATE hq_git_credential SET revoked_at=now()
      WHERE id::text=${id} AND user_id=${holder.userId} AND org_id=${holder.orgId} AND app_id::text=${holder.appId} AND revoked_at IS NULL`),
    });
  }),
);
