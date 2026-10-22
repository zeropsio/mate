/**
 * `archive`: a commit's files as one `tar.gz` or `zip`, streamed as a download while git writes
 * it. It holds a heavy read (`heavy.ts`), one per person, until the stream closes — read whole,
 * let go by the person, or stopped at {@link ARCHIVE_DEADLINE}, its git stopped with it.
 *
 * @module gitBrowse/archive
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { archiveName, GitArchiveQuery } from "@t3tools/shared/hqGitBrowse/archive";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import { BrowseHeavy } from "./heavy.ts";
import type { BrowseInput, BrowseStream } from "./routes.ts";

/** How long an archive streams at most. */
export const ARCHIVE_DEADLINE = Duration.seconds(120);
/** Archives one person streams at once, and only while they run no other heavy read. */
const ARCHIVE_PER_PERSON = 1;

const CONTENT_TYPE = { "tar.gz": "application/gzip", zip: "application/zip" } as const;

export const archiveRead = {
  read: "archive" as const,
  query: GitArchiveQuery,
  deadline: ARCHIVE_DEADLINE,
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitArchiveQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const give = yield* (yield* BrowseHeavy).hold(userId, ARCHIVE_PER_PERSON);
      const stream = yield* git.browse
        .archive(held.repo, query.sha, query.format)
        .pipe(Effect.onError(() => Effect.sync(give)));
      if (stream === null) {
        give();
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      }
      // The stream outlives the answer: its own deadline ends it, and the allowance is given back
      // once it closes, however it ends.
      const closed = Effect.callback<void>((resume) => {
        if (stream.closed) resume(Effect.void);
        else stream.once("close", () => resume(Effect.void));
      });
      yield* Effect.forkDetach(
        closed.pipe(
          Effect.timeoutOrElse({
            duration: ARCHIVE_DEADLINE,
            orElse: () =>
              Effect.andThen(
                Effect.sync(() => stream.destroy(new Error("Archive past its deadline"))),
                closed,
              ),
          }),
          Effect.ensuring(Effect.sync(give)),
        ),
      );
      const answer: BrowseStream = {
        stream,
        contentType: CONTENT_TYPE[query.format],
        download: archiveName(repo, query.sha, query.format),
      };
      return answer;
    }),
};
