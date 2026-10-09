/**
 * The person's message with pictures and files, as the conversation lays it
 * out: words, pictures and files in the order they were written, each picture
 * with its notes and its kept original, and the images and files no label
 * places, which stay above the words as they always did.
 */
import { messageFiles, messagePictures, splitPictureText } from "@t3tools/shared/composerPictures";

import type { ParsedTerminalContextEntry } from "~/lib/terminalContext";
import { isImageAttachment, type ChatAttachment, type ChatImageAttachment } from "~/types";
import { formatInlineTerminalContextLabel } from "./userMessageTerminalContexts";

export type MessagePictureSegment =
  | {
      readonly kind: "text";
      /** How many pictures and files the words follow (0 before the first): what tells them apart. */
      readonly after: number;
      readonly text: string;
    }
  | {
      readonly kind: "picture";
      readonly n: number;
      readonly notes: ReadonlyArray<{ readonly number: number; readonly text: string }>;
      readonly image: ChatImageAttachment;
      readonly original: ChatAttachment | null;
    }
  | {
      readonly kind: "file";
      readonly n: number;
      readonly file: ChatAttachment;
    };

export interface PlacedMessagePictures {
  readonly segments: ReadonlyArray<MessagePictureSegment>;
  /** Images the text holds no label for: they stay above the words. */
  readonly unplaced: ReadonlyArray<ChatImageAttachment>;
  /** Files the text holds no label for: they stay above the words too. */
  readonly unplacedFiles: ReadonlyArray<ChatAttachment>;
}

const FILE_LABEL = /^\[File (\d+)\]$/u;

/** The message's words, pictures and files in their order, or null when it places none. */
export function placeMessagePictures(
  text: string,
  attachments: ReadonlyArray<ChatAttachment>,
): PlacedMessagePictures | null {
  const pictures = messagePictures(text, attachments);
  const files = messageFiles(text, attachments);
  const placedFiles = new Map(
    files.filter((entry) => entry.placed).map((entry) => [entry.n, entry.file] as const),
  );
  if (pictures.length === 0 && placedFiles.size === 0) return null;
  const segments: MessagePictureSegment[] = [];
  const shown = new Set<number>();
  let blocks = 0;
  const pushWords = (lines: ReadonlyArray<string>) => {
    const joined = lines.join("\n").replace(/^\n+|\n+$/gu, "");
    if (joined.trim().length > 0) segments.push({ kind: "text", after: blocks, text: joined });
  };
  for (const segment of splitPictureText(
    text,
    attachments.filter((attachment) => attachment.type === "image").length,
  )) {
    if (segment.kind === "text") {
      // A file's label on a line of its own is that file, once, where it stands.
      let words: string[] = [];
      for (const line of segment.text.split("\n")) {
        const n = Number(FILE_LABEL.exec(line)?.[1] ?? 0);
        const file = placedFiles.get(n);
        if (file === undefined || shown.has(n)) {
          words.push(line);
          continue;
        }
        pushWords(words);
        words = [];
        shown.add(n);
        blocks += 1;
        segments.push({ kind: "file", n, file });
      }
      pushWords(words);
      continue;
    }
    const picture = pictures[segment.n - 1];
    if (!picture || !isImageAttachment(picture.image)) continue;
    blocks += 1;
    segments.push({
      kind: "picture",
      n: segment.n,
      notes: segment.notes.map((note, noteIndex) => ({ number: noteIndex + 1, text: note })),
      image: picture.image,
      original: picture.original,
    });
  }
  const placed = new Set(pictures.map((picture) => picture.image.id));
  return {
    segments,
    unplaced: attachments.filter(
      (attachment): attachment is ChatImageAttachment =>
        isImageAttachment(attachment) && !placed.has(attachment.id),
    ),
    unplacedFiles: files.filter((entry) => !shown.has(entry.n)).map((entry) => entry.file),
  };
}

/** The person's message as a run's card repeats it: its words in short, and its pictures apart. */
export interface MessageEcho {
  /** The first line of what they wrote: never a picture's label or its notes. */
  readonly line: string;
  /** Its pictures in the order the conversation draws them: those no label places first. */
  readonly pictures: ReadonlyArray<ChatImageAttachment>;
}

/**
 * The person's message as the run's card repeats it: in short — the first
 * line of their words (the owner, 2026-09-28: "shown the user message in
 * short inside the working group"), never a line that is only a picture's
 * label — and its pictures apart, in the conversation's order.
 */
