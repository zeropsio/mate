import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A call's own record beside its item (what it was asked, what it wrote): read by its readers. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE engine_item_data (
      item_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      at INTEGER NOT NULL
    )
  `;
  yield* sql`CREATE INDEX engine_item_data_by_conversation ON engine_item_data (conversation_id)`;
});
