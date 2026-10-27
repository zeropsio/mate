/**
 * A picture in the composer: where it sits in the prompt, what the person did
 * to it, and the text it becomes when the message goes.
 *
 * A picture sits in the prompt as one character, matched by order to the
 * draft's images the way terminal contexts are matched to theirs: the n-th
 * placeholder is `images[n]`. When the message is sent each placeholder
 * becomes the picture's label and notes (`@t3tools/shared/composerPictures`),
 * on lines of their own, and the images go in the same order.
 */
import {
  escapePictureWords,
  fileLabel,
  pictureBlockText,
  readsAsPictureNote,
} from "@t3tools/shared/composerPictures";

import type { ComposerImageAttachment } from "../composerDraftStore";
import type { ChatAttachment } from "../types";

/**
 * Not the object replacement character terminal contexts use: the two are
 * matched to their own lists by order, so they cannot share one.
 */
export const INLINE_PICTURE_PLACEHOLDER = "￻";

/**
 * A file's place (`./composerFiles`), defined here beside the picture's so a
 * row knows both without the two modules reaching into each other.
 */
export const INLINE_FILE_PLACEHOLDER = "\uFFFA";

export interface PictureRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PicturePoint {
  readonly x: number;
  readonly y: number;
}

/** A numbered mark on the picture, in the source's pixels: a pinned spot or a boxed area. */
export type PictureMark =
  | {
      readonly kind: "pin";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly note: string;
    }
  | {
      readonly kind: "box";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly note: string;
    };

/**
 * How a picture came to be the copy the Mate sees. The copy itself is the
 * attachment's file; this is what it was made from, so it can be made again.
 */
export interface ComposerPicture {
  /** The file as it was pasted; null once a reload dropped it (the copy stays). */
  readonly source: File | null;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly crop: PictureRect;
  readonly marks: ReadonlyArray<PictureMark>;
  /** Send the untouched file too, for the Mate to use; it still looks at the copy. */
  readonly keepOriginal: boolean;
  /** The copy's size in pixels. */
  readonly width: number;
  readonly height: number;
  /** The copy is the pasted file itself: nothing drawn on it, nothing cut, within the limits. */
  readonly asPasted: boolean;
  /** Preparing: the copy is being made and cannot go yet. */
  readonly preparing: boolean;
}

export function countInlinePicturePlaceholders(prompt: string): number {
  let count = 0;
  for (const char of prompt) {
    if (char === INLINE_PICTURE_PLACEHOLDER) count += 1;
  }
  return count;
}

/** Whether a character of the prompt is the place of a picture or a file: what a row is made of. */
export function isAttachmentPlaceholder(char: string | undefined): boolean {
  return char === INLINE_PICTURE_PLACEHOLDER || char === INLINE_FILE_PLACEHOLDER;
}

/**
 * A picture or file put in at the caret, on a row with the ones written right
 * next to it: on the empty line under a row it joins that row, and a line
 * break follows it unless one already does, so the caret goes on below the
 * row, never beside it.
 */
export function insertAttachmentPlaceholder(
  prompt: string,
  cursorInput: number,
  placeholder: string,
): { prompt: string; cursor: number; at: number } {
  const cursor = Math.max(0, Math.min(prompt.length, Math.floor(cursorInput)));
  const onEmptyLineUnderRow =
    prompt[cursor - 1] === "\n" &&
    isAttachmentPlaceholder(prompt[cursor - 2]) &&
    (cursor === prompt.length || prompt[cursor] === "\n");
  const at = onEmptyLineUnderRow ? cursor - 1 : cursor;
  const rest = prompt.slice(at);
  return {
    prompt: `${prompt.slice(0, at)}${placeholder}${rest.startsWith("\n") ? "" : "\n"}${rest}`,
    cursor: at + 2,
    at,
  };
}

/** A picture pasted at the caret: its place in the prompt and its index among the pictures. */
export function insertInlinePicturePlaceholder(
  prompt: string,
  cursorInput: number,
): { prompt: string; cursor: number; pictureIndex: number } {
  const insertion = insertAttachmentPlaceholder(prompt, cursorInput, INLINE_PICTURE_PLACEHOLDER);
  return {
    prompt: insertion.prompt,
    cursor: insertion.cursor,
    pictureIndex: countInlinePicturePlaceholders(prompt.slice(0, insertion.at)),
  };
}

/**
 * A picture's place taken out; alone on its line, the line goes with it, so
 * removing what was just pasted leaves the words as they were.
 */
