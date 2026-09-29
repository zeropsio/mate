/**
 * Pictures in a person's message: the limits a picture is fitted to, and the
 * words that stand for it in the message's text.
 *
 * The composer writes each picture into the text where it sits, as its label
 * on a line of its own, followed by its notes numbered as its marks are:
 *
 *     The header on the home page feels off:
 *     [Picture 1]
 *     Notes on picture 1:
 *     1. The logo is too small next to the menu.
 *     2. Too much space above the product grid.
 *     Can you fix both?
 *
 * The message's n-th image attachment is picture n. The Claude adapter puts
 * each image right after its label, and the conversation draws each picture
 * where its label stands with its notes under it. A reader that knows none of
 * this sees the labels in the text and the images first, and the labels still
 * tie them together.
 */

/** Claude reads at most 2000 px a side once a request holds more than 20 images. */
export const PICTURE_MAX_EDGE = 2000;

/**
 * Claude takes at most 5 MB of base64 per image: the raw bytes that encode to
 * exactly that, 3,932,160.
 */
export const PICTURE_MAX_BYTES = Math.floor((5 * 1024 * 1024) / 4) * 3;

/** What a mark the person left without words says. */
export const PICTURE_EMPTY_NOTE = "Marked, no note.";

const LABEL_PATTERN = /^\[Picture (\d+)\]$/u;
const NOTE_PATTERN = /^(\d+)\. (.*)$/u;

export function pictureLabel(n: number): string {
  return `[Picture ${n}]`;
}

function notesHeading(n: number): string {
  return `Notes on picture ${n}:`;
}

/** A note as one line: its words, whitespace folded, or what an empty mark says. */
export function pictureNoteText(note: string): string {
  const words = note.replace(/\s+/gu, " ").trim();
  return words.length > 0 ? words : PICTURE_EMPTY_NOTE;
}

/** The text a picture stands for: its label, then its notes numbered as its marks. */
export function pictureBlockText(n: number, notes: ReadonlyArray<string>): string {
  if (notes.length === 0) return pictureLabel(n);
  return [
    pictureLabel(n),
    notesHeading(n),
    ...notes.map((note, index) => `${index + 1}. ${pictureNoteText(note)}`),
  ].join("\n");
}

export type PictureTextSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "picture"; readonly n: number; readonly notes: ReadonlyArray<string> };

/**
 * A message's text as words and pictures in the order they were written. Only
 * a label on a line of its own is a picture, only the next one in order, and
 * only while the message has an image for it: anything else stays words. A
 * picture's notes are the numbered lines under its heading, while the numbers
 * run on.
 */
export function splitPictureText(text: string, pictureCount: number): PictureTextSegment[] {
  const segments: PictureTextSegment[] = [];
  const lines = text.split("\n");
  let words: string[] = [];
  let next = 1;
  const flush = () => {
    const joined = words.join("\n").replace(/^\n+|\n+$/gu, "");
    if (joined.trim().length > 0) segments.push({ kind: "text", text: joined });
    words = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const label = LABEL_PATTERN.exec(line);
    if (label === null || Number(label[1]) !== next || next > pictureCount) {
      words.push(line);
      continue;
    }
    flush();
    const notes: string[] = [];
    if (lines[index + 1] === notesHeading(next)) {
      let cursor = index + 2;
      for (;;) {
        const note = NOTE_PATTERN.exec(lines[cursor] ?? "");
        if (note === null || Number(note[1]) !== notes.length + 1) break;
        notes.push(note[2]!);
        cursor += 1;
      }
      if (notes.length > 0) index = cursor - 1;
    }
    segments.push({ kind: "picture", n: next, notes });
    next += 1;
  }
  flush();
  return segments;
}

/**
 * What the person wrote in a message with pictures: the words, and each
 * picture's notes in its place. A label is not something they wrote, nor is
 * the line an empty mark stands for.
 */
export function pictureWords(text: string, pictureCount: number): string {
  return splitPictureText(text, pictureCount)
    .flatMap((segment) =>
      segment.kind === "text"
        ? [segment.text]
        : segment.notes.filter((note) => note !== PICTURE_EMPTY_NOTE),
    )
    .join("\n");
}

export interface MessagePicture<A> {
  readonly n: number;
  readonly image: A;
  /** The untouched file the person kept beside the picture, for the Mate to use. */
  readonly original: A | null;
}

/**
 * A message's pictures: its n-th image is picture n while its text holds the
 * label, and an image-typed file right after a picture's image is that
 * picture's kept original (the composer sends it there).
 */
export function messagePictures<A extends { readonly type: string; readonly mimeType: string }>(
  text: string,
  attachments: ReadonlyArray<A>,
): MessagePicture<A>[] {
  const imageCount = attachments.filter((attachment) => attachment.type === "image").length;
  const labelled = splitPictureText(text, imageCount).filter(
    (segment) => segment.kind === "picture",
  ).length;
  const pictures: MessagePicture<A>[] = [];
  attachments.forEach((attachment, index) => {
    if (attachment.type !== "image" || pictures.length >= labelled) return;
    const next = attachments[index + 1];
    const original =
      next && next.type === "file" && next.mimeType.startsWith("image/") ? next : null;
    pictures.push({ n: pictures.length + 1, image: attachment, original });
  });
  return pictures;
}

export type PictureContentPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly index: number };

/**
 * The message as the Mate reads it: each image right after its label, and the
 * words between them as text, exactly as written. An image the text holds no
 * label for goes first, as images always did. Null when the text places no
 * image, so a caller keeps its own order.
 */
export function interleavePictures(text: string, imageCount: number): PictureContentPart[] | null {
  const parts: PictureContentPart[] = [];
  let cursor = 0;
  let next = 1;
  for (const match of text.matchAll(/^\[Picture (\d+)\]$/gmu)) {
    if (Number(match[1]) !== next || next > imageCount) continue;
    const end = (match.index ?? 0) + match[0].length;
    parts.push({ kind: "text", text: text.slice(cursor, end) });
    parts.push({ kind: "image", index: next - 1 });
    cursor = text[end] === "\n" ? end + 1 : end;
    next += 1;
  }
  if (next === 1) return null;
  const rest = text.slice(cursor);
  if (rest.trim().length > 0) parts.push({ kind: "text", text: rest });
  const unplaced: PictureContentPart[] = [];
  for (let index = next - 1; index < imageCount; index += 1) {
    unplaced.push({ kind: "image", index });
  }
  return [...unplaced, ...parts];
}
