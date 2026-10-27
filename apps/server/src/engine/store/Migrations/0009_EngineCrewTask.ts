import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * A crew's tasks, every one it ever held, beside the crew owner's log: the board shows the open
 * ones and each crewmate's newest finished, and older finished work is paged from here. A task's
 * attempts ride on its row: each one's conversation, how it ended, what it spent.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE engine_crew_task (
      owner_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      handle TEXT NOT NULL,
      state TEXT NOT NULL,
      finished INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      task_json TEXT NOT NULL,
      attempts_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (owner_id, task_id)
    )
  `;
  yield* sql`
    CREATE INDEX engine_crew_task_finished ON engine_crew_task (owner_id, handle, finished, number)
  `;
});
