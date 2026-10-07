import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * What the wire reads by: every record by the sequence of its latest change (a resume reads what
 * changed past a cursor), a run's items in order (its pages), and the sequence space the tables
 * were made in (`origin`): tables made again are a fresh start, so no cursor of the old ones
 * resumes on them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX engine_run_by_rev ON engine_run (conversation_id, rev)`;
  yield* sql`CREATE INDEX engine_item_by_rev ON engine_item (conversation_id, rev)`;
  yield* sql`CREATE INDEX engine_item_by_run ON engine_item (run_id, opened_seq)`;
  yield* sql`CREATE INDEX engine_request_by_rev ON engine_request (conversation_id, rev)`;
  yield* sql`
    CREATE TABLE engine_origin (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      origin TEXT NOT NULL
    )
  `;
  yield* sql`INSERT INTO engine_origin (id, origin) VALUES (1, lower(hex(randomblob(8))))`;
});
