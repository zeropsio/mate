import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Rebuildable from RunQueued/TaskAssignmentChanged events. Historical absence
// proves no assignment: adoption writes its actual run, never a guessed epoch.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE engine_run ADD COLUMN task_assignment TEXT`;
});
