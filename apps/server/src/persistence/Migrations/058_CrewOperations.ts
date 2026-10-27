import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Operation identities and receipts survive a process ending before its final callback.
 * It shipped in dev builds as migration 57 before upstream took that id, so a database may already
 * hold the table: it is created only where missing.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS crew_operation (id TEXT PRIMARY KEY, crew TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)`;
  yield* sql`CREATE INDEX IF NOT EXISTS crew_operation_active ON crew_operation (crew, status)`;
});
