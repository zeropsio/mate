import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migrateUsagePause from "./053_ProjectionThreadsUsagePause.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "053_ProjectionThreadsUsagePause",
  (it) => {
    it.effect("adds the columns with existing threads unpaused and resuming by themselves", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 52 });
        const now = "2026-09-26T00:00:00.000Z";
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode,
            created_at, updated_at
          ) VALUES (
            'thread-1', 'project-1', 'Existing thread',
            '{"instanceId":"claudeAgent","model":"opus"}', 'full-access', ${now}, ${now}
          )
        `;
        yield* runMigrations({ toMigrationInclusive: 53 });
        const readRow = sql<{
          readonly usagePause: string | null;
          readonly usageAutoResumeDisabledAt: string | null;
        }>`
          SELECT
            usage_pause_json AS "usagePause",
            usage_auto_resume_disabled_at AS "usageAutoResumeDisabledAt"
          FROM projection_threads
          WHERE thread_id = 'thread-1'
        `;
        assert.deepEqual(yield* readRow, [{ usagePause: null, usageAutoResumeDisabledAt: null }]);

        // Re-running against a database that already has the columns keeps their values.
        const pause = '{"resetsAt":"2026-09-26T05:00:00.000Z","window":"5-hour","held":0}';
        yield* sql`
          UPDATE projection_threads
          SET usage_pause_json = ${pause}, usage_auto_resume_disabled_at = ${now}
          WHERE thread_id = 'thread-1'
        `;
        yield* migrateUsagePause;
        assert.deepEqual(yield* readRow, [{ usagePause: pause, usageAutoResumeDisabledAt: now }]);
      }),
    );
  },
);
