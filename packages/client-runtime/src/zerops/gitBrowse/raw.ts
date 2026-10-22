/**
 * `raw`: a file's bytes, at most 1 MiB (`@t3tools/shared/hqGitBrowse/blob`), read as a `Blob`
 * through `HqApi.gitBrowseBytes`: HQ's sign-in is a Bearer header, so no link reaches HQ itself.
 * Pinned to its commit, it is read once while held.
 *
 * @module zerops/gitBrowse/raw
 */
import * as Schema from "effect/Schema";
import { GitRawQuery, RAW_MAX_BYTES } from "@t3tools/shared/hqGitBrowse/blob";

export const rawRead = {
  query: GitRawQuery,
  value: Schema.instanceOf(Blob),
  moving: false,
  bytes: { limit: RAW_MAX_BYTES },
} as const;

const IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * The type a file's bytes are held as, from HQ's `Content-Type`: an image HQ named one, plain
 * text, or an octet stream — never a type a browser runs when the bytes are opened.
 */
export const heldType = (contentType: string | null) => {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return IMAGES.has(type)
    ? type
    : type === "text/plain"
      ? "text/plain;charset=utf-8"
      : "application/octet-stream";
};
