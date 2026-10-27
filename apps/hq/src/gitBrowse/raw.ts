/**
 * `raw`: a file's bytes, at most 1 MiB. Text of any kind, HTML and SVG included, goes out as plain
 * text; PNG, JPEG, GIF and WebP by their first bytes as images; anything else as an octet stream.
 *
 * @module gitBrowse/raw
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { GitRawQuery, RAW_MAX_BYTES } from "@t3tools/shared/hqGitBrowse/blob";
import { ChangeRefused } from "../changes.ts";
import { GitHost } from "../gitHost.ts";
import { browseAccess } from "./access.ts";
import { BrowseRefused } from "./refused.ts";
import type { BrowseBytes, BrowseInput } from "./routes.ts";

const startsWith = (bytes: Uint8Array, at: number, magic: string) =>
  [...magic].every((char, index) => bytes[at + index] === char.charCodeAt(0));

/** An image by its first bytes; none for anything else. */
export const imageType = (bytes: Uint8Array) =>
  startsWith(bytes, 0, "\x89PNG\r\n\x1a\n")
    ? "image/png"
    : startsWith(bytes, 0, "\xff\xd8\xff")
      ? "image/jpeg"
      : startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a")
        ? "image/gif"
        : startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")
          ? "image/webp"
          : null;

export const rawRead = {
  read: "raw" as const,
  query: GitRawQuery,
  deadline: Duration.seconds(5),
  answer: ({ userId, appId, repo, query }: BrowseInput<typeof GitRawQuery.Type>) =>
    Effect.gen(function* () {
      const held = yield* browseAccess(userId, appId, repo);
      const git = yield* (yield* GitHost).git;
      const read = yield* git.browse.blob(held.repo, query.sha, query.path, {
        maxBytes: RAW_MAX_BYTES,
        refuseOver: RAW_MAX_BYTES,
      });
      if (read.kind === "commit-missing")
        return yield* new ChangeRefused({ code: "commit_not_found", reason: "commit_not_found" });
      if (read.kind === "too-large")
        return yield* new BrowseRefused({
          code: "too_large",
          limit: RAW_MAX_BYTES,
          size: read.size,
        });
      if (read.kind === "folder") return yield* new BrowseRefused({ code: "not_a_file" });
      if (read.kind !== "blob") return yield* new BrowseRefused({ code: "path_not_found" });
      const answer: BrowseBytes = {
        bytes: read.bytes,
        contentType:
          imageType(read.bytes) ??
          (read.binary ? "application/octet-stream" : "text/plain; charset=utf-8"),
        blobSha: read.blobSha,
        download: query.download === "1" ? (query.path.split("/").at(-1) ?? query.path) : null,
      };
      return answer;
    }),
};
