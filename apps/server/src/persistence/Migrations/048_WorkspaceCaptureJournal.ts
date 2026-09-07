import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Write-ahead capture receipts outlive a worker restart; patches stay in service Git. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS workspace_capture_runs (
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      turn_id TEXT,
      phase TEXT NOT NULL,
      history_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, run_id)
    )
  `;
  yield* sql`CREATE UNIQUE INDEX IF NOT EXISTS workspace_capture_turn
    ON workspace_capture_runs(thread_id, turn_id) WHERE turn_id IS NOT NULL`;
});
