import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The crew a thread works for (`crew_json`, the `ThreadCrewOrigin` as JSON),
 * NULL on a person's thread.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!columns.some((column) => column.name === "crew_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN crew_json TEXT
    `;
  }
});
