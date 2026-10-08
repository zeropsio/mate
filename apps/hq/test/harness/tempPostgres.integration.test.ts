import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { treeMigrations } from "../../src/migrationFiles.ts";
import { migrate } from "../../src/migrations.ts";
import { TempPostgres, tempPostgresLayer } from "./tempPostgres.ts";

it.effect("independent test files use isolated databases on the same host server", () =>
  Effect.gen(function* () {
    const first = yield* (yield* TempPostgres).createDatabase;
    yield* Effect.gen(function* () {
      const second = yield* (yield* TempPostgres).createDatabase;
      assert.notEqual(first, second);
      assert.equal(new URL(first).port, new URL(second).port);
    }).pipe(Effect.provide(Layer.fresh(tempPostgresLayer)));
  }).pipe(Effect.provide(Layer.fresh(tempPostgresLayer))),
);

// Decision: no test weakened; only setup cost changes.
it.effect(
  "migrated fixture clones preserve the ledger and baseline rows while isolating writes",
  () =>
    Effect.gen(function* () {
      const postgres = yield* TempPostgres;
      const [first, second] = yield* Effect.all(
        [postgres.createMigratedDatabase, postgres.createMigratedDatabase],
        { concurrency: "unbounded" },
      );
      assert.notEqual(first, second);
      const inspect = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepEqual(yield* migrate(treeMigrations()), []);
        assert.deepEqual(yield* sql`SELECT epoch::text FROM hq_leader`, [{ epoch: "0" }]);
        assert.deepEqual(yield* sql`SELECT recovery FROM hq_usage_state`, [
          { recovery: "verified" },
        ]);
        assert.deepEqual(yield* sql`SELECT name FROM hq_app`, []);
      });
      yield* inspect.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(first) })));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO hq_app (name, created_by) VALUES ('private', 'test')`;
        yield* sql`UPDATE hq_leader SET epoch = 17`;
      }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(first) })));
      yield* inspect.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(second) })));
      const third = yield* postgres.createMigratedDatabase;
      yield* inspect.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(third) })));
      yield* Effect.gen(function* () {
        const independent = yield* (yield* TempPostgres).createMigratedDatabase;
        assert.notEqual(first, independent);
        yield* inspect.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(independent) })));
      }).pipe(Effect.provide(Layer.fresh(tempPostgresLayer)));
      const empty = yield* postgres.createDatabase;
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        assert.deepEqual(yield* sql`SELECT to_regclass('hq_migration')::text AS ledger`, [
          { ledger: null },
        ]);
      }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(empty) })));
    }).pipe(Effect.provide(Layer.fresh(tempPostgresLayer))),
);
