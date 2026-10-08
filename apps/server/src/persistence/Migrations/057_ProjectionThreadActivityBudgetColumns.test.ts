import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("057_ProjectionThreadActivityBudgetColumns", (it) => {
  it.effect("fills the budget columns of rows stored before it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 56 });

      const rows: ReadonlyArray<readonly [string, string, string]> = [
        ["mate-call", "tool.completed", '{"toolCallId":"call-1","data":{"output":"done"}}'],
        ["helper-call", "tool.started", '{"data":{"toolCallId":" call-2 "},"agentId":"helper-a"}'],
        ["blank-agent", "tool.updated", '{"toolCallId":"call-3","agentId":"  "}'],
        ["tick", "task.progress", '{"taskId":"task-1","agentId":"helper-a"}'],
        ["reading", "context-window.updated", '{"usedTokens":1200}'],
        ["bad-reading", "context-window.updated", '{"usedTokens":"1200"}'],
        ["malformed", "tool.completed", "{not json"],
        ["list", "task.started", '["taskId"]'],
      ];
      for (const [id, kind, payload] of rows) {
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
          )
          VALUES (${id}, 'thread-1', 'turn-1', 'tool', ${kind}, 'row', ${payload}, NULL,
            '2026-05-01T00:00:00.000Z')
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 57 });

      const filled = yield* sql<{
        readonly id: string;
        readonly agentId: string | null;
        readonly callId: string | null;
        readonly taskId: string | null;
        readonly usedTokens: number | null;
      }>`
        SELECT
          activity_id AS "id",
          agent_id AS "agentId",
          call_id AS "callId",
          task_id AS "taskId",
          used_tokens AS "usedTokens"
        FROM projection_thread_activities
        ORDER BY activity_id
      `;
      const none = { agentId: null, callId: null, taskId: null, usedTokens: null };
      assert.deepStrictEqual(
        Object.fromEntries(filled.map(({ id, ...columns }) => [id, { ...columns }])),
        {
          "bad-reading": none,
          "blank-agent": { ...none, callId: "call-3" },
          "helper-call": { ...none, agentId: "helper-a", callId: "call-2" },
          list: none,
          malformed: none,
          "mate-call": { ...none, callId: "call-1" },
          reading: { ...none, usedTokens: 1200 },
          tick: { ...none, taskId: "task-1" },
        },
      );
    }),
  );
});
