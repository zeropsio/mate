import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Nothing has read or written a turn's stored diff since workspace capture went (062).
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS checkpoint_diff_blobs`;
});
