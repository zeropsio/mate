/**
 * Downscale + re-encode for images headed somewhere with limits:
 *
 * - A picture in the composer goes to the Mate as a copy fitted to what
 *   Claude reads (`fitPictureCopy`): at most 2000 px a side and 3,932,160
 *   bytes, which encode to its 5 MB of base64. PNG first, so text stays
 *   sharp, then a JPEG quality ladder, then smaller sizes.
 * - The prompt stash persists images as base64 in localStorage (~5MB origin
 *   quota), so `compressImageForStash` targets a per-image character budget.
 *
 * Supported images already within budget pass through untouched. HEIC/HEIF
 * photos are decoded to JPEG first because providers cannot consume them.
 */
import { PICTURE_MAX_BYTES, PICTURE_MAX_EDGE } from "@t3tools/shared/composerPictures";
import {
  IMAGE_DIMENSIONS_HEADER_BYTES,
  readImageDimensions,
  type ImageDimensions,
} from "@t3tools/shared/imageDimensions";

import type { PictureMark, PictureRect } from "./composerPictures";
import { drawPictureComposite } from "./pictureDrawing";

/** Longest edge kept when an image has to be re-encoded: what Claude reads. */
const MAX_DIMENSION = PICTURE_MAX_EDGE;
/** Base64 budget for a single stashed image (~975KB of binary). */
export const MAX_STASH_IMAGE_DATA_URL_CHARS = 1_300_000;
/**
 * Ceiling on the *source* file handed to the re-encoder. File size is a
 * proxy for pixel count, and decoding hundreds of megapixels into an
 * ImageBitmap can OOM the tab — beyond this we refuse rather than risk it.
 */
export const MAX_COMPRESSIBLE_SOURCE_BYTES = 50 * 1024 * 1024;
/** The most pixels a picture is decoded with: 256 MB of pixels at 64 megapixels. */
const MAX_DECODE_PIXELS = 64_000_000;
const MAX_HEIC_METADATA_BYTES = 1024 * 1024;
/**
 * The longest side a picture is kept at in the tab, for its thumbnail and
 * its view. A bigger one is decoded at this size, and its copy is made from
 * its crop, decoded afresh at the size the copy is drawn at.
 */
export const PICTURE_KEPT_MAX_EDGE = 4096;
/**
 * Quality ladder tried in order until the encoded image fits the budget.
 * The floor stays high enough to avoid visible blocking on UI screenshots;
 * if even that overflows we drop resolution instead of quality.
 */
const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.68] as const;
/** Extra downscale passes applied when even the lowest quality overflows. */
const FALLBACK_SCALE_STEPS = [0.75, 0.55] as const;
const HEIC_IMAGE_MIME_TYPE = /^image\/hei(?:c|f)$/i;
const HEIC_IMAGE_EXTENSION = /\.(?:heic|heif)$/i;

export interface CompressedStashImage {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
  /** True when the payload was re-encoded rather than stored verbatim. */
  recompressed: boolean;
}

/**
 * Why an image could not be compressed. Callers report these differently:
 * "too large" is a budget outcome, "unreadable" is a decode failure.
 */
export type ImageCompressionFailureReason = "too-large" | "unreadable";

export type CompressStashImageResult =
  | { ok: true; image: CompressedStashImage }
  | { ok: false; reason: ImageCompressionFailureReason };

export type CompressImageFileResult =
  | { ok: true; file: File; recompressed: boolean }
  | { ok: false; reason: ImageCompressionFailureReason };

/** Finder and some browsers omit the MIME type when dragging HEIC photos. */
export function isHeicImageFile(file: Pick<File, "name" | "type">): boolean {
  if (HEIC_IMAGE_MIME_TYPE.test(file.type)) {
    return true;
  }
  return (
    (file.type === "" || file.type.toLowerCase() === "application/octet-stream") &&
    HEIC_IMAGE_EXTENSION.test(file.name)
  );
}

interface HeicMetadataBox {
  payloadOffset: number;
  endOffset: number;
}

