import * as PgClient from "@effect/sql-pg/PgClient";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { LOCK_KEY, Leader, type LeaderStatus, NotLeader, leaderLayer } from "./leader.ts";
import { type Migration, MIGRATIONS_TABLE } from "./migrations.ts";
import { Official } from "./official.ts";
import { treeMigrations } from "./migrationFiles.ts";

const FAST = {
  heartbeat: Duration.millis(100),
  heartbeatTimeout: Duration.seconds(1),
  retryAfter: Duration.millis(100),
};

/**
 * One Core instance's leader over `url`, stopped by closing its own scope. It is the official HQ
 * while `allowed` holds (always, unless a test passes its own).
 */
const startInstance = (
  url: string,
  migrations: ReadonlyArray<Migration> = treeMigrations(),
  allowed?: Ref.Ref<boolean>,
) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const databaseUrl = Redacted.make(url);
    const official = Official.of({
      status: Effect.map(allowed === undefined ? Effect.succeed(true) : Ref.get(allowed), (ok) => ({
        official: ok ? "ok" : "anchor_missing",
        allowed: ok,
      })),
    });
    const context = yield* Layer.buildWithScope(
      leaderLayer({ databaseUrl, migrations, ...FAST }).pipe(
        Layer.provideMerge(PgClient.layer({ url: databaseUrl })),
        Layer.provide(Layer.succeed(Official, official)),
      ),
      scope,
    );
    return {
      leader: Context.get(context, Leader),
      sql: Context.get(context, SqlClient.SqlClient),
      stop: Scope.close(scope, Exit.void),
    };
  });

/** Polls the status until `matches` holds; fails the test after ten seconds. */
const statusWhere = (leader: Leader["Service"], matches: (status: LeaderStatus) => boolean) =>
  leader.status.pipe(
    Effect.filterOrFail(matches),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );

/** Every distinct state the leader reports over about half a second, read every 5 ms. */
const statesSeen = (leader: Leader["Service"]) =>
  Effect.forEach(Array.from({ length: 100 }), () =>
    leader.status.pipe(
      Effect.map((status) => status.state),
      Effect.tap(() => Effect.sleep(Duration.millis(5))),
    ),
  ).pipe(Effect.map((states) => [...new Set(states)]));

