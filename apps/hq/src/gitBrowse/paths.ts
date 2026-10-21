/**
 * `paths`: every file path at a commit, for the file finder. A commit never changes, so neither
 * does the answer.
 *
 * @module gitBrowse/paths
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitPathsQuery, PATHS_LIMIT, type GitPaths } from "@t3tools/shared/hqGitBrowse/paths";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

export const pathsRead = {
  read: "paths" as const,
  query: GitPathsQuery,
  deadline: Duration.seconds(5),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitPathsQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const listed = yield* git.browse.paths(held.repo, query.sha, PATHS_LIMIT);
      if (listed === null)
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      const body: GitPaths = { paths: listed.paths, truncated: listed.truncated };
      return { body, pinned: { sha: query.sha } };
    }),
};
