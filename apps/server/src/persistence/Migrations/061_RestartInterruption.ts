import { MateInterruption, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const encode = Schema.encodeSync(Schema.fromJsonString(MateInterruption));
// Only the exact sentence written by the old boot reconciler is restart evidence.
const oldRestart =
  /^.+(?: was (restarted|stopped|redeployed)(?: by .+)? at |'s container was (replaced) at | (restarted) at )(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z); its running turn was interrupted\. Send a message to continue\.$/u;

/** Upgrade the old boot evidence at its owner, once; clients never infer causes from words. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE projection_thread_sessions ADD COLUMN interruption_json TEXT`;
  const rows = yield* sql<{
    readonly threadId: string;
    readonly turnId: string;
    readonly lastError: string;
    readonly updatedAt: string;
  }>`SELECT session.thread_id AS "threadId", thread.latest_turn_id AS "turnId",
      session.last_error AS "lastError", session.updated_at AS "updatedAt"
    FROM projection_thread_sessions AS session
    JOIN projection_threads AS thread ON thread.thread_id = session.thread_id
    JOIN projection_turns AS turn ON turn.thread_id = thread.thread_id AND turn.turn_id = thread.latest_turn_id
    WHERE session.status = 'error' AND turn.state = 'error' AND session.last_error IS NOT NULL`;
  for (const row of rows) {
    const match = oldRestart.exec(row.lastError);
    if (match === null) continue;
    const cause = match[1] ?? match[2] ?? match[3];
    if (
      cause !== "restarted" &&
      cause !== "replaced" &&
      cause !== "stopped" &&
      cause !== "redeployed"
    )
      continue;
    const interruption: MateInterruption = {
      turnId: TurnId.make(row.turnId),
      restart: { cause, at: match[4]! },
      continuation: "manual",
    };
    const json = encode(interruption);
    yield* sql`UPDATE projection_thread_sessions SET status = 'interrupted', last_error = NULL,
      interruption_json = ${json} WHERE thread_id = ${row.threadId}`;
    yield* sql`UPDATE projection_turns SET state = 'interrupted'
      WHERE thread_id = ${row.threadId} AND turn_id = ${row.turnId}`;
    // Preserve the event's identity and order so rebuilding projections produces the same story.
    yield* sql`UPDATE orchestration_events SET payload_json = json_set(payload_json,
      '$.session.status', 'interrupted', '$.session.lastError', NULL,
      '$.session.interruption', json(${json}))
      WHERE event_type = 'thread.session-set' AND json_extract(payload_json, '$.threadId') = ${row.threadId}
        AND json_extract(payload_json, '$.session.updatedAt') = ${row.updatedAt}
        AND json_extract(payload_json, '$.session.lastError') = ${row.lastError}`;
    yield* sql`INSERT OR IGNORE INTO projection_thread_activities
      (activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at)
      SELECT event_id, ${row.threadId}, ${row.turnId}, 'info', 'runtime.interrupted',
        'Interrupted by a Mate restart', json_object('interruption', json(${json})), sequence, ${row.updatedAt}
      FROM orchestration_events WHERE event_type = 'thread.session-set'
        AND json_extract(payload_json, '$.threadId') = ${row.threadId}
        AND json_extract(payload_json, '$.session.updatedAt') = ${row.updatedAt}
        AND json_extract(payload_json, '$.session.interruption.turnId') = ${row.turnId}`;
  }
});
