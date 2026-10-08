import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Startup appends legacy corrections through the engine so replay cursors see them.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_thread_sessions ADD COLUMN interruption_json TEXT`;
});
