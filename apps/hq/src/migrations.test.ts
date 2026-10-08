import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { MIGRATIONS_TABLE, migrate } from "./migrations.ts";

/** A pool on a fresh database of the file's cluster. */
const withSql = <A, E>(use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    return yield* use.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
  });

const recorded = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM ${sql(MIGRATIONS_TABLE)} ORDER BY name`;
  return rows.map((row) => row.name);
});

const tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'm_%' ORDER BY 1`;
  return rows.map((row) => row.name);
});

describe("migrate", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "applies the files in name order, several statements each, and records every one",
      () =>
        withSql(
          Effect.gen(function* () {
            const applied = yield* migrate([
              {
                name: "0002_b.sql",
                sql: "CREATE TABLE m_b (id int REFERENCES m_a);\nINSERT INTO m_a VALUES (1);",
              },
              { name: "0001_a.sql", sql: "CREATE TABLE m_a (id int PRIMARY KEY);" },
            ]);
            assert.deepStrictEqual(applied, ["0001_a.sql", "0002_b.sql"]);
            assert.deepStrictEqual(yield* recorded, ["0001_a.sql", "0002_b.sql"]);
            assert.deepStrictEqual(yield* tables, ["m_a", "m_b"]);
          }),
        ),
    );

    it.effect("applies only the files it has not recorded", () =>
      withSql(
        Effect.gen(function* () {
          const first = { name: "0001_a.sql", sql: "CREATE TABLE m_a (id int);" };
          yield* migrate([first]);
          const applied = yield* migrate([
            first,
            { name: "0002_b.sql", sql: "CREATE TABLE m_b (id int);" },
          ]);
          assert.deepStrictEqual(applied, ["0002_b.sql"]);
          assert.deepStrictEqual(yield* migrate([first]), []);
          assert.deepStrictEqual(yield* recorded, ["0001_a.sql", "0002_b.sql"]);
        }),
      ),
    );

    it.effect("rolls a failing file back whole, keeps the files before it, and names it", () =>
      withSql(
        Effect.gen(function* () {
          const error = yield* migrate([
            { name: "0001_a.sql", sql: "CREATE TABLE m_a (id int);" },
            { name: "0002_b.sql", sql: "CREATE TABLE m_b (id int);\nSELECT * FROM m_missing;" },
            { name: "0003_c.sql", sql: "CREATE TABLE m_c (id int);" },
          ]).pipe(Effect.flip);
          assert.strictEqual(error._tag, "MigrationError");
          assert.strictEqual(error.migration, "0002_b.sql");
          assert.deepStrictEqual(yield* recorded, ["0001_a.sql"]);
          assert.deepStrictEqual(yield* tables, ["m_a"]);
        }),
      ),
    );

    // The migration from main ran once, before the switch; its tables go with its code.
    it.effect(
      "keeps a change described before drafts existed asking, and an undescribed one a draft",
      () =>
        withSql(
          Effect.gen(function* () {
            const all = treeMigrations();
            const at = all.findIndex((file) => file.name.startsWith("0043_"));
            yield* migrate(all.slice(0, at));
            const sql = yield* SqlClient.SqlClient;
            const head = "a".repeat(40);
            yield* sql`INSERT INTO hq_app (id, name, created_by)
            VALUES ('00000000-0000-0000-0000-000000000001', 'Shop', 'owner')`;
            yield* sql`INSERT INTO hq_repo (app_id, name, created_by)
            VALUES ('00000000-0000-0000-0000-000000000001', 'appdev', 'owner')`;
            for (const [number, body] of [
              [1, "It adds a login page."],
              [2, ""],
              [3, "  "],
            ] as const) {
              yield* sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, body, state, head)
              VALUES ('00000000-0000-0000-0000-000000000001', 'appdev', ${number}, 'P_MATE',
                'The task', ${body}, 'closed', ${head})`;
            }
            yield* migrate(all);
            const rows = yield* sql<{ readonly number: number; readonly ready: boolean }>`
            SELECT number, COALESCE(ready_head = head, false) AS ready FROM hq_change ORDER BY number`;
            assert.deepStrictEqual(
              rows.map((row) => [row.number, row.ready]),
              [
                [1, true],
                [2, false],
                [3, false],
              ],
            );
          }),
        ),
    );

    it.effect("leaves none of the migration from main's tables", () =>
      withSql(
        Effect.gen(function* () {
          yield* migrate(treeMigrations());
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{ readonly name: string }>`
            SELECT table_name AS name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name LIKE 'hq\\_import%' ORDER BY 1`;
          assert.deepStrictEqual(
            rows.map((row) => row.name),
            [],
          );
        }),
      ),
    );
  });
});
