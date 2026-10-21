/**
 * Who may read a repository in the Git browser, decided on every read before any git runs: any
 * role that sees the application reads all its repositories (`Changes.personGit`), and only one
 * the application holds (`hq_repo`).
 *
 * @module gitBrowse/access
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { ChangeRefused, Changes } from "../changes.ts";

export const browseAccess = (userId: string, appId: string, repo: string) =>
  Effect.gen(function* () {
    yield* (yield* Changes).personGit(userId, appId, false);
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly updated_at: string }>`
      SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
      FROM hq_repo WHERE app_id::text = ${appId} AND name = ${repo}`;
    const [row] = rows;
    if (row === undefined)
      return yield* new ChangeRefused({ code: "repo_not_found", reason: "repo_not_found" });
    return { repo: { appId, id: repo }, updatedAt: row.updated_at };
  });
