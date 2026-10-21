/**
 * `log`: the commits reachable from one commit, or those that touched a path, a page at a time.
 * Pinned to that commit, so it never changes.
 *
 * @module gitBrowse/log
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitLogQuery, type GitLog } from "@t3tools/shared/hqGitBrowse/log";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

export const logRead = {
  read: "log" as const,
  query: GitLogQuery,
  deadline: Duration.seconds(10),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitLogQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const body: GitLog | null = yield* git.browse.log(held.repo, query);
      if (body === null)
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      return { body, pinned: { sha: query.sha } };
    }),
};
