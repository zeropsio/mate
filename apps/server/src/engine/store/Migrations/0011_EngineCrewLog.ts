import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** What a crew did, for triage: a landing held, a run's moves. The newest 500 are kept. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE engine_crew_log (
      owner_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (owner_id, seq, kind)
    )
  `;
});
