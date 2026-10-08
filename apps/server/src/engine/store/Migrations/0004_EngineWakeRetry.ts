import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A wake whose fire failed (its owner could not load) waits before it is tried again. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE engine_wake ADD COLUMN retry_at INTEGER`;
  yield* sql`ALTER TABLE engine_wake ADD COLUMN fire_failures INTEGER NOT NULL DEFAULT 0`;
});
