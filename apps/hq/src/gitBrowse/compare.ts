/**
 * `compare`: what one branch, tag or commit adds since it left another, three dots. Both sides
 * move with their refs, so the answer names the commits they named and is never cached.
 * `compare-file`: one file's hunks from the answered merge base to the answered head, read when a
 * person asks for a file the page left for later. Pinned to both commits, so it never changes.
 *
 * @module gitBrowse/compare
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import {
  GitCompareFileQuery,
  GitCompareQuery,
  type GitCompare,
} from "@t3tools/shared/hqGitBrowse/compare";
import type { GitCommitFileHunks } from "@t3tools/shared/hqGitBrowse/commit";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

const notFound = () => new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });

export const compareRead = {
  read: "compare" as const,
  query: GitCompareQuery,
  deadline: Duration.seconds(15),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitCompareQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      // A side with no commit (an empty `main`) has nothing to compare: it is no commit.
      const named = (rev: string) =>
        Effect.flatMap(git.browse.resolve(held.repo, rev), (resolved) =>
          resolved.kind === "commit"
            ? Effect.succeed({ sha: resolved.sha, ref: resolved.ref })
            : Effect.fail(notFound()),
        );
      const base = yield* named(query.base);
      const head = yield* named(query.head);
      const read = yield* git.browse.compare(held.repo, base.sha, head.sha);
      if (read === null) return yield* notFound();
      const body: GitCompare = { base, head, ...read };
      return { body, pinned: null };
    }),
};

export const compareFileRead = {
  read: "compare-file" as const,
  query: GitCompareFileQuery,
  deadline: Duration.seconds(15),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitCompareFileQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* git.browse.compareFile(held.repo, query.base, query.head, query.path);
      if (read === null) return yield* notFound();
      const body: GitCommitFileHunks = read;
      return { body, pinned: { sha: query.head } };
    }),
};