export function removeInlinePicturePlaceholder(
  prompt: string,
  pictureIndex: number,
): { prompt: string; cursor: number } {
  let seen = 0;
  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== INLINE_PICTURE_PLACEHOLDER) continue;
    if (seen === pictureIndex) {
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
 * A draft that holds more pictures than places for them (one written before
 * pictures had places) puts the rest first, where they used to go.
 */
export function ensureInlinePicturePlaceholders(prompt: string, pictureCount: number): string {
  const missing = pictureCount - countInlinePicturePlaceholders(prompt);
  return missing > 0 ? `${INLINE_PICTURE_PLACEHOLDER.repeat(missing)}${prompt}` : prompt;
}

/**
 * A prompt whose places no longer match its pictures one for one (a restored
 * stash that lost a picture on the way): places past the last picture leave,
 * and missing ones go first.
 */
export function reconcileInlinePicturePlaceholders(prompt: string, pictureCount: number): string {
  let extra = countInlinePicturePlaceholders(prompt) - pictureCount;
  if (extra <= 0) return ensureInlinePicturePlaceholders(prompt, pictureCount);
  let result = prompt;
  for (let index = result.length - 1; index >= 0 && extra > 0; index -= 1) {
    if (result[index] !== INLINE_PICTURE_PLACEHOLDER) continue;
    result = result.slice(0, index) + result.slice(index + 1);
    extra -= 1;
  }
  return result;
}

/**
 * A draft's pictures as a reload brings them back. `pictureIds` are the
 * pictures the draft held, in the order they sat, and so the ids of its
 * places, one by one: a picture that could not be kept (the browser's storage
 * ran out) leaves its place, and the rest come back in the text's order,
 * whatever order they were saved in. A draft saved without ids stays as it was.
 */
export function restorePicturePlaces<A extends { readonly id: string }>(
  prompt: string,
  pictureIds: ReadonlyArray<string> | undefined,
  attachments: ReadonlyArray<A>,
): { prompt: string; attachments: A[] } {
  if (pictureIds === undefined) return { prompt, attachments: [...attachments] };
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  let place = -1;
  const kept = [...prompt]
    .filter((char) => {
      if (char !== INLINE_PICTURE_PLACEHOLDER) return true;
      place += 1;
      const id = pictureIds[place];
      return id === undefined || byId.has(id);
    })
    .join("");
  const named = new Set(pictureIds);
  return {
    prompt: kept,
    attachments: [
      ...pictureIds.flatMap((id) => {
        const attachment = byId.get(id);
        return attachment ? [attachment] : [];
      }),
      ...attachments.filter((attachment) => !named.has(attachment.id)),
    ],
  };
}

/** Why the message cannot go while pictures are still being made, or null. */
export function picturesBlockReason(
  images: ReadonlyArray<{ readonly picture?: Pick<ComposerPicture, "preparing"> | undefined }>,
): string | null {
  const preparing = images.filter((image) => image.picture?.preparing).length;
  if (preparing === 0) return null;
  return preparing === 1 ? "Picture still preparing" : "Pictures still preparing";
}

export function stripInlinePicturePlaceholders(prompt: string): string {
  return prompt.replaceAll(INLINE_PICTURE_PLACEHOLDER, "");
}

/**
 * The prompt with each picture's place written out as its label and notes, and
 * each file's as its label, on lines of their own: pictures numbered in the
 * order they sit, files in theirs. A place without a picture or a file says
 * nothing. Terminal-context places are left for their own materializer. The
 * person's own words never read as a picture's or a file's lines.
 */
export function materializePicturePrompt(
  prompt: string,
  images: ReadonlyArray<{ readonly picture?: Pick<ComposerPicture, "marks"> | undefined }>,
  files: ReadonlyArray<unknown> = [],
): string {
  const placed = ensureInlinePicturePlaceholders(prompt, images.length);
  if (countInlinePicturePlaceholders(placed) === 0 && !placed.includes(INLINE_FILE_PLACEHOLDER)) {
    return placed;
  }
  const parts: string[] = [];
  let words = "";
  let pictureIndex = 0;
  let fileIndex = 0;
  let blocks = 0;
  let afterNotes = false;
  const flush = (text: string) => {
    if (text.trim().length === 0) return;
    if (afterNotes && readsAsPictureNote(text)) parts.push("");
    parts.push(escapePictureWords(text));
  };
  const place = (block: string, notes: boolean) => {
    flush(blocks === 0 && parts.length === 0 ? words.replace(/\s+$/u, "") : trimBoth(words));
    words = "";
    blocks += 1;
    parts.push(block);
    afterNotes = notes;
  };
  for (const char of placed) {
    if (char === INLINE_PICTURE_PLACEHOLDER) {
      const image = images[pictureIndex];
      pictureIndex += 1;
      if (!image) continue;
      const notes = image.picture?.marks.map((mark) => mark.note) ?? [];
      place(pictureBlockText(pictureIndex, notes), notes.length > 0);
    } else if (char === INLINE_FILE_PLACEHOLDER) {
      const file = files[fileIndex];
      fileIndex += 1;
      if (file === undefined) continue;
      place(fileLabel(fileIndex), false);
    } else {
      words += char;
    }
  }
  flush(blocks === 0 ? words : words.replace(/^\s+/u, ""));
  return parts.join("\n");
}

const trimBoth = (text: string): string => text.replace(/^\s+|\s+$/gu, "");

/**
 * Whether an edit changes what the copy shows: its crop, or where its marks
 * sit and the order that numbers them. A note is words of the message, not
 * pixels of the copy.
 */
export function pictureNeedsNewCopy(
  before: Pick<ComposerPicture, "crop" | "marks">,
  after: Pick<ComposerPicture, "crop" | "marks">,
): boolean {
  const { crop } = before;
  if (
    crop.x !== after.crop.x ||
    crop.y !== after.crop.y ||
    crop.w !== after.crop.w ||
    crop.h !== after.crop.h ||
    before.marks.length !== after.marks.length
  ) {
    return true;
  }
  return before.marks.some((mark, index) => {
    const other = after.marks[index]!;
    if (mark.kind !== other.kind || mark.x !== other.x || mark.y !== other.y) return true;
    return (
      mark.kind === "box" && other.kind === "box" && (mark.w !== other.w || mark.h !== other.h)
    );
  });
}

export function fullPictureCrop(width: number, height: number): PictureRect {
  return { x: 0, y: 0, w: width, h: height };
}

export function isFullPictureCrop(
  picture: Pick<ComposerPicture, "crop" | "sourceWidth" | "sourceHeight">,
): boolean {
  const { crop } = picture;
  return (
    crop.x === 0 &&
    crop.y === 0 &&
    crop.w === picture.sourceWidth &&
    crop.h === picture.sourceHeight
  );
}

/**
 * The marks a crop keeps: pins inside it, boxes cut to it. What falls
 * outside goes, and the caller says how many.
 */
export function cropPictureMarks(
  marks: ReadonlyArray<PictureMark>,
  crop: PictureRect,
): { marks: PictureMark[]; removed: number } {
  const kept = marks.flatMap((mark): PictureMark[] => {
    if (mark.kind === "pin") {
      const inside =
        mark.x >= crop.x &&
        mark.x <= crop.x + crop.w &&
        mark.y >= crop.y &&
        mark.y <= crop.y + crop.h;
      return inside ? [mark] : [];
    }
    const x1 = Math.max(mark.x, crop.x);
    const y1 = Math.max(mark.y, crop.y);
    const x2 = Math.min(mark.x + mark.w, crop.x + crop.w);
    const y2 = Math.min(mark.y + mark.h, crop.y + crop.h);
    if (x2 <= x1 || y2 <= y1) return [];
    return [{ ...mark, x: x1, y: y1, w: x2 - x1, h: y2 - y1 }];
  });
  return { marks: kept, removed: marks.length - kept.length };
}

/**
 * The mark under a point, topmost first: a pin's disc, a box's number (at its
 * corner) or its edge. Distances are in the source's pixels.
 */
export function pictureMarkAt(
  marks: ReadonlyArray<PictureMark>,
  point: PicturePoint,
  reach: { readonly pinRadius: number; readonly edge: number },
): number {
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index]!;
    if (Math.hypot(point.x - mark.x, point.y - mark.y) <= reach.pinRadius) return index;
    if (mark.kind !== "box") continue;
    const { edge } = reach;
    const withinX = point.x >= mark.x - edge && point.x <= mark.x + mark.w + edge;
    const withinY = point.y >= mark.y - edge && point.y <= mark.y + mark.h + edge;
    const nearSide =
      Math.abs(point.x - mark.x) <= edge || Math.abs(point.x - mark.x - mark.w) <= edge;
    const nearTopOrBottom =
      Math.abs(point.y - mark.y) <= edge || Math.abs(point.y - mark.y - mark.h) <= edge;
    if ((nearSide && withinY) || (nearTopOrBottom && withinX)) return index;
  }
  return -1;
}