export function echoOfMessage(
  text: string,
  attachments: ReadonlyArray<ChatAttachment>,
): MessageEcho {
  const placed = placeMessagePictures(text, attachments);
  const words =
    placed === null
      ? [text]
      : placed.segments.flatMap((segment) => (segment.kind === "text" ? [segment.text] : []));
  const line =
    words
      .flatMap((part) => part.split("\n"))
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  return {
    line,
    pictures:
      placed === null
        ? attachments.filter(isImageAttachment)
        : [
            ...placed.unplaced,
            ...placed.segments.flatMap((segment) =>
              segment.kind === "picture" ? [segment.image] : [],
            ),
          ],
  };
}

/** A message's files, when its text places none of them (a phone's): all stay above the words. */
export function unplacedMessageFiles(
  text: string,
  attachments: ReadonlyArray<ChatAttachment>,
): ChatAttachment[] {
  return messageFiles(text, attachments).map((entry) => entry.file);
}

/**
 * The terminal contexts each run of words names, by the picture it follows:
 * each context goes to the words that hold its label, and one named nowhere
 * to the last words, where a message without pictures puts its chips.
 */
export function terminalContextsBySegment(
  segments: ReadonlyArray<MessagePictureSegment>,
  contexts: ReadonlyArray<ParsedTerminalContextEntry>,
): ReadonlyMap<number, ReadonlyArray<ParsedTerminalContextEntry>> {
  const texts = segments.filter(
    (segment): segment is Extract<MessagePictureSegment, { kind: "text" }> =>
      segment.kind === "text",
  );
  const bySegment = new Map<number, ParsedTerminalContextEntry[]>();
  const last = texts.at(-1);
  for (const context of contexts) {
    const label = formatInlineTerminalContextLabel(context);
    const home = texts.find((segment) => segment.text.includes(label)) ?? last;
    if (!home) continue;
    bySegment.set(home.after, [...(bySegment.get(home.after) ?? []), context]);
  }
  return bySegment;
}

export interface PictureSize {
  readonly width: number;
  readonly height: number;
}

/** Pictures in a message stand at most 300 px tall. */
const PICTURE_MAX_HEIGHT = 300;

/** Pictures written one after another sit side by side, at most this tall. */
export const GALLERY_PICTURE_MAX_HEIGHT = 160;

/**
 * The room a picture holds before it loads: its own size, carried on the
 * attachment from the composer or the server, else the size the server read
 * from its header; as wide as it will be, never wider than the message.
 */
/**
 * A picture's size as its message holds it: the attachment's own, else its stored original's — a
 * size the page has before any read, so its room is held from the first paint (a reload's picture
 * held 16:9 until the server's size came, and pushed the turns under it down 72 px).
 */
export function attachedPictureSize(
  image: Pick<ChatImageAttachment, "width" | "height" | "asset">,
): PictureSize | undefined {
  if (image.width !== undefined && image.height !== undefined)
    return { width: image.width, height: image.height };
  const original = image.asset?.original;
  return original?.status === "ready" &&
    original.width !== undefined &&
    original.height !== undefined
    ? { width: original.width, height: original.height }
    : undefined;
}

export function reservedPictureBox(
  image: Pick<ChatImageAttachment, "width" | "height" | "asset">,
  serverSize: PictureSize | undefined,
  maxHeight = PICTURE_MAX_HEIGHT,
): { readonly width: string; readonly aspectRatio: string } | null {
  const size = attachedPictureSize(image) ?? serverSize;
  if (!size) return null;
  const widest = Math.min(size.width, (maxHeight * size.width) / size.height);
  return {
    width: `min(100%, ${Math.round(widest)}px)`,
    aspectRatio: `${size.width} / ${size.height}`,
  };
}

export type MessagePictureRow<S> =
  | (S & { readonly kind: "text" })
  | { readonly kind: "row"; readonly items: ReadonlyArray<S> };

/**
 * The message as rows: words as they are, and the pictures written one after
 * another, with no words between them, together on one row.
 */
export function messagePictureRows<S extends { readonly kind: string }>(
  segments: ReadonlyArray<S>,
): MessagePictureRow<S>[] {
  const rows: MessagePictureRow<S>[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      rows.push(segment as S & { readonly kind: "text" });
      continue;
    }
    const last = rows.at(-1);
    if (last?.kind === "row") {
      rows[rows.length - 1] = { kind: "row", items: [...last.items, segment] };
    } else {
      rows.push({ kind: "row", items: [segment] });
    }
  }
  return rows;
}
