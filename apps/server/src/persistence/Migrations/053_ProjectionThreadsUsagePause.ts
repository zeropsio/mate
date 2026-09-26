import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The usage pause a thread's provider put it in (`usage_pause_json`, the
 * `ThreadUsagePauseState` as JSON, NULL when not paused) and the thread's
 * switch for resuming by itself at the reset (`usage_auto_resume_disabled_at`,
 * NULL = on, the default).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "usage_pause_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN usage_pause_json TEXT
    `;
  }
  if (!columns.some((column) => column.name === "usage_auto_resume_disabled_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN usage_auto_resume_disabled_at TEXT
    `;
  }
});
