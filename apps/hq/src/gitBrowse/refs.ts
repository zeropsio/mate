/**
 * `refs`: a repository's branches or tags, a page at a time. Refs move, so it is never cached.
 *
 * @module gitBrowse/refs
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitRefsQuery, type GitRefs } from "@t3tools/shared/hqGitBrowse/refs";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

export const refsRead = {
  read: "refs" as const,
  query: GitRefsQuery,
  deadline: Duration.seconds(5),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitRefsQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const body: GitRefs = yield* git.browse.refs(held.repo, query);
      return { body, pinned: null };
    }),
};
