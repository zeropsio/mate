/**
 * `commit`: a commit, what it changed against its first parent under the page's budget, and the
 * change merged as it. Pinned to the commit, so it never changes.
 *
 * @module gitBrowse/commit
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { GitCommitQuery, type GitCommit } from "@t3tools/shared/hqGitBrowse/commit";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

/**
 * The change merged as each of `shas`: GitHub's word for its own merge first, then HQ's squash.
 * Commits no change was merged as are absent.
 */
export const changesMergedAs = (appId: string, repo: string, shas: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Map<string, { readonly mateId: string; readonly number: number }>();
    if (shas.length === 0) return found;
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly mate_project_id: string;
      readonly number: number;
      readonly merged_sha: string | null;
      readonly pr_merged_sha: string | null;
    }>`
      SELECT c.mate_project_id, c.number, c.merged_sha, pr.merged_sha AS pr_merged_sha
      FROM hq_change c
      LEFT JOIN hq_pull_request pr
        ON pr.app_id = c.app_id AND pr.repo = c.repo AND pr.number = c.number
      WHERE c.app_id::text = ${appId} AND c.repo = ${repo}
        AND (${sql.in("pr.merged_sha", shas)} OR ${sql.in("c.merged_sha", shas)})`;
    for (const row of rows) {
      const change = { mateId: row.mate_project_id, number: row.number };
      if (row.pr_merged_sha !== null && shas.includes(row.pr_merged_sha))
        found.set(row.pr_merged_sha, change);
    }
    for (const row of rows)
      if (row.merged_sha !== null && shas.includes(row.merged_sha) && !found.has(row.merged_sha))
        found.set(row.merged_sha, { mateId: row.mate_project_id, number: row.number });
    return found;
  });

export const commitRead = {
  read: "commit" as const,
  query: GitCommitQuery,
  deadline: Duration.seconds(15),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitCommitQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* git.browse.commit(held.repo, query.sha);
      if (read === null)
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      const change = (yield* changesMergedAs(appId, repo, [read.sha])).get(read.sha);
      const body: GitCommit = { ...read, ...(change === undefined ? {} : { change }) };
      return { body, pinned: { sha: read.sha } };
    }),
};
