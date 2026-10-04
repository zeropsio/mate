import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Operation identities and receipts survive a process ending before its final callback. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE crew_operation (id TEXT PRIMARY KEY, crew TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)`;
  yield* sql`CREATE INDEX crew_operation_active ON crew_operation (crew, status)`;
});
