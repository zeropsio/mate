/**
 * `blob`: a file of a commit as the browser shows it (`@t3tools/shared/hqGitBrowse/blob`). Pinned
 * to its commit, it is read once while held.
 *
 * @module zerops/gitBrowse/blob
 */
import { GitBlob, GitBlobQuery, RAW_MAX_BYTES } from "@t3tools/shared/hqGitBrowse/blob";

export const blobRead = { query: GitBlobQuery, value: GitBlob, moving: false } as const;

/** A size as people read it: `512 bytes`, `12.5 KiB`, `3.1 MiB`. */
export const fileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, "KiB"] : [bytes / 1024 / 1024, "MiB"];
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
};

/** Lines of a text: a last line without its newline still counts. */
export const lineCount = (content: string) => {
  if (content === "") return 0;
  const breaks = content.match(/\r\n|\r|\n/gu)?.length ?? 0;
  return /(?:\r\n|\r|\n)$/u.test(content) ? breaks : breaks + 1;
};

export const isMarkdownPath = (path: string) => /\.(?:md|markdown)$/iu.test(path);
/** Images the browser shows from their bytes (the kinds `raw` sends as images). */
export const isImagePath = (path: string) => /\.(?:png|jpe?g|gif|webp)$/iu.test(path);

/** What a file view draws for a file. */
export type FileShape =
  | { readonly kind: "text"; readonly content: string; readonly cut: boolean }
  | { readonly kind: "image" }
  | { readonly kind: "binary" }
  /** Past what the browser reads at all: neither shown nor downloaded here. */
  | { readonly kind: "beyond" };

export const fileShape = (blob: GitBlob): FileShape =>
  isImagePath(blob.path) && blob.size <= RAW_MAX_BYTES
    ? { kind: "image" }
    : blob.content === null
      ? blob.size > RAW_MAX_BYTES
        ? { kind: "beyond" }
        : { kind: "binary" }
      : { kind: "text", content: blob.content, cut: blob.truncated };

/** Whether the file's bytes can be read here: raw and download stop at 1 MiB. */
export const readableRaw = (blob: Pick<GitBlob, "size">) => blob.size <= RAW_MAX_BYTES;
