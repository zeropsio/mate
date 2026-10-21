/**
 * `grep`: the lines at a commit that hold a text, through the heavy reads' allowance. It answers
 * with what it found by its deadline; a whole answer never changes, one cut by the deadline is
 * not kept.
 *
 * @module gitBrowse/grep
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  GitGrepQuery,
  GREP_DEADLINE_MS,
  GREP_FILE_MATCH_LIMIT,
  GREP_LINE_CHARS,
  GREP_MATCH_LIMIT,
  type GitGrep,
} from "@t3tools/shared/hqGitBrowse/grep";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import { BrowseHeavy } from "./heavy.ts";
import type { BrowseInput } from "./routes.ts";

/** Git does not read the search as a regular expression. */
export class PatternRefused extends Schema.TaggedError<PatternRefused>()("PatternRefused", {}) {}

export const grepRead = {
  read: "grep" as const,
  query: GitGrepQuery,
  // Past its own deadline the search answers with what it found; this one only bounds the rest.
  deadline: Duration.seconds(15),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitGrepQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const found = yield* (yield* BrowseHeavy).run(
        userId,
        Effect.scoped(
          Effect.gen(function* () {
            const deadline = new AbortController();
            yield* Effect.forkScoped(
              Effect.sleep(Duration.millis(GREP_DEADLINE_MS)).pipe(
                Effect.andThen(Effect.sync(() => deadline.abort())),
              ),
            );
            return yield* git.browse.grep(
              held.repo,
              query.sha,
              {
                q: query.q,
                path: query.path,
                mode: query.mode ?? "fixed",
                caseSensitive: query.case === "1",
              },
              {
                matches: GREP_MATCH_LIMIT,
                perFile: GREP_FILE_MATCH_LIMIT,
                lineChars: GREP_LINE_CHARS,
              },
              deadline.signal,
            );
          }),
        ),
      );
      if (found.kind === "missing")
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      if (found.kind === "invalid") return yield* new PatternRefused();
      const body: GitGrep = {
        matches: found.matches,
        truncated: found.truncated,
        deadlineHit: found.deadlineHit,
      };
      return { body, pinned: found.deadlineHit ? null : { sha: query.sha } };
    }),
};
