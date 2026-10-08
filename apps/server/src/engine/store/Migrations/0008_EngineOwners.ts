import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The engine's log has owners of more than one kind: a conversation, and a Mate's crew. Each
 * owner's row and each effect name the kind, so a listing reads conversations only and the worker
 * runs each kind's effects on its own fibers. An effect's lane is any string its kind names.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE engine_conversation ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'conversation'
  `;
  yield* sql`ALTER TABLE engine_effect ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'conversation'`;
  yield* sql`CREATE INDEX engine_conversation_by_kind ON engine_conversation (owner_kind)`;
  yield* sql`CREATE INDEX engine_effect_by_kind ON engine_effect (owner_kind, state, available_at)`;
});
