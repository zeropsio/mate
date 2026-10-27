/**
 * `blob?sha=&path=`: a file of a commit as the browser shows it — its first
 * {@link SOURCE_FILE_MAX_BYTES} as text, or no text where it is binary (a NUL in its first 8 KiB).
 * `raw?sha=&path=&download=`: its bytes, at most {@link RAW_MAX_BYTES}, as plain text, an image or
 * an octet stream; never anything a browser runs.
 *
 * @module hqGitBrowse/blob
 */
import * as Schema from "effect/Schema";
import { Sha } from "../hqChanges.ts";
import { FilePath } from "./common.ts";

export { RAW_MAX_BYTES, SOURCE_FILE_MAX_BYTES } from "./common.ts";

export const GitBlobQuery = Schema.Struct({ sha: Sha, path: FilePath });
export type GitBlobQuery = typeof GitBlobQuery.Type;

export const GitBlob = Schema.Struct({
  path: Schema.String,
  blobSha: Sha,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  binary: Schema.Boolean,
  /** None for a binary file. */
  content: Schema.NullOr(Schema.String),
  /** The text stops before the file does. */
  truncated: Schema.Boolean,
});
export type GitBlob = typeof GitBlob.Type;

export const GitRawQuery = Schema.Struct({
  sha: Sha,
  path: FilePath,
  /** `1`: sent as a download named after the file. */
  download: Schema.optionalKey(Schema.Literals(["0", "1"])),
});
export type GitRawQuery = typeof GitRawQuery.Type;
