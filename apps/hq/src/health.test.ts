import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { Backup, type BackupStatus } from "./backup.ts";
import { healthRoute } from "./health.ts";
import { Leader, type LeaderStatus } from "./leader.ts";
import { Official, type OfficialStatus } from "./official.ts";

/** `GET /health` for a leader in `status` and the official verdict, over a pool on `databaseUrl`. */
const getHealth = (
  status: LeaderStatus,
  official: OfficialStatus["official"],
  databaseUrl: string,
  held: string | null = null,
  backup: BackupStatus = { state: "off" },
) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(healthRoute("b1"));
    const response = yield* handler.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("http://hq.test/health")),
      ),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Leader, {
            status: Effect.succeed(status),
            changes: Stream.make(status),
            write: () => Effect.die("no writes"),
            release: Effect.void,
            hold: () => Effect.die("no hold"),
            held: Effect.succeed(held),
          }),
          Layer.succeed(Official, {
            status: Effect.succeed({ official, allowed: official === "ok" }),
          }),
          Layer.succeed(Backup, { take: Effect.die("no sets"), status: Effect.succeed(backup) }),
          PgClient.layer({ url: Redacted.make(databaseUrl), connectTimeout: Duration.seconds(1) }),
        ),
      ),
    );
    const body: unknown = yield* Effect.promise(() => HttpServerResponse.toWeb(response).json());
    return { status: response.status, body, retryAfter: response.headers["retry-after"] };
  }).pipe(Effect.scoped);

const cases: ReadonlyArray<{
  readonly leader: LeaderStatus;
  readonly official: OfficialStatus["official"];
  readonly database: "up" | "down";
  readonly status: number;
}> = [
  { leader: { state: "active", epoch: 3 }, official: "ok", database: "up", status: 200 },
  // A Core that is not the official HQ is a healthy standby: its deploy must pass.
  {
    leader: { state: "standby", epoch: null },
    official: "anchor_missing",
    database: "up",
    status: 200,
  },
  {
    leader: { state: "standby", epoch: null },
    official: "credentials_wrong",
    database: "up",
    status: 200,
  },
  { leader: { state: "starting", epoch: null }, official: "unknown", database: "up", status: 503 },
  {
    leader: { state: "failed", epoch: null },
    official: "anchor_elsewhere",
    database: "down",
    status: 503,
  },
];

describe("GET /health", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const { leader, official, database, status } of cases) {
      it.effect(
        `answers ${String(status)} for ${leader.state}, ${official}, the database ${database}`,
        () =>
          Effect.gen(function* () {
            const postgres = yield* TempPostgres;
            const url =
              database === "up" ? yield* postgres.createDatabase : yield* postgres.deadUrl;
            const response = yield* getHealth(leader, official, url);
            assert.strictEqual(response.status, status);
            // Every 503 HQ answers says when to try again.
            assert.strictEqual(response.retryAfter, status === 503 ? "5" : undefined);
            assert.deepStrictEqual(response.body, {
              state: leader.state,
              official,
              db: database,
              backup: { state: "off" },
              epoch: leader.epoch,
              build: "b1",
            });
          }),
      );
    }

    // A Core holding the lock over records and git that disagree says why (`reconcile.ts`).
    it.effect("names why a held Core serves nothing", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const response = yield* getHealth(
          { state: "failed", epoch: null },
          "ok",
          url,
          "restore_mismatch",
        );
        assert.deepStrictEqual(
          [response.status, response.body],
          [
            503,
            {
              state: "failed",
              reason: "restore_mismatch",
              official: "ok",
              db: "up",
              backup: { state: "off" },
              epoch: null,
              build: "b1",
            },
          ],
        );
      }),
    );

    // Backup is reported, never judged: a readiness check must not fail over a set.
    it.effect("tells a failed backup and still answers 200", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const backup: BackupStatus = {
          state: "failed",
          reason: "pg_dump_older",
          pgDump: 16,
          server: 18,
        };
        const response = yield* getHealth({ state: "active", epoch: 3 }, "ok", url, null, backup);
        assert.deepStrictEqual(
          [response.status, response.body],
          [200, { state: "active", official: "ok", db: "up", backup, epoch: 3, build: "b1" }],
        );
      }),
    );
  });
});
