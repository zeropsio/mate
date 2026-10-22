/**
 * `blob`: a file of a commit as the browser shows it — its first 256 KiB as text, or no text for a
 * binary file. Pinned to its commit, so it never changes.
 *
 * @module gitBrowse/blob
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import {
  GitBlobQuery,
  SOURCE_FILE_MAX_BYTES,
  type GitBlob,
} from "@t3tools/shared/hqGitBrowse/blob";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import { BrowseRefused } from "./refused.ts";
import type { BrowseInput } from "./routes.ts";

export const blobRead = {
  read: "blob" as const,
  query: GitBlobQuery,
  deadline: Duration.seconds(5),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitBlobQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* git.browse.blob(held.repo, query.sha, query.path, {
        maxBytes: SOURCE_FILE_MAX_BYTES,
      });
      if (read.kind === "commit-missing")
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      if (read.kind !== "blob") return yield* new BrowseRefused({ code: "path_not_found" });
      const body: GitBlob = {
        path: query.path,
        blobSha: read.blobSha,
        size: read.size,
        binary: read.binary,
        // A cut may split a character: the text ends before it, never in a replacement mark.
        content: read.binary
          ? null
          : new TextDecoder("utf-8").decode(read.bytes, { stream: read.truncated }),
        truncated: read.truncated,
      };
      return { body, pinned: { sha: query.sha } };
    }),
};
