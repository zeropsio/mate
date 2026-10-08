import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** The conversation's row holds its agent: the instance, driver, model and profile it belongs to. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE engine_conversation ADD COLUMN agent_json TEXT`;
});
