import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import migration from "./060_ProviderRefusalDeadline.ts";

const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.effect.each([
  {
    name: "an upgrade retains the provider reset for the refused latest turn",
    startedAt: "2026-10-06T21:53:52Z",
    error: "Claude usage limit reached.",
    reset: "2026-10-07T02:00:00Z",
  },
  {
    name: "an upgrade cannot borrow a reset from an earlier turn",
    startedAt: "2026-10-08T10:00:00Z",
    error: "Claude usage limit reached.",
    reset: null,
  },
  {
    name: "an upgrade cannot attach a limit to a recovered session",
    startedAt: "2026-10-06T21:53:52Z",
    error: null,
    reset: null,
  },
])("$name", ({ startedAt, error, reset }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE projection_thread_sessions (thread_id TEXT, last_error TEXT)`;
    yield* sql`CREATE TABLE projection_threads (thread_id TEXT, latest_turn_id TEXT)`;
    yield* sql`CREATE TABLE projection_turns (thread_id TEXT, turn_id TEXT, started_at TEXT)`;
    yield* sql`CREATE TABLE orchestration_events (sequence INTEGER, event_type TEXT, occurred_at TEXT, payload_json TEXT)`;
    yield* sql`INSERT INTO projection_thread_sessions VALUES ('thread', ${error})`;
    yield* sql`INSERT INTO projection_threads VALUES ('thread', 'latest')`;
    yield* sql`INSERT INTO projection_turns VALUES ('thread', 'latest', ${startedAt})`;
    yield* sql`INSERT INTO orchestration_events VALUES (1, 'thread.usage-pause-set', '2026-10-06T21:53:56Z', ${encodePayload({ threadId: "thread", usagePause: { resetsAt: "2026-10-07T02:00:00Z" } })})`;
    yield* sql`INSERT INTO orchestration_events VALUES (2, 'thread.usage-pause-set', '2026-10-07T02:00:30Z', ${encodePayload({ threadId: "thread", usagePause: null })})`;
    yield* migration;
    const [session] = yield* sql<{
      readonly resetAt: string | null;
    }>`SELECT usage_limit_reset_at AS resetAt FROM projection_thread_sessions`;
    assert.strictEqual(session?.resetAt, reset);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
