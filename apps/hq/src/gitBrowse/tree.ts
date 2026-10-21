/**
 * `tree`: a folder of a commit. Pinned to its commit, so it never changes.
 *
 * @module gitBrowse/tree
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitTreeQuery, type GitTree } from "@t3tools/shared/hqGitBrowse/tree";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import { BrowseRefused } from "./refused.ts";
import type { BrowseInput } from "./routes.ts";

export const treeRead = {
  read: "tree" as const,
  query: GitTreeQuery,
  deadline: Duration.seconds(5),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitTreeQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* git.browse.tree(held.repo, query.sha, query.path);
      if (read.kind === "commit-missing")
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      if (read.kind === "path-missing") return yield* new BrowseRefused({ code: "path_not_found" });
      const body: GitTree = { entries: read.entries, truncated: read.truncated };
      return { body, pinned: { sha: query.sha } };
    }),
};
