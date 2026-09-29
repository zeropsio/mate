/**
 * ClaudePictureError — what the person reads when Claude ends a turn on
 * `image_error`: which picture it could not read and what to do about it.
 *
 * Claude reads a picture of at most 5 MB of base64 (3,932,160 bytes), and at
 * most 2000 px a side once a request holds more than 20 pictures; every
 * earlier picture of the chat goes back with each message. Pictures are fitted
 * before they are sent, so one over the limits here is one that could not be
 * (a WebP or GIF, a damaged file), and otherwise the cause is a picture sent
 * before, or one Claude could not decode.
 *
 * @module provider/Drivers/ClaudePictureError
 */
import { PICTURE_MAX_BYTES, PICTURE_MAX_EDGE } from "@t3tools/shared/composerPictures";
import { readImageDimensions } from "@t3tools/shared/imageDimensions";

/** A picture a turn sent, as the person knows it. */
export interface SentPicture {
  /** "Picture 2" where the text placed it, else its file name in quotes. */
  readonly label: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
}

export function sentPicture(input: {
  readonly placed: boolean;
  readonly n: number;
  readonly name: string;
  readonly bytes: Uint8Array;
}): SentPicture {
  const dimensions = readImageDimensions(input.bytes);
  return {
    label: input.placed ? `Picture ${input.n}` : `"${input.name}"`,
    bytes: input.bytes.byteLength,
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
  };
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
