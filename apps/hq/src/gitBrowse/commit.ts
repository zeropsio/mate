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

/** The change merged as `sha`: GitHub's word for its own merge first, then HQ's squash. */
const changeOf = (appId: string, repo: string, sha: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ readonly mate_project_id: string; readonly number: number }>`
      SELECT c.mate_project_id, c.number
      FROM hq_change c
      LEFT JOIN hq_pull_request pr
        ON pr.app_id = c.app_id AND pr.repo = c.repo AND pr.number = c.number
      WHERE c.app_id::text = ${appId} AND c.repo = ${repo}
        AND (pr.merged_sha = ${sha} OR c.merged_sha = ${sha})
      ORDER BY (pr.merged_sha = ${sha}) DESC NULLS LAST
      LIMIT 1`;
    return row === undefined ? undefined : { mateId: row.mate_project_id, number: row.number };
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
      const change = yield* changeOf(appId, repo, read.sha);
      const body: GitCommit = { ...read, ...(change === undefined ? {} : { change }) };
      return { body, pinned: { sha: read.sha } };
    }),
};
