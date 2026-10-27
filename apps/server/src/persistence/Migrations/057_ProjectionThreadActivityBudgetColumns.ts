import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The fields a thread snapshot's budgets key on (`activityBudgetColumns`), as
 * columns of the activity projection written at ingestion, and an index that
 * holds them with the row's turn, time and order: a page reads its rows'
 * budgets off the index without parsing one payload. Rows stored before are
 * filled here, once.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_activities)
  `;
  const existing = new Set(columns.map((column) => column.name));
  for (const [name, type] of [
    ["agent_id", "TEXT"],
    ["call_id", "TEXT"],
    ["task_id", "TEXT"],
    ["used_tokens", "REAL"],
  ] as const) {
    if (existing.has(name)) continue;
    yield* sql.unsafe(`ALTER TABLE projection_thread_activities ADD COLUMN ${name} ${type}`);
  }

  yield* sql`
    UPDATE projection_thread_activities
    SET
      agent_id = NULLIF(TRIM(
        CASE WHEN json_type(payload_json, '$.agentId') = 'text'
          THEN json_extract(payload_json, '$.agentId') END
      ), ''),
      call_id = COALESCE(
        NULLIF(TRIM(
          CASE WHEN json_type(payload_json, '$.toolCallId') = 'text'
            THEN json_extract(payload_json, '$.toolCallId') END
        ), ''),
        NULLIF(TRIM(
          CASE WHEN json_type(payload_json, '$.data.toolCallId') = 'text'
            THEN json_extract(payload_json, '$.data.toolCallId') END
        ), '')
      )
    WHERE kind IN ('tool.started', 'tool.updated', 'tool.completed')
      AND json_valid(payload_json)
      AND json_type(payload_json) = 'object'
  `;
  yield* sql`
    UPDATE projection_thread_activities
    SET task_id = NULLIF(TRIM(
      CASE WHEN json_type(payload_json, '$.taskId') = 'text'
        THEN json_extract(payload_json, '$.taskId') END
    ), '')
    WHERE kind IN ('task.started', 'task.progress', 'task.updated', 'task.completed')
      AND json_valid(payload_json)
      AND json_type(payload_json) = 'object'
  `;
  yield* sql`
    UPDATE projection_thread_activities
    SET used_tokens = json_extract(payload_json, '$.usedTokens')
    WHERE kind = 'context-window.updated'
      AND json_valid(payload_json)
      AND json_type(payload_json) = 'object'
      AND json_type(payload_json, '$.usedTokens') IN ('integer', 'real')
      AND json_extract(payload_json, '$.usedTokens') >= 0
  `;

  // A page's rows: turn-linked ones by turn, turnless ones by time, each with
  // what its budget reads.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_turn_budget
    ON projection_thread_activities(
      thread_id, turn_id, created_at, sequence, activity_id,
      kind, agent_id, call_id, task_id, used_tokens
    )
  `;
  // A helper's start, found from its later rows.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_task
    ON projection_thread_activities(thread_id, task_id, kind)
    WHERE task_id IS NOT NULL
  `;
});