describe("leaderLayer", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("takes the lock, applies the tree's migrations and leads under epoch 1", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const core = yield* startInstance(url);
        const status = yield* statusWhere(core.leader, (status) => status.state === "active");
        assert.deepStrictEqual(status, { state: "active", epoch: 1 });

        const [row] = yield* core.sql<{ readonly epoch: string }>`SELECT epoch FROM hq_leader`;
        assert.strictEqual(String(row?.epoch), "1");
        const recorded = yield* core.sql<{ readonly name: string }>`
          SELECT name FROM ${core.sql(MIGRATIONS_TABLE)} ORDER BY name`;
        assert.deepStrictEqual(
          recorded.map((row) => row.name),
          treeMigrations().map((file) => file.name),
        );
        yield* core.stop;
      }),
    );

    it.effect(
      "waits as a standby while another instance leads, and takes over under epoch 2 when it stops",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const old = yield* startInstance(url);
          yield* statusWhere(old.leader, (status) => status.state === "active");
          const next = yield* startInstance(url);
          yield* statusWhere(next.leader, (status) => status.state === "standby");
          yield* Effect.sleep(Duration.millis(500));
          assert.deepStrictEqual(yield* next.leader.status, { state: "standby", epoch: null });
          assert.deepStrictEqual(yield* old.leader.status, { state: "active", epoch: 1 });

          yield* old.stop;
          const status = yield* statusWhere(next.leader, (status) => status.state === "active");
          assert.deepStrictEqual(status, { state: "active", epoch: 2 });
          yield* next.stop;
        }),
    );

    it.effect(
      "falls back to standby when its lock session is killed, and leads again once the lock is free",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const core = yield* startInstance(url);
          yield* statusWhere(core.leader, (status) => status.state === "active");

          // Another session takes the lock the moment the holder's backend is gone.
          const rival = yield* Scope.make();
          const other = yield* PgConnection.make({ url: Redacted.make(url) }).pipe(
            Scope.provide(rival),
          );
          yield* other.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'hq-leader'",
          );
          yield* other.query(`SELECT pg_advisory_lock(${String(LOCK_KEY)})`);
          const standby = yield* statusWhere(core.leader, (status) => status.state === "standby");
          assert.deepStrictEqual(standby, { state: "standby", epoch: null });

          yield* Scope.close(rival, Exit.void);
          const status = yield* statusWhere(core.leader, (status) => status.state === "active");
          assert.deepStrictEqual(status, { state: "active", epoch: 2 });
          yield* core.stop;
        }),
    );

    it.effect(
      "reports failed while it cannot reach the database, from the start or after leading",
      () =>
        Effect.gen(function* () {
          const postgres = yield* TempPostgres;
          const unreachable = yield* startInstance(yield* postgres.deadUrl);
          assert.deepStrictEqual(
            yield* statusWhere(unreachable.leader, (status) => status.state !== "starting"),
            { state: "failed", epoch: null },
          );
          yield* unreachable.stop;

          const url = yield* postgres.createDatabase;
          const database = new URL(url).pathname.slice(1);
          const core = yield* startInstance(url);
          yield* statusWhere(core.leader, (status) => status.state === "active");
          const admin = yield* PgConnection.make({
            url: Redacted.make(url.replace(/\/\w+$/u, "/postgres")),
          });
          yield* admin.query(`ALTER DATABASE ${database} WITH ALLOW_CONNECTIONS false`);
          yield* admin.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'hq-leader'",
          );
          yield* statusWhere(core.leader, (status) => status.state === "failed");

          yield* admin.query(`ALTER DATABASE ${database} WITH ALLOW_CONNECTIONS true`);
          const status = yield* statusWhere(core.leader, (status) => status.state === "active");
          assert.deepStrictEqual(status, { state: "active", epoch: 2 });
          yield* core.stop;
        }),
    );

    it.effect(
      "stays failed and never leads while a migration fails, and leaves the lock to others",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const broken = yield* startInstance(url, [
            ...treeMigrations(),
            { name: "9999_broken.sql", sql: "SELECT * FROM hq_missing;" },
          ]);
          yield* statusWhere(broken.leader, (status) => status.state === "failed");
          assert.deepStrictEqual(yield* statesSeen(broken.leader), ["failed"]);

          const core = yield* startInstance(url);
          yield* statusWhere(core.leader, (status) => status.state === "active");
          assert.deepStrictEqual(yield* broken.leader.status, { state: "failed", epoch: null });
          yield* broken.stop;
          yield* core.stop;
        }),
    );
    it.effect(
      "competes for the lock only while it is the official HQ, and gives it up when it stops being",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const allowed = yield* Ref.make(false);
          const core = yield* startInstance(url, treeMigrations(), allowed);
          yield* statusWhere(core.leader, (status) => status.state === "standby");
          assert.deepStrictEqual(yield* statesSeen(core.leader), ["standby"]);

          yield* Ref.set(allowed, true);
          assert.deepStrictEqual(
            yield* statusWhere(core.leader, (status) => status.state === "active"),
            { state: "active", epoch: 1 },
          );

          yield* Ref.set(allowed, false);
          yield* statusWhere(core.leader, (status) => status.state === "standby");
          const rival = yield* PgConnection.make({ url: Redacted.make(url) });
          const taken = yield* rival.query(
            `SELECT pg_try_advisory_lock(${String(LOCK_KEY)}) AS taken`,
          );
          assert.strictEqual(taken.rows[0]?.["taken"], true);
          yield* rival.query(`SELECT pg_advisory_unlock(${String(LOCK_KEY)})`);

          yield* Ref.set(allowed, true);
          assert.deepStrictEqual(
            yield* statusWhere(core.leader, (status) => status.state === "active"),
            { state: "active", epoch: 2 },
          );
          yield* core.stop;
        }),
    );
    it.effect(
      "fences every write: none lands once the epoch moved past this instance's, none without the lead",
      () =>
        Effect.gen(function* () {
          const url = yield* (yield* TempPostgres).createDatabase;
          const allowed = yield* Ref.make(false);
          const core = yield* startInstance(url, treeMigrations(), allowed);
          yield* statusWhere(core.leader, (status) => status.state === "standby");
          const write = (name: string) =>
            core.leader.write(
              core.sql`INSERT INTO hq_app (name, created_by) VALUES (${name}, 'U1')`,
            );
          assert.deepStrictEqual(
            yield* Effect.flip(write("before")),
            new NotLeader({ reason: "standby" }),
          );

          yield* Ref.set(allowed, true);
          yield* statusWhere(core.leader, (status) => status.state === "active");
          yield* write("while leading");
          yield* core.sql`UPDATE hq_leader SET epoch = epoch + 1`;
          assert.deepStrictEqual(
            yield* Effect.flip(write("after")),
            new NotLeader({ reason: "fenced" }),
          );
          const names = yield* core.sql<{
            readonly name: string;
          }>`SELECT name FROM hq_app ORDER BY name`;
          assert.deepStrictEqual(
            names.map((row) => row.name),
            ["while leading"],
          );
          yield* core.stop;
        }),
    );
  });
});
