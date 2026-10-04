import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("059_ActivityBudgetColumnsWhereSkipped", (it) => {
  it.effect("migrates a dev database whose 57 was the crew operations table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 56 });
      // A dev build ran the crew operations table as its 57.
      yield* sql`CREATE TABLE crew_operation (id TEXT PRIMARY KEY, crew TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)`;
      yield* sql`CREATE INDEX crew_operation_active ON crew_operation (crew, status)`;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (57, 'CrewOperations')`;

      yield* runMigrations();

      const columns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(projection_thread_activities)`;
      const names = new Set(columns.map((column) => column.name));
      for (const name of ["agent_id", "call_id", "task_id", "used_tokens"]) {
        assert.isTrue(names.has(name), name);
      }
      const crew = yield* sql<{
        readonly name: string;
      }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'crew_operation'`;
      assert.strictEqual(crew.length, 1);
    }),
  );
});
