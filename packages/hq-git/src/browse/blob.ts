/**
 * A file of a commit: its size, whether it is binary (a NUL in its first 8 KiB), and its first
 * bytes up to what the caller reads.
 *
 * @module browse/blob
 */
import type { GitRunner } from "../git.ts";
import { lookupPath } from "./object.ts";

/** Bytes git's own binary check reads. */
const SNIFF_BYTES = 8 * 1024;

export type BlobRead =
  | {
      readonly kind: "blob";
      readonly blobSha: string;
      readonly size: number;
      readonly binary: boolean;
      readonly bytes: Uint8Array;
      readonly truncated: boolean;
    }
  /** Larger than the caller reads at all: nothing of it was read. */
  | { readonly kind: "too-large"; readonly size: number }
  | { readonly kind: "commit-missing" }
  | { readonly kind: "path-missing" };

export const readBlob = async (
  git: GitRunner,
  dir: string,
  sha: string,
  path: string,
  options: {
    /** Bytes kept; the rest is cut and said. */
    readonly maxBytes: number;
    /** Past it, nothing is read and the size is said. */
    readonly refuseOver?: number;
  },
  signal: AbortSignal,
): Promise<BlobRead> => {
  const found = await lookupPath(git, dir, sha, path, signal);
  if (found.kind !== "found") return found;
  const { object } = found;
  if (object.type !== "blob" || object.size === null) return { kind: "path-missing" };
  if (options.refuseOver !== undefined && object.size > options.refuseOver)
    return { kind: "too-large", size: object.size };
  const keep = Math.max(0, Math.floor(options.maxBytes));
  const read = await git.prefix(
    ["-C", dir, "cat-file", "blob", object.sha],
    signal,
    Math.max(keep, Math.min(SNIFF_BYTES, object.size)),
  );
  return {
    kind: "blob",
    blobSha: object.sha,
    size: object.size,
    binary: read.bytes.subarray(0, SNIFF_BYTES).includes(0),
    bytes: read.bytes.subarray(0, keep),
    truncated: object.size > keep,
  };
};
