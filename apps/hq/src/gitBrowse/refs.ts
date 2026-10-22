/**
 * `refs`: a repository's branches or tags, a page at a time. Refs move, so it is never cached.
 *
 * @module gitBrowse/refs
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitRefsQuery, type GitRefs } from "@t3tools/shared/hqGitBrowse/refs";
import { GitHost, changesOnBranches } from "../gitHost.ts";
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
      const listed = yield* git.browse.refs(held.repo, query);
      const changes = yield* changesOnBranches(
        held.repo,
        listed.items.filter((item) => item.kind === "branch").map((item) => item.name),
      );
      const body: GitRefs = {
        ...listed,
        items: listed.items.map((item) => {
          const change = item.kind === "branch" ? changes.get(item.name) : undefined;
          return change === undefined
            ? item
            : { ...item, kind: "change", change: { mateId: change.mateId, number: change.number } };
        }),
      };
      return { body, pinned: null };
    }),
};
