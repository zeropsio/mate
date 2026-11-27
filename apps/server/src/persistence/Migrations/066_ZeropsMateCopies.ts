import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The Mate-wide copy projection is independent of any conversation. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE zerops_mate_copies (id INTEGER PRIMARY KEY CHECK (id = 1), state_json TEXT NOT NULL)`;
});
