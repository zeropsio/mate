import { messagePreviewText } from "@t3tools/shared/messagePreview";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The thread shell's preview of the conversation's last message, so a row
 * that lists conversations can say what was last said without loading one.
 * Backfilled from each thread's newest user or assistant message with text.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "latest_message_preview_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN latest_message_preview_json TEXT
    `;
  }

  const sources = yield* sql<{
    readonly threadId: string;
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly createdAt: string;
  }>`
    SELECT
      newest.thread_id AS "threadId",
      newest.role,
      newest.text,
      newest.created_at AS "createdAt"
    FROM (
      SELECT
        thread_id,
        role,
        substr(text, 1, 1000) AS text,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY created_at DESC, message_id DESC
        ) AS row_number
      FROM projection_thread_messages
      WHERE role IN ('user', 'assistant')
        AND length(trim(text)) > 0
    ) AS newest
    WHERE newest.row_number = 1
  `;

  yield* Effect.forEach(
    sources,
    (source) => {
      const text = messagePreviewText(source.text);
      if (text === null) {
        return Effect.void;
      }
      const preview = JSON.stringify({ role: source.role, text, createdAt: source.createdAt });
      return sql`
        UPDATE projection_threads
        SET latest_message_preview_json = ${preview}
        WHERE thread_id = ${source.threadId}
          AND latest_message_preview_json IS NULL
      `;
    },
    { concurrency: 1, discard: true },
  );
});
