/**
 * The person's message with pictures, as the conversation lays it out: words
 * and pictures in the order they were written, each picture with its notes and
 * its kept original, and the images no label places, which stay above the
 * words as they always did.
 */
import { messagePictures, splitPictureText } from "@t3tools/shared/composerPictures";

import type { ParsedTerminalContextEntry } from "~/lib/terminalContext";
import { isImageAttachment, type ChatAttachment, type ChatImageAttachment } from "~/types";
import { formatInlineTerminalContextLabel } from "./userMessageTerminalContexts";

export type MessagePictureSegment =
  | {
      readonly kind: "text";
      /** The picture the words follow (0 before the first): what tells them apart. */
      readonly after: number;
      readonly text: string;
    }
  | {
      readonly kind: "picture";
      readonly n: number;
      readonly notes: ReadonlyArray<{ readonly number: number; readonly text: string }>;
      readonly image: ChatImageAttachment;
      readonly original: ChatAttachment | null;
    };

export interface PlacedMessagePictures {
  readonly segments: ReadonlyArray<MessagePictureSegment>;
  /** Images the text holds no label for: they stay above the words. */
  readonly unplaced: ReadonlyArray<ChatImageAttachment>;
}

/** The message's words and pictures in their order, or null when it places none. */
export function placeMessagePictures(
  text: string,
  attachments: ReadonlyArray<ChatAttachment>,
): PlacedMessagePictures | null {
  const pictures = messagePictures(text, attachments);
  if (pictures.length === 0) return null;
  const segments = splitPictureText(
    text,
    attachments.filter((attachment) => attachment.type === "image").length,
  ).flatMap((segment, index, all): MessagePictureSegment[] => {
    if (segment.kind === "text") {
      const before = all.slice(0, index).findLast((part) => part.kind === "picture");
      return [
        { kind: "text", after: before?.kind === "picture" ? before.n : 0, text: segment.text },
      ];
    }
    const picture = pictures[segment.n - 1];
    return picture && isImageAttachment(picture.image)
      ? [
          {
            kind: "picture",
            n: segment.n,
            notes: segment.notes.map((text, noteIndex) => ({ number: noteIndex + 1, text })),
            image: picture.image,
            original: picture.original,
          },
        ]
      : [];
  });
  const placed = new Set(pictures.map((picture) => picture.image.id));
  return {
    segments,
    unplaced: attachments.filter(
      (attachment): attachment is ChatImageAttachment =>
        isImageAttachment(attachment) && !placed.has(attachment.id),
    ),
  };
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

/**
 * The room a picture holds before it loads: its own size, carried on the
 * attachment from the composer or the server, else the size the server read
 * from its header; as wide as it will be, never wider than the message.
 */
export function reservedPictureBox(
  image: Pick<ChatImageAttachment, "width" | "height">,
  serverSize: PictureSize | undefined,
): { readonly width: string; readonly aspectRatio: string } | null {
  const size =
    image.width !== undefined && image.height !== undefined
      ? { width: image.width, height: image.height }
      : serverSize;
  if (!size) return null;
  const widest = Math.min(size.width, (PICTURE_MAX_HEIGHT * size.width) / size.height);
  return {
    width: `min(100%, ${Math.round(widest)}px)`,
    aspectRatio: `${size.width} / ${size.height}`,
  };
}
