// @effect-diagnostics nodeBuiltinImport:off -- a session token is 256 bits from the system's CSPRNG.
/**
 * HQ's own sessions, issued at its door to a person it proved (`door.ts`). The token is 256 random
 * bits; HQ keeps only its SHA-256, so its database leaks no usable session. A session lasts 12
 * hours and can be revoked. A door token opens one session: its id is recorded in the same
 * transaction, so a replayed throwaway is refused. Issuing and revoking are writes, fenced by the
 * leader.
 *
 * @module sessions
 */
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { DoorRefused } from "./door.ts";
import { Leader, type NotLeader } from "./leader.ts";

export interface Principal {
  readonly userId: string;
  readonly orgId: string;
}

export class Sessions extends Context.Service<
  Sessions,
  {
    readonly issue: (
      principal: Principal,
      doorTokenId: string,
    ) => Effect.Effect<
      { readonly token: string; readonly expiresAt: string },
      DoorRefused | NotLeader | SqlError
    >;
    /** The holder of a live session; none for an unknown, expired or revoked token. */
    readonly resolve: (token: string) => Effect.Effect<Option.Option<Principal>, SqlError>;
    readonly revoke: (token: string) => Effect.Effect<void, NotLeader | SqlError>;
  }
>()("@t3tools/hq/sessions") {}

const hashOf = (token: string) => NodeCrypto.createHash("sha256").update(token).digest("hex");

export const sessionsLayer: Layer.Layer<Sessions, never, Leader | SqlClient.SqlClient> =
  Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const sql = yield* SqlClient.SqlClient;
      return Sessions.of({
        issue: (principal, doorTokenId) =>
          Effect.gen(function* () {
            const token = NodeCrypto.randomBytes(32).toString("base64url");
            const rows = yield* leader
              .write(
                Effect.andThen(
                  Effect.andThen(
                    sql`DELETE FROM hq_door_used WHERE used_at < now() - interval '10 minutes'`,
                    sql`INSERT INTO hq_door_used (token_id) VALUES (${doorTokenId})`,
                  ),
                  sql<{ readonly expires_at: string }>`
                    INSERT INTO hq_session (token_hash, user_id, org_id, expires_at)
                    VALUES (${hashOf(token)}, ${principal.userId}, ${principal.orgId}, now() + interval '12 hours')
                    RETURNING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`,
                ),
              )
              .pipe(
                Effect.catchIf(
                  (error) => error._tag === "SqlError" && error.reason._tag === "UniqueViolation",
                  () => Effect.fail(new DoorRefused({ rule: "replayed" })),
                ),
              );
            // `INSERT … RETURNING` answers the row it inserted, or fails.
            return { token, expiresAt: rows[0]!.expires_at };
          }),
        resolve: (token) =>
          sql<{ readonly user_id: string; readonly org_id: string }>`
            SELECT user_id, org_id FROM hq_session
            WHERE token_hash = ${hashOf(token)} AND revoked_at IS NULL AND expires_at > now()`.pipe(
            Effect.map((rows) =>
              Option.map(Option.fromNullishOr(rows[0]), (row) => ({
                userId: row.user_id,
                orgId: row.org_id,
              })),
            ),
          ),
        revoke: (token) =>
          leader.write(sql`
            UPDATE hq_session SET revoked_at = now()
            WHERE token_hash = ${hashOf(token)} AND revoked_at IS NULL`),
      });
    }),
  );
