/**
 * `commit-file`: one file's hunks in a commit, read when a person asks for a file the commit's
 * page left for later. Pinned to the commit, so it never changes.
 *
 * @module gitBrowse/commitFile
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitCommitFileQuery, type GitCommitFileHunks } from "@t3tools/shared/hqGitBrowse/commit";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import type { BrowseInput } from "./routes.ts";

export const commitFileRead = {
  read: "commit-file" as const,
  query: GitCommitFileQuery,
  deadline: Duration.seconds(15),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitCommitFileQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* git.browse.commitFile(held.repo, query.sha, query.path);
      if (read === null)
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      const body: GitCommitFileHunks = read;
      return { body, pinned: { sha: query.sha } };
    }),
};
