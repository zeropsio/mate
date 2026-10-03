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

import { sessionFor, startCore, ticketFor, untilHealth } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { Backup, type BackupStatus } from "./backup.ts";
import { healthRoute } from "./health.ts";
import { Leader, type LeaderStatus } from "./leader.ts";
import { LoopWatch, type LoopStatus } from "./loopWatch.ts";
import { Official, type OfficialStatus } from "./official.ts";
import { Recomputes } from "./recomputes.ts";

const QUIET: LoopStatus = { maxLagMs: 0, p99LagMs: 0, lastStall: null };

/**
 * `GET /health` for a leader in `status` and the official verdict, over a pool on `databaseUrl`;
 * the event loop's watch as `loop`, the structure's recomputes of the last minute `recomputes`.
 */
const getHealth = (
  status: LeaderStatus,
  official: OfficialStatus["official"],
  databaseUrl: string,
  held: string | null = null,
  backup: BackupStatus = { state: "off" },
  loop: LoopStatus = QUIET,
  recomputes = 0,
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
            lastOk: Effect.undefined,
            inherit: () => Effect.void,
          }),
          Layer.succeed(Backup, { take: Effect.die("no sets"), status: Effect.succeed(backup) }),
          Layer.succeed(LoopWatch, { status: Effect.succeed(loop) }),
          Layer.succeed(Recomputes, { count: Effect.void, lastMinute: Effect.succeed(recomputes) }),
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
              loop: QUIET,
              recomputes: 0,
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
              loop: QUIET,
              recomputes: 0,
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
          [
            200,
            {
              state: "active",
              official: "ok",
              db: "up",
              backup,
              loop: QUIET,
              recomputes: 0,
              epoch: 3,
              build: "b1",
            },
          ],
        );
      }),
    );

    // F22 (2026-10-03): /health answered after 52.7 s with 40 GETs, the event loop not running.
    // What it measures since is reported, never judged.
    it.effect(
      "reports the event loop's watch and the structure's recomputes, and still answers 200",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const loop: LoopStatus = {
            maxLagMs: 52_700,
            p99LagMs: 40,
            lastStall: {
              at: "2026-10-03T08:38:29.240Z",
              lateMs: 51_700,
              cpuMs: 30,
              longestWriteMs: 51_650,
            },
          };
          const response = yield* getHealth(
            { state: "active", epoch: 3 },
            "ok",
            url,
            null,
            { state: "off" },
            loop,
            480,
          );
          assert.deepStrictEqual(
            [response.status, response.body],
            [
              200,
              {
                state: "active",
                official: "ok",
                db: "up",
                backup: { state: "off" },
                loop,
                recomputes: 480,
                epoch: 3,
                build: "b1",
              },
            ],
          );
        }),
    );

    it.effect("counts a structure socket's views in a running Core, beside its loop's watch", () =>
      Effect.gen(function* () {
        const { call, socket } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const watching = yield* socket(`/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`);
        yield* watching.next("snapshot");
        const health = (yield* call("GET", "/health")).body as {
          readonly loop: LoopStatus;
          readonly recomputes: number;
        };
        yield* watching.close;
        assert.deepStrictEqual(Object.keys(health.loop), ["maxLagMs", "p99LagMs", "lastStall"]);
        assert.isAtLeast(health.recomputes, 1);
      }),
    );
  });
});