function findHeicMetadataBox(
  view: DataView,
  startOffset: number,
  endOffset: number,
  type: number,
): HeicMetadataBox | null {
  let offset = startOffset;
  while (offset + 8 <= endOffset) {
    let size = view.getUint32(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > endOffset) return null;
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = endOffset - offset;
    }
    if (size < headerSize || size > endOffset - offset) return null;

    const nextOffset = offset + size;
    if (view.getUint32(offset + 4) === type) {
      return { payloadOffset: offset + headerSize, endOffset: nextOffset };
    }
    offset = nextOffset;
  }
  return null;
}

/** Read HEIC image dimensions before the decoder allocates full RGBA buffers. */
async function validateHeicImageDimensions(
  file: File,
): Promise<ImageCompressionFailureReason | null> {
  const metadata = await file.slice(0, MAX_HEIC_METADATA_BYTES).arrayBuffer();
  const view = new DataView(metadata);
  const meta = findHeicMetadataBox(view, 0, view.byteLength, 0x6d657461);
  if (!meta || meta.payloadOffset + 4 > meta.endOffset) return "unreadable";
  const properties = findHeicMetadataBox(view, meta.payloadOffset + 4, meta.endOffset, 0x69707270);
  if (!properties) return "unreadable";
  const containers = findHeicMetadataBox(
    view,
    properties.payloadOffset,
    properties.endOffset,
    0x6970636f,
  );
  if (!containers) return "unreadable";

  let offset = containers.payloadOffset;
  let foundImageDimensions = false;
  while (offset < containers.endOffset) {
    const image = findHeicMetadataBox(view, offset, containers.endOffset, 0x69737065);
    if (!image) break;
    if (image.payloadOffset + 12 > image.endOffset) return "unreadable";
    const width = view.getUint32(image.payloadOffset + 4);
    const height = view.getUint32(image.payloadOffset + 8);
    if (width === 0 || height === 0) return "unreadable";
    if (width > MAX_DECODE_PIXELS / height) return "too-large";
    foundImageDimensions = true;
    offset = image.endOffset;
  }
  return foundImageDimensions ? null : "unreadable";
}

/** Chunked so a large image can't blow the argument limit of `fromCharCode`. */
const BASE64_CHUNK_SIZE = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

/**
 * Blob → base64 data URL. Uses `arrayBuffer()` rather than `FileReader` so
 * the module works anywhere `Blob` does (including non-DOM test runners).
 */
