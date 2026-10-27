import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migrateCrew from "./054_ProjectionThreadsCrew.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("054_ProjectionThreadsCrew", (it) => {
  it.effect("adds the column with existing threads a person's", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      const now = "2026-09-27T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'Existing thread',
          '{"instanceId":"claudeAgent","model":"opus"}', 'full-access', ${now}, ${now}
        )
      `;
      yield* runMigrations({ toMigrationInclusive: 54 });
      const readRow = sql<{ readonly crew: string | null }>`
        SELECT crew_json AS "crew" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
      assert.deepEqual(yield* readRow, [{ crew: null }]);

      // Re-running against a database that already has the column keeps its value.
      const crew = '{"crew":"shop","crewmate":"backend","stint":1}';
      yield* sql`UPDATE projection_threads SET crew_json = ${crew} WHERE thread_id = 'thread-1'`;
      yield* migrateCrew;
      assert.deepEqual(yield* readRow, [{ crew }]);
    }),
  );
});
