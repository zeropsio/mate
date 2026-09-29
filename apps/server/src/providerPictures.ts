/**
 * How a message's pictures reach the providers: where Claude reads each one,
 * what the saved-at lines call them, and what a turn that ended on a picture
 * Claude could not read says about it.
 *
 * The composer writes each picture into the text as its label, `[Picture n]`,
 * with its notes after it; the message's n-th image is picture n and a kept
 * original is the file right after it (`@t3tools/shared/composerPictures`).
 * The provider adapters stay as upstream wrote them but for a call to these.
 */
import {
  PICTURE_MAX_BYTES,
  PICTURE_MAX_EDGE,
  interleavePictures,
  messagePictures,
} from "@t3tools/shared/composerPictures";

type ContentBlock = Record<string, unknown>;

const isText = (block: ContentBlock | undefined): block is ContentBlock & { text: string } =>
  block?.type === "text" && typeof block.text === "string";

/**
 * Claude's content with each picture right after its label and the words
 * between them as text blocks. It takes the images-first content the adapter
 * builds, `[image…, text]`, and leaves any other shape as it is: a skill's
 * leading words, a slash command, a message that places no picture, or one
 * whose last text would start with a slash or would not be last. The Claude
 * CLI runs a command only from the last text block, so that block must stay
 * last, and must not read as a command unless it was one.
 */
export function placeClaudePictures(content: ReadonlyArray<ContentBlock>): ContentBlock[] {
  const last = content.at(-1);
  const images = content.slice(0, -1);
  if (!isText(last) || images.some((block) => block.type !== "image")) return [...content];
  if (last.text.trimStart().startsWith("/")) return [...content];
  const parts = interleavePictures(last.text, images.length);
  const end = parts?.at(-1);
  if (!parts || end?.kind !== "text" || end.text.trimStart().startsWith("/")) return [...content];
  return parts.map((part) =>
    part.kind === "text" ? { type: "text", text: part.text } : images[part.index]!,
  );
}

/** A picture a turn sent, as the person knows it. */
export interface SentPicture {
  /** "Picture 2" where the text placed it, else its file name in quotes. */
  readonly label: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
}

interface PictureAttachment {
  readonly type: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width?: number;
  readonly height?: number;
}

/** The pictures Claude was sent, named as the person knows them. */
export function sentPictures(
  text: string,
  attachments: ReadonlyArray<PictureAttachment>,
): SentPicture[] {
  const placed = new Map(
    messagePictures(text, attachments).map((picture) => [picture.image, picture.n]),
  );
  return attachments.flatMap((attachment): SentPicture[] => {
    if (attachment.type !== "image") return [];
    const n = placed.get(attachment);
    return [
      {
        label: n === undefined ? `"${attachment.name}"` : `Picture ${n}`,
        bytes: attachment.sizeBytes,
        ...(attachment.width !== undefined && attachment.height !== undefined
          ? { width: attachment.width, height: attachment.height }
          : {}),
      },
    ];
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / 1_048_576;
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

const overLimits = (picture: SentPicture): boolean =>
  picture.bytes > PICTURE_MAX_BYTES ||
  (picture.width ?? 0) > PICTURE_MAX_EDGE ||
  (picture.height ?? 0) > PICTURE_MAX_EDGE;

/**
 * What the person reads when Claude could not read a picture: the one over its
 * limits, by name and size, and what to do; else where the fault may be. Every
 * earlier picture of a chat goes back with each message, so one sent before
 * can end a turn that sent none.
 */
export function claudePictureErrorMessage(pictures: ReadonlyArray<SentPicture>): string {
  const culprit = pictures.find(overLimits);
  if (culprit) {
    const size =
      culprit.width !== undefined && culprit.height !== undefined
        ? `${culprit.width} × ${culprit.height}, ${formatBytes(culprit.bytes)}`
        : formatBytes(culprit.bytes);
    return `Claude couldn't read ${culprit.label} (${size}): it reads pictures of at most ${PICTURE_MAX_EDGE} px a side and ${formatBytes(PICTURE_MAX_BYTES)}. Send a smaller copy, or crop it to what matters.`;
  }
  if (pictures.length > 0) {
    return "Claude couldn't read a picture in this chat. If it is the one you just sent, send it again as a PNG or JPEG; if it is an earlier one, start a new chat to go on without it.";
  }
  return "Claude couldn't read a picture earlier in this chat, and it goes back to it with every message. Start a new chat to go on without it.";
}

const turnPictures = new WeakMap<object, ReadonlyArray<SentPicture>>();

/** Keeps the pictures a message sent with the turn it went into, a steer adding to them. */
export function rememberTurnPictures(
  turn: object | undefined,
  message: {
    readonly input?: string | undefined;
    readonly attachments?: ReadonlyArray<PictureAttachment> | undefined;
  },
): void {
  if (turn === undefined) return;
  const pictures = sentPictures(message.input ?? "", message.attachments ?? []);
  if (pictures.length === 0 && turnPictures.has(turn)) return;
  turnPictures.set(turn, [...(turnPictures.get(turn) ?? []), ...pictures]);
}

/** A turn's failure in the person's words when Claude could not read a picture. */
export function turnPictureError(
  result: { readonly terminal_reason?: string | null | undefined },
  turn: object | undefined,
): string | undefined {
  if (result.terminal_reason !== "image_error" || turn === undefined) return undefined;
  return claudePictureErrorMessage(turnPictures.get(turn) ?? []);
}

/**
 * The line that tells an agent where an attachment is saved: a picture by its
 * label and a kept original as its picture's, everything else as before.
 */
export function attachmentPathLine(
  attachment: PictureAttachment & { readonly source?: { readonly _tag: string } | undefined },
  path: string,
  message: { readonly text: string; readonly attachments: ReadonlyArray<PictureAttachment> },
): string {
  const pictures = messagePictures(message.text, message.attachments);
  const picture = pictures.find((entry) => entry.image === attachment);
  if (picture) return `[Picture ${picture.n} is saved at: ${path}]`;
  const original = pictures.find((entry) => entry.original === attachment);
  if (original) {
    return `[Picture ${original.n}'s original, "${attachment.name}", is saved at: ${path}]`;
  }
  if (attachment.type === "file" && attachment.source?._tag === "pasted-text") {
    return `[Pasted text "${attachment.name}" is saved at: ${path}. Inspect it as needed.]`;
  }
  return `[Attached ${attachment.type} "${attachment.name}" is saved at: ${path}]`;
}

/**
 * The attachments a provider takes as the model's own files: all but a
 * picture's kept original, which is for the agent to use, not to look at, and
 * which its saved-at line already names.
 */
export function withoutPictureOriginals<
  A extends { readonly type: string; readonly mimeType: string },
>(text: string, attachments: ReadonlyArray<A>): A[] {
  const originals = new Set<A>(
    messagePictures(text, attachments).flatMap((picture) =>
      picture.original === null ? [] : [picture.original],
    ),
  );
  return attachments.filter((attachment) => !originals.has(attachment));
}
