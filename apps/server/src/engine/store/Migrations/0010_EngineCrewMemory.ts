import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Each crewmate's memory: one row per entry, written one operation at a time as the crew owner
 * records it, read for its tool's answers and its session's packet.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE engine_crew_memory (
      owner_id TEXT NOT NULL,
      handle TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      topic TEXT,
      text TEXT NOT NULL,
      paths_json TEXT NOT NULL DEFAULT '[]',
      verified_at TEXT,
      from_assignment TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, handle, entry_id)
    )
  `;
});
