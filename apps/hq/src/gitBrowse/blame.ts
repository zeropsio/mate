/**
 * `blame`: which commit last changed each line of a file at a commit, through the heavy reads'
 * allowance, with the change merged as each commit. A file past {@link BLAME_MAX_BYTES} is refused
 * `too_large` with its size. Pinned to the commit, so it never changes.
 *
 * @module gitBrowse/blame
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { BLAME_MAX_BYTES, GitBlameQuery, type GitBlame } from "@t3tools/shared/hqGitBrowse/blame";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import { changesMergedAs } from "./commit.ts";
import { BrowseHeavy } from "./heavy.ts";
import { BrowseRefused } from "./refused.ts";
import type { BrowseInput } from "./routes.ts";

export const blameRead = {
  read: "blame" as const,
  query: GitBlameQuery,
  deadline: Duration.seconds(15),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitBlameQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* (yield* BrowseHeavy).run(
        userId,
        git.browse.blame(held.repo, query.sha, query.path, BLAME_MAX_BYTES),
      );
      if (read.kind === "commit-missing")
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      if (read.kind === "folder") return yield* new BrowseRefused({ code: "not_a_file" });
      if (read.kind === "path-missing") return yield* new BrowseRefused({ code: "path_not_found" });
      if (read.kind === "too-large")
        return yield* new BrowseRefused({
          code: "too_large",
          limit: BLAME_MAX_BYTES,
          size: read.size,
        });
      const changes = yield* changesMergedAs(
        appId,
        repo,
        read.commits.map((commit) => commit.sha),
      );
      const body: GitBlame = {
        ranges: read.ranges,
        commits: read.commits.map((commit) => {
          const change = changes.get(commit.sha);
          return change === undefined ? commit : { ...commit, change };
        }),
      };
      return { body, pinned: { sha: query.sha } };
    }),
};
