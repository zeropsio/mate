import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * A published page's height at each width a client laid it out at: what a later view paints it at
 * from its first frame. Kept beside the page's call, never in its record.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE engine_page_height (
      conversation_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, item_id, width)
    )
  `;
});
