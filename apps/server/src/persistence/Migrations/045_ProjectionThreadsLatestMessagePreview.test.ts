import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ProjectionThreadsLatestMessagePreview", (it) => {
  it.effect("adds the preview column and fills it from each thread's newest message", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 44 });

      for (const threadId of ["thread-spoken", "thread-quiet"]) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            branch, worktree_path, latest_turn_id, created_at, updated_at, archived_at,
            latest_user_message_at, pending_approval_count, pending_user_input_count,
            has_actionable_proposed_plan, deleted_at
          )
          VALUES (
            ${threadId}, 'project-1', 'Thread', '{"provider":"codex","model":"gpt-5-codex"}',
            'approval-required', 'default', NULL, NULL, NULL, '2026-09-06T00:00:00.000Z',
            '2026-09-06T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL
          )
        `;
      }

      const messages = [
        ["message-1", "user", "please **do** the thing", "2026-09-06T00:00:01.000Z"],
        ["message-2", "assistant", "## Done\n\nThe thing is done.", "2026-09-06T00:00:02.000Z"],
        ["message-3", "system", "a note nobody previews", "2026-09-06T00:00:03.000Z"],
        ["message-4", "assistant", "   ", "2026-09-06T00:00:04.000Z"],
      ] as const;
      for (const [messageId, role, text, createdAt] of messages) {
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
          )
          VALUES (${messageId}, 'thread-spoken', NULL, ${role}, ${text}, 0, ${createdAt}, ${createdAt})
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 45 });

      const rows = yield* sql<{
        readonly threadId: string;
        readonly latestMessagePreview: string | null;
      }>`
        SELECT thread_id AS "threadId", latest_message_preview_json AS "latestMessagePreview"
        FROM projection_threads
        ORDER BY thread_id ASC
      `;
      assert.deepEqual(
        rows.map((row) => ({
          threadId: row.threadId,
          preview: row.latestMessagePreview === null ? null : JSON.parse(row.latestMessagePreview),
        })),
        [
          { threadId: "thread-quiet", preview: null },
          {
            threadId: "thread-spoken",
            preview: {
              role: "assistant",
              text: "Done The thing is done.",
              createdAt: "2026-09-06T00:00:02.000Z",
            },
          },
        ],
      );
    }),
  );
});
