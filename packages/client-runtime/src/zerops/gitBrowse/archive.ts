/**
 * `archive`: a commit's files as one `tar.gz` or `zip`, read as a `Blob` through
 * `HqApi.gitBrowseBytes` and saved by the page: HQ's sign-in is a Bearer header, so no link reaches
 * HQ itself. At most {@link ARCHIVE_MAX_BYTES} is read; past it the read stops, refused
 * `too_large`, and the page offers the clone.
 *
 * @module zerops/gitBrowse/archive
 */
import * as Schema from "effect/Schema";
import { ARCHIVE_MAX_BYTES, GitArchiveQuery } from "@t3tools/shared/hqGitBrowse/archive";

export const archiveRead = {
  query: GitArchiveQuery,
  value: Schema.instanceOf(Blob),
  moving: false,
  bytes: { limit: ARCHIVE_MAX_BYTES },
} as const;
