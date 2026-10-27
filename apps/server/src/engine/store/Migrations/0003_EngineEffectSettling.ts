import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * An effect's terminal outcome is written to its row before its owner records it (`settling`),
 * and told again, with backoff, until the owner has it: the attempts so far.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE engine_effect ADD COLUMN settle_attempt INTEGER NOT NULL DEFAULT 0`;
});
