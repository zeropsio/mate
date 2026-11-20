import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS crew_definition`;
  yield* sql`DROP TABLE IF EXISTS crew_member`;
  yield* sql`DROP TABLE IF EXISTS crew_assignment`;
  yield* sql`DROP TABLE IF EXISTS crew_attempt`;
  yield* sql`DROP TABLE IF EXISTS crew_run`;
  yield* sql`DROP TABLE IF EXISTS crew_stint`;
  yield* sql`DROP TABLE IF EXISTS crew_memory`;
  yield* sql`DROP TABLE IF EXISTS crew_claim`;
  yield* sql`DROP TABLE IF EXISTS crew_host`;
  yield* sql`DROP TABLE IF EXISTS crew_log`;
  yield* sql`DROP TABLE IF EXISTS crew_operation`;
});
