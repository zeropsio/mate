import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * What a conversation's view reads by, read again on every commit of its conversation: the newest
 * items of a kind (the person's asks, the agent's last words), the items of a kind in a state (the
 * call on now, the background work alive), the runs not ended and the requests open. Each lookup
 * reads the rows it names, never the record before them.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX engine_item_by_kind ON engine_item (conversation_id, kind, opened_seq)`;
  yield* sql`
    CREATE INDEX engine_item_by_state ON engine_item (conversation_id, kind, state, opened_seq)
  `;
  yield* sql`
    CREATE INDEX engine_run_not_ended ON engine_run (conversation_id, ordinal)
    WHERE state != 'ended'
  `;
  yield* sql`CREATE INDEX engine_request_by_state ON engine_request (conversation_id, state, seq)`;
});