async function blobToDataUrl(blob: File | Blob, mimeTypeOverride?: string): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const mimeType = mimeTypeOverride || blob.type || "application/octet-stream";
  return `data:${mimeType};base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

/** Approximate decoded byte count for a base64 data URL. */
function dataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const payload = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** Base64 payload of a data URL decoded back into a `File`. */
function dataUrlToFile(dataUrl: string, name: string, mimeType: string): File {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: mimeType });
}

/**
 * Re-encoding changes the container, so a name like `shot.png` would lie
 * about its contents. Swap the extension to match the encoded mime type.
 */
function fileNameForMimeType(name: string, mimeType: string): string {
  const extension = mimeType === "image/webp" ? ".webp" : ".jpg";
  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  return `${base}${extension}`;
}

function canRecompress(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    (typeof OffscreenCanvas === "function" || typeof document !== "undefined")
  );
}

interface Canvas2D {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}

function createCanvas(width: number, height: number): Canvas2D | null {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    return { canvas, context };
  }
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  return { canvas, context };
}

/**
 * WebP is preferred: at matched visual quality it lands roughly 25-35%
 * smaller than JPEG, so the same budget buys more resolution and detail —
 * and it keeps alpha, so screenshots with transparency survive intact.
 * Browsers that can't encode it silently fall back to JPEG.
 */
async function encodeCanvas(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
  mimeType: string,
  budgetChars: number,
): Promise<{ dataUrl: string | null; mimeType: string } | null> {
  if (typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) {
    const dataUrl = canvas.toDataURL(mimeType, quality);
    // toDataURL silently returns a PNG when the requested type is unsupported.
    if (!dataUrl.startsWith(`data:${mimeType}`)) return null;
    return { dataUrl: dataUrl.length <= budgetChars ? dataUrl : null, mimeType };
  }
  const blob = await (canvas as OffscreenCanvas).convertToBlob({ type: mimeType, quality });
  if (blob.type && blob.type !== mimeType) return null;
  const dataUrlLength = `data:${mimeType};base64,`.length + 4 * Math.ceil(blob.size / 3);
  if (dataUrlLength > budgetChars) return { dataUrl: null, mimeType };
  return { dataUrl: await blobToDataUrl(blob, mimeType), mimeType };
}

const composerThumbnails = new WeakMap<File, Promise<string | null>>();

/** Cache a centered square crop for the composer's object-cover image tiles. */
export function createComposerImageThumbnail(file: File): Promise<string | null> {
  const cached = composerThumbnails.get(file);
  if (cached) return cached;
  const thumbnail = (async () => {
    if (!canRecompress()) return null;
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height);
      if (side <= 0) return null;
      const dimension = Math.min(256, side);
      const surface = createCanvas(dimension, dimension);
      if (!surface) return null;
      surface.context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        dimension,
        dimension,
      );
      return (
        (await encodeCanvas(surface.canvas, 1, "image/png", Number.POSITIVE_INFINITY))?.dataUrl ??
        null
      );
    } catch {
      return null;
    } finally {
      bitmap?.close();
    }
  })();
  composerThumbnails.set(file, thumbnail);
  return thumbnail;
}

/**
 * Draws `bitmap` scaled to fit `maxDimension` and encodes it, stepping
 * quality down until the data URL fits `budgetChars`.
 */
async function encodeWithinBudget(
  bitmap: ImageBitmap,
  maxDimension: number,
  budgetChars: number,
  preferredMimeType?: "image/jpeg",
): Promise<{ dataUrl: string; mimeType: string } | null> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const target = createCanvas(width, height);
  if (!target) return null;

  // Probe WebP once; JPEG (no alpha) needs a white matte, so the fill has to
  // happen before drawing and depends on which codec we end up using.
  const mimeType =
    preferredMimeType ??
    ((await encodeCanvas(target.canvas, QUALITY_STEPS[0], "image/webp", 0))
      ? "image/webp"
      : "image/jpeg");

  if (mimeType === "image/jpeg") {
    target.context.fillStyle = "#ffffff";
    target.context.fillRect(0, 0, width, height);
  }
  target.context.drawImage(bitmap, 0, 0, width, height);

  for (const quality of QUALITY_STEPS) {
    const encoded = await encodeCanvas(target.canvas, quality, mimeType, budgetChars);
    if (!encoded) break;
    if (encoded.dataUrl !== null) {
      return { dataUrl: encoded.dataUrl, mimeType: encoded.mimeType };
    }
  }
  return null;
}

type ReencodeResult =
  | { ok: true; dataUrl: string; mimeType: string }
  | { ok: false; reason: ImageCompressionFailureReason };

/**
 * Shared re-encode loop: decodes `file`, then walks the quality ladder and
 * fallback downscale passes until an encoding fits `budgetChars`.
 */
async function reencodeWithinBudget(
  file: File,
  budgetChars: number,
  preferredMimeType?: "image/jpeg",
): Promise<ReencodeResult> {
  if (!canRecompress()) {
    return { ok: false, reason: "too-large" };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  try {
    // Each pass shrinks relative to the *previous target*, capped by
    // MAX_DIMENSION. Scaling a fixed ceiling instead would be a no-op for
    // images already smaller than that ceiling — the fallback passes would
    // all resolve to the source size and never actually reduce resolution.
    const baseDimension = Math.min(MAX_DIMENSION, Math.max(bitmap.width, bitmap.height));
    // Tracks whether the *last* attempt threw, so a run of encoder failures
    // is reported as unreadable while a run of merely-too-big results is
    // reported as too-large.
    let encodeFailed = false;
    for (const dimensionScale of [1, ...FALLBACK_SCALE_STEPS]) {
      const targetDimension = Math.max(1, Math.round(baseDimension * dimensionScale));
      let encoded: { dataUrl: string; mimeType: string } | null;
      try {
        encoded = await encodeWithinBudget(bitmap, targetDimension, budgetChars, preferredMimeType);
      } catch {
        // Canvas allocation, drawing, or the codec itself can throw — often
        // precisely *because* the target is too big (OOM on a large bitmap).
        // Keep trying the smaller fallback scales rather than giving up: a
        // reduced pass may well succeed. The exception must never escape,
        // though, since callers finalize state after this returns and a
        // throw would strand it (e.g. a stash entry stuck "still saving").
        encodeFailed = true;
        continue;
      }
      encodeFailed = false;
      if (encoded && encoded.dataUrl.length <= budgetChars) {
        return { ok: true, dataUrl: encoded.dataUrl, mimeType: encoded.mimeType };
      }
    }
    return { ok: false, reason: encodeFailed ? "unreadable" : "too-large" };
  } finally {
    bitmap.close();
  }
}

/**
 * Produces the payload to persist for a stashed image.
 *
 * Small images are stored verbatim (preserving PNG transparency and exact
 * pixels). Anything over budget is downscaled and re-encoded; if it still
 * doesn't fit after the fallback passes, reports a failure so the caller
 * can record it as dropped.
 */
export async function compressImageForStash(
  file: File,
  budgetChars: number = MAX_STASH_IMAGE_DATA_URL_CHARS,
): Promise<CompressStashImageResult> {
  let originalDataUrl: string;
  try {
    originalDataUrl = await blobToDataUrl(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (originalDataUrl.length <= budgetChars) {
    return {
      ok: true,
      image: {
        dataUrl: originalDataUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        recompressed: false,
      },
    };
  }
  const reencoded = await reencodeWithinBudget(file, budgetChars);
  if (!reencoded.ok) {
    return reencoded;
  }
  return {
    ok: true,
    image: {
      dataUrl: reencoded.dataUrl,
      mimeType: reencoded.mimeType,
      sizeBytes: dataUrlByteLength(reencoded.dataUrl),
      recompressed: true,
    },
  };
}

/**
 * Shrinks `file` until its binary size fits `maxBytes`, returning a new
 * `File` (WebP or JPEG). Files already within the limit pass through
 * untouched, preserving their exact bytes and format. Sources above
 * `MAX_COMPRESSIBLE_SOURCE_BYTES` are refused outright — decoding them is
 * the risk, so no amount of output budget makes them safe. An internally
 * converted image can provide its original source size when the intermediate
 * format expands beyond that ceiling.
 */
export async function compressImageToByteLimit(
  file: File,
  maxBytes: number,
  options?: { preferredMimeType?: "image/jpeg"; sourceSizeBytes?: number },
): Promise<CompressImageFileResult> {
  if (file.size <= maxBytes) {
    return { ok: true, file, recompressed: false };
  }
  if ((options?.sourceSizeBytes ?? file.size) > MAX_COMPRESSIBLE_SOURCE_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  // The re-encode loop budgets in data-URL characters. Base64 turns 3 bytes
  // into 4 chars; flooring keeps the budget a hair conservative instead of
  // admitting an encoding right at the byte cap.
  const budgetChars = Math.floor(maxBytes / 3) * 4;
  const reencoded = await reencodeWithinBudget(file, budgetChars, options?.preferredMimeType);
  if (!reencoded.ok) {
    return reencoded;
  }
  return {
    ok: true,
    file: dataUrlToFile(
      reencoded.dataUrl,
      fileNameForMimeType(file.name || "image", reencoded.mimeType),
      reencoded.mimeType,
    ),
    recompressed: true,
  };
}

/**
 * Converts HEIC/HEIF photos to provider-compatible JPEG before applying the
 * attachment size limit. The decoder is loaded only when such a photo arrives.
 */
export async function prepareImageForAttachment(
  file: File,
  maxBytes: number,
): Promise<CompressImageFileResult> {
  if (!isHeicImageFile(file)) {
    return compressImageToByteLimit(file, maxBytes);
  }

  if (file.size > MAX_COMPRESSIBLE_SOURCE_BYTES) {
    return { ok: false, reason: "too-large" };
  }

  let converted: Blob;
  try {
    const dimensionError = await validateHeicImageDimensions(file);
    if (dimensionError) {
      return { ok: false, reason: dimensionError };
    }
    const { heicTo } = await import("heic-to/csp");
    converted = await heicTo({ blob: file, type: "image/jpeg", quality: QUALITY_STEPS[0] });
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const jpeg = new File([converted], fileNameForMimeType(file.name || "image", "image/jpeg"), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
  const result = await compressImageToByteLimit(jpeg, maxBytes, {
    preferredMimeType: "image/jpeg",
    sourceSizeBytes: file.size,
  });

  return result.ok ? { ...result, recompressed: true } : result;
}

// ---------------------------------------------------------------------------
// Pictures: the copy the Mate sees
// ---------------------------------------------------------------------------

export interface PictureEncodeStep {
  readonly type: "image/png" | "image/jpeg";
  readonly quality?: number;
}

/** Fractions of the fitted size tried in turn when no encoding fits at full size. */
const PICTURE_SCALE_STEPS = [1, ...FALLBACK_SCALE_STEPS] as const;
/** What Claude reads, and so what may go as it was pasted. */
const PICTURE_AS_PASTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** The copy's size: the crop, scaled down until its longer side is at most 2000 px. */
export function pictureFitSize(crop: Pick<PictureRect, "w" | "h">): {
  width: number;
  height: number;
} {
  const scale = Math.min(1, PICTURE_MAX_EDGE / Math.max(crop.w, crop.h));
  return {
    width: Math.max(1, Math.round(crop.w * scale)),
    height: Math.max(1, Math.round(crop.h * scale)),
  };
}

/** PNG first so a screenshot's text stays sharp, then the JPEG ladder; a photo goes straight to JPEG. */
export function pictureEncodeSteps(sourceType: string): PictureEncodeStep[] {
  const jpeg = QUALITY_STEPS.map((quality) => ({ type: "image/jpeg" as const, quality }));
  return sourceType === "image/jpeg" ? jpeg : [{ type: "image/png" }, ...jpeg];
}

export interface PictureSource {
  readonly type: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

export type PictureCopy<B> =
  | { readonly kind: "as-pasted" }
  | {
      readonly kind: "fitted";
      readonly blob: B;
      readonly width: number;
      readonly height: number;
      readonly type: PictureEncodeStep["type"];
    }
  | { readonly kind: "too-large" };

/**
 * The copy the Mate sees: the pasted file itself when nothing was drawn on
 * it, nothing cut, and it is within the limits; otherwise the crop drawn at
 * the fitted size and walked down the encodings, then down in size, until it
 * weighs at most `PICTURE_MAX_BYTES`. `encode` draws and encodes one try, or
 * answers null when the browser cannot make that type.
 */
export async function fitPictureCopy<B extends { readonly size: number }>(input: {
  readonly source: PictureSource;
  readonly crop: PictureRect;
  readonly markCount: number;
  readonly encode: (
    target: PictureEncodeStep & { readonly width: number; readonly height: number },
  ) => Promise<B | null>;
}): Promise<PictureCopy<B>> {
  const { source, crop } = input;
  const whole = crop.x === 0 && crop.y === 0 && crop.w === source.width && crop.h === source.height;
  if (
    input.markCount === 0 &&
    whole &&
    Math.max(source.width, source.height) <= PICTURE_MAX_EDGE &&
    source.bytes <= PICTURE_MAX_BYTES &&
    PICTURE_AS_PASTED_TYPES.has(source.type)
  ) {
    return { kind: "as-pasted" };
  }
  const fitted = pictureFitSize(crop);
  for (const scale of PICTURE_SCALE_STEPS) {
    const width = Math.max(1, Math.round(fitted.width * scale));
    const height = Math.max(1, Math.round(fitted.height * scale));
    for (const step of pictureEncodeSteps(source.type)) {
      const blob = await input.encode({ ...step, width, height });
      if (blob && blob.size <= PICTURE_MAX_BYTES) {
        return { kind: "fitted", blob, width, height, type: step.type };
      }
    }
  }
  return { kind: "too-large" };
}

async function canvasBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number | undefined,
): Promise<Blob | null> {
  const blob =
    typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
      : await (canvas as OffscreenCanvas).convertToBlob({
          type,
          ...(quality !== undefined ? { quality } : {}),
        });
  // A browser that cannot make the type hands back a PNG instead.
  return blob && blob.type === type ? blob : null;
}

/**
 * An encoder for `fitPictureCopy` that draws the crop with its marks burnt in.
 * A JPEG try draws on white, since JPEG has no transparency; one drawing
 * serves every quality at the same size.
 */
export function pictureCanvasEncoder(input: {
  readonly image: CanvasImageSource;
  /** The image's pixels per pixel of the crop's space (`drawPictureComposite`). */
  readonly imageScale?: number;
  readonly crop: PictureRect;
  readonly marks: ReadonlyArray<PictureMark>;
}): (target: PictureEncodeStep & { width: number; height: number }) => Promise<Blob | null> {
  let drawn: { key: string; canvas: OffscreenCanvas | HTMLCanvasElement } | null = null;
  return async (target) => {
    const matte = target.type === "image/jpeg";
    const key = `${target.width}x${target.height}${matte ? ":matte" : ""}`;
    if (drawn?.key !== key) {
      const surface = createCanvas(target.width, target.height);
      if (!surface) return null;
      if (matte) {
        surface.context.fillStyle = "#ffffff";
        surface.context.fillRect(0, 0, target.width, target.height);
      }
      drawPictureComposite(surface.context, {
        image: input.image,
        ...(input.imageScale !== undefined ? { imageScale: input.imageScale } : {}),
        crop: input.crop,
        marks: input.marks,
        width: target.width,
        height: target.height,
        mode: "fit",
        minRadius: 12,
      });
      drawn = { key, canvas: surface.canvas };
    }
    return canvasBlob(drawn.canvas, target.type, target.quality);
  };
}

/**
 * The file a pasted picture is made from: a HEIC/HEIF photo decoded to JPEG
 * (browsers cannot draw HEIC), anything else as it came.
 */
export async function pictureSourceFile(file: File): Promise<PictureSourceFileResult> {
  // Refused before it is decoded: past the bytes, or past the pixels its
  // header names, a picture can take the tab down with it.
  if (file.size > MAX_COMPRESSIBLE_SOURCE_BYTES) return { ok: false, reason: "too-large" };
  let source = file;
  if (isHeicImageFile(file)) {
    try {
      const dimensionError = await validateHeicImageDimensions(file);
      if (dimensionError) return { ok: false, reason: dimensionError };
      const { heicTo } = await import("heic-to/csp");
      const converted = await heicTo({ blob: file, type: "image/jpeg", quality: QUALITY_STEPS[0] });
      source = new File([converted], fileNameForMimeType(file.name || "image", "image/jpeg"), {
        type: "image/jpeg",
        lastModified: file.lastModified,
      });
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }
  const header = await source.slice(0, IMAGE_DIMENSIONS_HEADER_BYTES).arrayBuffer();
  const size = readImageDimensions(new Uint8Array(header));
  if (size !== null && size.width > MAX_DECODE_PIXELS / size.height) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, file: source, recompressed: source !== file, size };
}

export type PictureSourceFileResult =
  | {
      readonly ok: true;
      readonly file: File;
      readonly recompressed: boolean;
      /** Its size as its header names it (turned as a photo is shown), when it can be read. */
      readonly size: ImageDimensions | null;
    }
  | { readonly ok: false; readonly reason: ImageCompressionFailureReason };

/**
 * How a picture is decoded to be kept in the tab: whole within the kept
 * size, else at it.
 */
export function pictureBitmapOptions(size: ImageDimensions): ImageBitmapOptions | undefined {
  const longer = Math.max(size.width, size.height);
  if (longer <= PICTURE_KEPT_MAX_EDGE) return undefined;
  const scale = PICTURE_KEPT_MAX_EDGE / longer;
  return {
    resizeWidth: Math.max(1, Math.round(size.width * scale)),
    resizeHeight: Math.max(1, Math.round(size.height * scale)),
    resizeQuality: "high",
  };
}

/**
 * A picture's crop decoded at the size its copy is drawn at, from the pasted
 * file: the copy of a picture kept smaller in the tab keeps its full
 * sharpness. The caller closes it.
 */
export function pictureCropBitmap(file: File, crop: PictureRect): Promise<ImageBitmap> {
  const fitted = pictureFitSize(crop);
  return createImageBitmap(
    file,
    Math.round(crop.x),
    Math.round(crop.y),
    Math.max(1, Math.round(crop.w)),
    Math.max(1, Math.round(crop.h)),
    { resizeWidth: fitted.width, resizeHeight: fitted.height, resizeQuality: "high" },
  );
}
