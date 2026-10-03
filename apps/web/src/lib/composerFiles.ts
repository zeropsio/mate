/**
 * A file in the composer that is not a picture (a PDF, a ZIP, an SVG): where
 * it sits in the prompt, what the draft keeps of it, and what a sent message
 * shows before the server answers.
 *
 * A file sits in the prompt as one character of its own, matched by order to
 * the draft's files as pictures are to its images: the n-th file placeholder
 * is `files[n]`. When the message is sent each placeholder becomes the file's
 * label, `[File n]`, on a line of its own (`@t3tools/shared/composerPictures`),
 * and the files go in the same order, ahead of the images.
 */
import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  isProviderSendTurnSupportedImageMimeType,
} from "@t3tools/contracts";

import type { ChatAttachment } from "../types";
import { INLINE_FILE_PLACEHOLDER, insertAttachmentPlaceholder } from "./composerPictures";
import { isHeicImageFile } from "./imageCompression";

/**
 * Neither the terminal contexts' object replacement character nor the
 * pictures' own: each kind is matched to its own list by order.
 */
export { INLINE_FILE_PLACEHOLDER };

/** The upload a file finished, which is what a reload brings back of it. */
export interface ComposerFileUpload {
  readonly environmentId: string;
  readonly attachmentId: string;
  /** When it finished (epoch ms): the server lets an unsent upload go a day later. */
  readonly uploadedAt: number;
}

/** How long the server keeps an upload no message claimed (`attachmentStore.ts`). */
export const COMPOSER_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether a finished upload is past the day the server keeps it, at `nowMs`. */
export function composerUploadExpired(upload: ComposerFileUpload, nowMs: number): boolean {
  return nowMs - upload.uploadedAt >= COMPOSER_UPLOAD_MAX_AGE_MS;
}

export interface ComposerFileAttachment {
  readonly type: "file";
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Its bytes, while this tab holds them; null after a reload, when only its upload stands. */
  readonly file: File | null;
  /** Its finished upload, once there is one. */
  readonly uploaded: ComposerFileUpload | null;
}

/** A file as a draft keeps it for a reload: what it is and where its upload went, never its bytes. */
export interface PersistedComposerFileAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly environmentId: string;
  readonly attachmentId: string;
  readonly uploadedAt: number;
}

export function countInlineFilePlaceholders(prompt: string): number {
  let count = 0;
  for (const char of prompt) {
    if (char === INLINE_FILE_PLACEHOLDER) count += 1;
  }
  return count;
}

/**
 * A file added at the caret, on a row with the pictures and files written
 * right next to it: its place in the prompt and its index among the files.
 */
export function insertInlineFilePlaceholder(
  prompt: string,
  cursorInput: number,
): { prompt: string; cursor: number; fileIndex: number } {
  const insertion = insertAttachmentPlaceholder(prompt, cursorInput, INLINE_FILE_PLACEHOLDER);
  return {
    prompt: insertion.prompt,
    cursor: insertion.cursor,
    fileIndex: countInlineFilePlaceholders(prompt.slice(0, insertion.at)),
  };
}

/**
 * A file's place taken out; alone on its line, the line goes with it, so
 * removing what was just added leaves the words as they were.
 */
export function removeInlineFilePlaceholder(
  prompt: string,
  fileIndex: number,
): { prompt: string; cursor: number } {
  let seen = 0;
  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_FILE_PLACEHOLDER) continue;
    if (seen === fileIndex) {
      const alone = (index === 0 || prompt[index - 1] === "\n") && prompt[index + 1] === "\n";
      return {
        prompt: prompt.slice(0, index) + prompt.slice(index + (alone ? 2 : 1)),
        cursor: index,
      };
    }
    seen += 1;
  }
  return { prompt, cursor: prompt.length };
}

/**
 * A prompt whose places no longer match its files one for one: places past
 * the last file leave, and missing ones go first, as pictures' do.
 */
export function reconcileInlineFilePlaceholders(prompt: string, fileCount: number): string {
  let extra = countInlineFilePlaceholders(prompt) - fileCount;
  if (extra < 0) return `${INLINE_FILE_PLACEHOLDER.repeat(-extra)}${prompt}`;
  let result = prompt;
  for (let index = result.length - 1; index >= 0 && extra > 0; index -= 1) {
    if (result[index] !== INLINE_FILE_PLACEHOLDER) continue;
    result = result.slice(0, index) + result.slice(index + 1);
    extra -= 1;
  }
  return result;
}

export function stripInlineFilePlaceholders(prompt: string): string {
  return prompt.replaceAll(INLINE_FILE_PLACEHOLDER, "");
}

/**
 * A draft's files as a reload brings them back. `fileIds` are every file the
 * draft held, in the order they sat: a file that was not kept (its upload had
 * not finished) leaves its place, and the rest come back in the text's order.
 */
