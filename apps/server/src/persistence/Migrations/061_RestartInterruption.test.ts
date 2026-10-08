import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migration from "./061_RestartInterruption.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
it.effect.each([
  { name: "replacement", words: "Radotin - Eddy's container was replaced", cause: "replaced" },
  {
    name: "platform restart with an actor",
    words: "Fen was restarted by Ana Novak",
    cause: "restarted",
  },
  { name: "fallback restart", words: "Mate restarted", cause: "restarted" },
  { name: "unrelated error", words: "A tool failed", cause: null },
])("an upgrade preserves $name evidence on the affected turn", ({ words, cause }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const at = "2026-10-08T08:24:39.700Z";
    const error = `${words} at ${at}; its running turn was interrupted. Send a message to continue.`;
    yield* sql`CREATE TABLE projection_thread_sessions (thread_id TEXT, status TEXT, last_error TEXT, updated_at TEXT)`;
    yield* sql`CREATE TABLE projection_threads (thread_id TEXT, latest_turn_id TEXT)`;
    yield* sql`CREATE TABLE projection_turns (thread_id TEXT, turn_id TEXT, state TEXT)`;
    yield* sql`CREATE TABLE orchestration_events (sequence INTEGER, event_id TEXT, event_type TEXT, payload_json TEXT)`;
    yield* sql`CREATE TABLE projection_thread_activities (activity_id TEXT PRIMARY KEY, thread_id TEXT, turn_id TEXT, tone TEXT, kind TEXT, summary TEXT, payload_json TEXT, sequence INTEGER, created_at TEXT)`;
    yield* sql`INSERT INTO projection_thread_sessions VALUES ('thread', 'error', ${error}, ${at})`;
    yield* sql`INSERT INTO projection_threads VALUES ('thread', 'turn')`;
    yield* sql`INSERT INTO projection_turns VALUES ('thread', 'turn', 'error')`;
    yield* sql`INSERT INTO orchestration_events VALUES (7, 'event', 'thread.session-set', ${encode({ threadId: "thread", session: { status: "error", lastError: error, updatedAt: at } })})`;
    yield* migration;
    const [session] = yield* sql<{
      readonly status: string;
      readonly lastError: string | null;
      readonly restartCause: string | null;
    }>`SELECT status, last_error AS "lastError", json_extract(interruption_json, '$.restart.cause') AS "restartCause" FROM projection_thread_sessions`;
    assert.deepStrictEqual(session, {
      status: cause === null ? "error" : "interrupted",
      lastError: cause === null ? error : null,
      restartCause: cause,
    });
    const history = yield* sql<{
      readonly turnId: string;
      readonly cause: string;
      readonly at: string;
      readonly sequence: number;
    }>`SELECT turn_id AS "turnId", json_extract(payload_json, '$.interruption.restart.cause') AS cause, json_extract(payload_json, '$.interruption.restart.at') AS at, sequence FROM projection_thread_activities`;
    assert.deepStrictEqual(
      history,
      cause === null ? [] : [{ turnId: "turn", cause, at, sequence: 7 }],
    );
    const [event] = yield* sql<{
      readonly cause: string | null;
    }>`SELECT json_extract(payload_json, '$.session.interruption.restart.cause') AS cause FROM orchestration_events`;
    assert.strictEqual(event?.cause, cause);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