/** The picture in the text: 80 px tall, as wide as its crop allows between 48 and 240. */
export const PICTURE_THUMB_HEIGHT = 80;

export function pictureThumbSize(crop: Pick<PictureRect, "w" | "h">): {
  width: number;
  height: number;
} {
  const aspect = crop.w / Math.max(1, crop.h);
  return {
    width: Math.round(Math.max(48, Math.min(240, PICTURE_THUMB_HEIGHT * aspect))),
    height: PICTURE_THUMB_HEIGHT,
  };
}

/**
 * The attachments a sent message shows before the server answers: each
 * picture at its copy's size, so it holds its room from the first paint, and
 * a kept original right after its picture, as it is sent.
 */
export function optimisticPictureAttachments(
  images: ReadonlyArray<ComposerImageAttachment>,
): ChatAttachment[] {
  return images.flatMap((image): ChatAttachment[] => {
    const original = image.picture?.keepOriginal ? image.picture.source : null;
    return [
      {
        type: "image",
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        previewUrl: image.previewUrl,
        ...(image.picture ? { width: image.picture.width, height: image.picture.height } : {}),
      },
      ...(original
        ? [
            {
              type: "file" as const,
              id: `${image.id}-original`,
              name: original.name || image.name,
              mimeType: original.type || "application/octet-stream",
              sizeBytes: original.size,
            },
          ]
        : []),
    ];
  });
}
