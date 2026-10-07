import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** A wake row names the arming it holds, so a fire and a drop touch only that arming. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE engine_wake ADD COLUMN armed_seq INTEGER NOT NULL DEFAULT 0`;
});
