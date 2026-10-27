/**
 * `archive?sha=&format=`: a commit's files as one `tar.gz` or `zip`, streamed. The page reads at
 * most {@link ARCHIVE_MAX_BYTES} of it; past that it stops and offers the clone.
 *
 * @module hqGitBrowse/archive
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";

/** The most of an archive a page reads; a larger repository is cloned. */
export const ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
/** How long HQ streams an archive at most; it cuts the stream there. */
export const ARCHIVE_DEADLINE_MS = 120_000;

export const GitArchiveFormat = Schema.Literals(["tar.gz", "zip"]);
export type GitArchiveFormat = typeof GitArchiveFormat.Type;

export const GitArchiveQuery = Schema.Struct({ sha: Sha, format: GitArchiveFormat });
export type GitArchiveQuery = typeof GitArchiveQuery.Type;

/** The name a commit's archive is saved under: the repository and the commit's short id. */
export const archiveName = (repo: string, sha: string, format: GitArchiveFormat) =>
  `${repo}-${sha.slice(0, 7)}.${format}`;
