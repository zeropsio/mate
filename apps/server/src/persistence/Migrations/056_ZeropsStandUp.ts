import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * A Mate's stand-up, once per project: started by its own server or by a
 * browser, it is never started again (`zerops/ZeropsSetup.ts`).
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS zerops_stand_ups (
      project_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      started_at TEXT NOT NULL
    )
  `;
});