export function restoreFilePlaces<A extends { readonly id: string }>(
  prompt: string,
  fileIds: ReadonlyArray<string> | undefined,
  files: ReadonlyArray<A>,
): { prompt: string; files: A[] } {
  if (fileIds === undefined) {
    return { prompt: reconcileInlineFilePlaceholders(prompt, files.length), files: [...files] };
  }
  const byId = new Map(files.map((entry) => [entry.id, entry]));
  let place = -1;
  const kept = [...prompt]
    .filter((char) => {
      if (char !== INLINE_FILE_PLACEHOLDER) return true;
      place += 1;
      const id = fileIds[place];
      return id !== undefined && byId.has(id);
    })
    .join("");
  const restored = fileIds.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  return {
    prompt: reconcileInlineFilePlaceholders(kept, restored.length),
    files: restored,
  };
}

const MAX_FILE_MEGABYTES = PROVIDER_SEND_TURN_MAX_FILE_BYTES / (1024 * 1024);

/**
 * Where something pasted or dropped goes: a picture Claude can look at goes
 * to the pictures, anything else that can be sent as a file to the files.
 */
export type ComposerAttachmentRoute =
  | { readonly kind: "picture" }
  | { readonly kind: "file" }
  | { readonly kind: "refused"; readonly message: string };

export function composerAttachmentRoute(
  file: Pick<File, "name" | "type" | "size">,
): ComposerAttachmentRoute {
  if (isHeicImageFile(file) || isProviderSendTurnSupportedImageMimeType(file.type)) {
    return { kind: "picture" };
  }
  if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
    return { kind: "refused", message: `'${file.name}' is larger than ${MAX_FILE_MEGABYTES} MB.` };
  }
  if (file.size === 0) {
    return { kind: "refused", message: `'${file.name}' is empty.` };
  }
  return { kind: "file" };
}

/**
 * A name cut to `max` characters in its middle, so its extension stays: the
 * end of a name is what tells files apart.
 */
export function fileChipName(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";
  if (extension.length === 0 || extension.length > max / 2) {
    return `${name.slice(0, max - 1)}…`;
  }
  return `${name.slice(0, max - extension.length - 1)}…${extension}`;
}

/** How many attachments the message carries: pictures, their kept originals and files. */
export function composerAttachmentCount(
  images: ReadonlyArray<{
    readonly picture?: { readonly keepOriginal: boolean; readonly source: Blob | null } | undefined;
  }>,
  files: ReadonlyArray<unknown>,
): number {
  const originals = images.filter((image) => image.picture?.keepOriginal && image.picture.source);
  return images.length + originals.length + files.length;
}

/** The files a sent message shows before the server answers, in the order they sit. */
export function optimisticFileAttachments(
  files: ReadonlyArray<ComposerFileAttachment>,
): ChatAttachment[] {
  return files.map((entry) => ({
    type: "file" as const,
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType || "application/octet-stream",
    sizeBytes: entry.sizeBytes,
  }));
}

/** What a draft saves of its files: the uploaded ones, by their upload. */
export function persistedComposerFiles(
  files: ReadonlyArray<ComposerFileAttachment>,
): PersistedComposerFileAttachment[] {
  return files.flatMap((entry) =>
    entry.uploaded === null
      ? []
      : [
          {
            id: entry.id,
            name: entry.name,
            mimeType: entry.mimeType,
            sizeBytes: entry.sizeBytes,
            environmentId: entry.uploaded.environmentId,
            attachmentId: entry.uploaded.attachmentId,
            uploadedAt: entry.uploaded.uploadedAt,
          },
        ],
  );
}

export function normalizePersistedComposerFile(
  value: unknown,
): PersistedComposerFileAttachment | null {
  if (!value || typeof value !== "object") return null;
  const { id, name, mimeType, sizeBytes, environmentId, attachmentId, uploadedAt } =
    value as Record<string, unknown>;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof name !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number" ||
    !Number.isFinite(sizeBytes) ||
    typeof environmentId !== "string" ||
    environmentId.length === 0 ||
    typeof attachmentId !== "string" ||
    attachmentId.length === 0
  ) {
    return null;
  }
  // A file saved without its upload's time reads as long expired.
  return {
    id,
    name,
    mimeType,
    sizeBytes,
    environmentId,
    attachmentId,
    uploadedAt: typeof uploadedAt === "number" && Number.isFinite(uploadedAt) ? uploadedAt : 0,
  };
}

/** The files a draft saved, back in the composer; one saved without its upload's time as long expired. */
export function hydrateComposerFiles(
  files: ReadonlyArray<
    Omit<PersistedComposerFileAttachment, "uploadedAt"> & { readonly uploadedAt?: number }
  >,
): ComposerFileAttachment[] {
  return files.map((entry) => ({
    type: "file",
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType,
    sizeBytes: entry.sizeBytes,
    file: null,
    uploaded: {
      environmentId: entry.environmentId,
      attachmentId: entry.attachmentId,
      uploadedAt: entry.uploadedAt ?? 0,
    },
  }));
}
