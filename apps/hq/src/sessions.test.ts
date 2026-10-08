import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { DoorRefused } from "./door.ts";
import { Sessions, sessionsLayer } from "./sessions.ts";

const withSessions = <A, E>(use: Effect.Effect<A, E, Sessions | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const context = yield* Layer.build(
      sessionsLayer.pipe(Layer.provideMerge(activeCoreLayer(url))),
    );
    return yield* Effect.andThen(untilActive, use).pipe(Effect.provide(context));
  });

const PRINCIPAL = { userId: "U1", orgId: "ORG" };
let doorTokens = 0;

describe("sessions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "issues a 256-bit token, keeps only its hash, and knows its holder for 12 hours",
      () =>
        withSessions(
          Effect.gen(function* () {
            const sessions = yield* Sessions;
            const sql = yield* SqlClient.SqlClient;
            const issued = yield* sessions.issue(PRINCIPAL, `door-${String(++doorTokens)}`);
            assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/u);
            assert.deepStrictEqual(yield* sessions.resolve(issued.token), Option.some(PRINCIPAL));
            assert.deepStrictEqual(yield* sessions.resolve(`${issued.token}x`), Option.none());

            const [row] = yield* sql<{ readonly token_hash: string; readonly hours: string }>`
            SELECT token_hash, extract(epoch FROM expires_at - created_at) / 3600 AS hours
            FROM hq_session`;
            assert.notInclude(row?.token_hash ?? "", issued.token);
            assert.strictEqual(row?.token_hash.length, 64);
            assert.strictEqual(Number(row?.hours), 12);
          }),
        ),
    );

    it.effect("forgets a revoked or expired session", () =>
      withSessions(
        Effect.gen(function* () {
          const sessions = yield* Sessions;
          const sql = yield* SqlClient.SqlClient;
          const revoked = yield* sessions.issue(PRINCIPAL, `door-${String(++doorTokens)}`);
          yield* sessions.revoke(revoked.token);
          assert.deepStrictEqual(yield* sessions.resolve(revoked.token), Option.none());

          const expired = yield* sessions.issue(PRINCIPAL, `door-${String(++doorTokens)}`);
          yield* sql`UPDATE hq_session SET expires_at = now() - interval '1 second'`;
          assert.deepStrictEqual(yield* sessions.resolve(expired.token), Option.none());
        }),
      ),
    );

    it.effect(
      "opens one session per door token: a replay is refused, a used token forgotten after 10 minutes",
      () =>
        withSessions(
          Effect.gen(function* () {
            const sessions = yield* Sessions;
            const sql = yield* SqlClient.SqlClient;
            yield* sessions.issue(PRINCIPAL, "T-once");
            const replay = yield* Effect.flip(sessions.issue(PRINCIPAL, "T-once"));
            assert.deepStrictEqual(replay, new DoorRefused({ rule: "replayed" }));
            assert.strictEqual((yield* sql`SELECT 1 FROM hq_session`).length, 1);

            yield* sql`UPDATE hq_door_used SET used_at = now() - interval '11 minutes'`;
            yield* sessions.issue(PRINCIPAL, "T-next");
            const used = yield* sql<{
              readonly token_id: string;
            }>`SELECT token_id FROM hq_door_used`;
            assert.deepStrictEqual(
              used.map((row) => row.token_id),
              ["T-next"],
            );
          }),
        ),
    );
  });
});
