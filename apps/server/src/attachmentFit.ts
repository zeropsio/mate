/**
 * Fits a picture to what every provider takes before a turn sends it: at most
 * `PICTURE_MAX_EDGE` px a side and `PICTURE_MAX_BYTES` bytes. The web composer
 * fits its pictures itself; this is the fallback for clients that send them as
 * taken (the mobile app, older web builds): camera photos of up to 10 MiB.
 *
 * It opens PNG and JPEG only. The work is synchronous and CPU-bound, and runs
 * on whichever thread calls it: a 12-megapixel photo takes most of a second.
 */
// @effect-diagnostics nodeBuiltinImport:off -- a synchronous inflate with an output cap
import * as NodeZlib from "node:zlib";

import { PICTURE_MAX_BYTES, PICTURE_MAX_EDGE } from "@t3tools/shared/composerPictures";
import { readImageDimensions } from "@t3tools/shared/imageDimensions";
import * as JpegJs from "jpeg-js";
import { PNG } from "pngjs";

import { SAFE_IMAGE_FILE_EXTENSIONS } from "./imageMime.ts";

export interface PictureLimits {
  /** The longest side a picture may have, in pixels. */
  readonly maxEdge: number;
  /** The most bytes a picture may take. */
  readonly maxBytes: number;
}

const PROVIDER_PICTURE_LIMITS: PictureLimits = {
  maxEdge: PICTURE_MAX_EDGE,
  maxBytes: PICTURE_MAX_BYTES,
};

export interface PictureInput {
  readonly bytes: Uint8Array;
  /** The type the picture came labelled with. */
  readonly mimeType: string;
}

export type FittedPictureType = "image/png" | "image/jpeg";

export interface FittedPicture {
  readonly _tag: "fitted";
  readonly bytes: Uint8Array;
  readonly mimeType: FittedPictureType;
  readonly width: number;
  readonly height: number;
}

/**
 * `unchanged`: within the limits, send it as it is. `unsupported`: over them,
 * but not a picture this opens (WebP, GIF, a damaged file), so it goes as it
 * is. `too-large`: too big to open, or no encoding fits even at its smallest.
 */
export type PictureFit =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "unsupported" }
  | { readonly _tag: "too-large" }
  | FittedPicture;

/**
 * The most pixels a picture may have to be opened: the 24-megapixel frames
 * recent iPhones take. jpeg-js keeps every 8×8 block as its own typed array,
 * so a photo this size holds over 600 MB while it is open.
 */
const MAX_OPENED_PIXELS = 25_000_000;
const JPEG_DECODE_OPTIONS = {
  useTArray: true,
  formatAsRGBA: true,
  maxResolutionInMP: MAX_OPENED_PIXELS / 1_000_000,
  // Above jpeg-js's own estimate for a 4:4:4 frame at the pixel cap, so the
  // cap stays the only gate.
  maxMemoryUsageInMB: 1024,
} as const;

/** PNG first for a PNG, which keeps the text in a screenshot sharp; then JPEG. */
const JPEG_QUALITIES = [92, 85, 78, 68] as const;
/** The whole ladder again at these fractions of the fitted size. */
const SHRINK_STEPS = [1, 0.75, 0.55] as const;

/** The types this opens. Which decoder reads a picture goes by its bytes. */
const OPENED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

/** Whether a picture is over a limit: by its bytes, or by the size its header names. */
export function needsFit(
  input: PictureInput,
  limits: PictureLimits = PROVIDER_PICTURE_LIMITS,
): boolean {
  if (input.bytes.byteLength > limits.maxBytes) return true;
  const size = readImageDimensions(input.bytes);
  return size !== null && Math.max(size.width, size.height) > limits.maxEdge;
}

export function fitImageForProviders(input: PictureInput): PictureFit {
  return fitImage(input, PROVIDER_PICTURE_LIMITS);
}

/** `fitImageForProviders` against any limits, so small pictures can stand in for big ones. */
export function fitImage(input: PictureInput, limits: PictureLimits): PictureFit {
  if (!needsFit(input, limits)) return { _tag: "unchanged" };
  const format = openedFormat(input);
  if (format === null) return { _tag: "unsupported" };
  const stored = readImageDimensions(input.bytes);
  if (stored !== null && stored.width * stored.height > MAX_OPENED_PIXELS) {
    return { _tag: "too-large" };
  }
  const source = decode(format, input.bytes);
  if (source === null) return { _tag: "unsupported" };

  // A phone stores a photo as the sensor saw it and says in EXIF how to turn
  // it; the new file carries no EXIF, so its pixels are turned instead.
  const orientation = format === "jpeg" ? readExifOrientation(input.bytes) : 1;
  const sideways = orientation >= 5;
  const upright = sideways ? { width: source.height, height: source.width } : source;
  const fitted = fitWithin(upright, limits.maxEdge);
  const opaque = format === "jpeg" || isOpaque(source.data);

  for (const step of SHRINK_STEPS) {
    const size = scaleSize(fitted, step);
    const pixels = orient(
      resize(source, sideways ? size.height : size.width, sideways ? size.width : size.height),
      orientation,
    );
    if (format === "png") {
      const png = encodePng(pixels, opaque);
      if (png.byteLength <= limits.maxBytes) return fittedPicture("image/png", png, pixels);
    }
    const flattened = opaque ? pixels : onWhite(pixels);
    for (const quality of JPEG_QUALITIES) {
      const jpeg = JpegJs.encode(flattened, quality).data;
      if (jpeg.byteLength <= limits.maxBytes) return fittedPicture("image/jpeg", jpeg, pixels);
    }
  }
  return { _tag: "too-large" };
}

const NAME_MAX_CHARS = 255;
const NAME_EXTENSIONS: Record<FittedPictureType, ReadonlyArray<string>> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
};

/**
 * The attachment as its fitted picture: the new type and size, and a name
 * that ends in the new type (`shot.png` becomes `shot.jpg`). A picture that
 * kept its type keeps its name.
 */
export function withFittedPicture<
  A extends { readonly name: string; readonly mimeType: string; readonly sizeBytes: number },
>(attachment: A, picture: FittedPicture): A {
  return {
    ...attachment,
    name:
      picture.mimeType === attachment.mimeType.toLowerCase()
        ? attachment.name
        : pictureName(attachment.name, picture.mimeType),
    mimeType: picture.mimeType,
    sizeBytes: picture.bytes.byteLength,
  };
}

function pictureName(name: string, mimeType: FittedPictureType): string {
  const extensions = NAME_EXTENSIONS[mimeType];
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  if (extensions.includes(extension)) return name;
  // Only a picture's own extension is swapped: in "at 10.42.13" the ".13" is the name's.
  const stem = SAFE_IMAGE_FILE_EXTENSIONS.has(extension) ? name.slice(0, dot) : name;
  const suffix = extensions[0]!;
  return `${stem.slice(0, NAME_MAX_CHARS - suffix.length)}${suffix}`;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Pixels extends Size {
  /** RGBA, a byte a channel, alpha not premultiplied. */
  readonly data: Uint8Array;
}

type OpenedFormat = "png" | "jpeg";

function openedFormat(input: PictureInput): OpenedFormat | null {
  if (!OPENED_TYPES.has(input.mimeType.toLowerCase())) return null;
  const { bytes } = input;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

/** Channels a pixel has, by PNG colour type. */
const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Whether an interlaced PNG's image data inflates within what its header
 * says it holds. pngjs inflates interlaced data with no bound, so a small
 * upload naming a small picture could make it allocate gigabytes; this
 * inflates it once with the header's size as the cap, and a PNG past it is
 * not opened. A non-interlaced PNG pngjs bounds by itself.
 */
function pngDataFitsItsHeader(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33) return false;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = bytes[24]!;
  const channels = PNG_CHANNELS[bytes[25]!];
  if (bytes[28] !== 1) return true;
  if (channels === undefined) return false;
  const data: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  // Every row of each of the seven passes starts with a filter byte.
  const bytesPerPixel = Math.ceil((bitDepth * channels) / 8);
  const cap = width * height * bytesPerPixel + 7 * (height + 1) + 1;
  try {
    NodeZlib.inflateSync(Buffer.concat(data), { maxOutputLength: cap });
    return true;
  } catch {
    return false;
  }
}

/** RGBA pixels, or null for a file its decoder cannot read. */
function decode(format: OpenedFormat, bytes: Uint8Array): Pixels | null {
  try {
    if (format === "jpeg") return JpegJs.decode(bytes, JPEG_DECODE_OPTIONS);
    if (!pngDataFitsItsHeader(bytes)) return null;
    // pngjs hands back RGBA at 8 bits whatever the file held: palette, gray,
    // 16-bit, interlaced.
    const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { width: png.width, height: png.height, data: png.data };
  } catch {
    return null;
  }
}

function isOpaque(data: Uint8Array): boolean {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] !== 255) return false;
  }
  return true;
}

function fitWithin(size: Size, maxEdge: number): Size {
  const longer = Math.max(size.width, size.height);
  return longer <= maxEdge ? size : scaleSize(size, maxEdge / longer);
}

function scaleSize(size: Size, scale: number): Size {
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function fittedPicture(
  mimeType: FittedPictureType,
  bytes: Uint8Array,
  pixels: Pixels,
): FittedPicture {
  return { _tag: "fitted", bytes, mimeType, width: pixels.width, height: pixels.height };
}

/**
 * Which source pixels each target pixel covers along one axis: the first and
 * last (inclusive), how much of each end lies inside, and one over the span.
 */
interface Coverage {
  readonly first: Int32Array;
  readonly last: Int32Array;
  readonly firstWeight: Float64Array;
  readonly lastWeight: Float64Array;
  readonly scale: Float64Array;
}

function coverage(source: number, target: number): Coverage {
  const first = new Int32Array(target);
  const last = new Int32Array(target);
  const firstWeight = new Float64Array(target);
  const lastWeight = new Float64Array(target);
  const scale = new Float64Array(target);
  for (let index = 0; index < target; index += 1) {
    const start = (index * source) / target;
    const end = ((index + 1) * source) / target;
    const from = Math.floor(start);
    const to = Math.min(source, Math.ceil(end)) - 1;
    first[index] = from;
    last[index] = to;
    firstWeight[index] = Math.min(end, from + 1) - start;
    lastWeight[index] = end - to;
    scale[index] = 1 / (end - start);
  }
  return { first, last, firstWeight, lastWeight, scale };
}

/**
 * Area averaging: every target pixel is the mean of the source area it
 * covers, partial pixels at its edges weighted by how much of them it covers.
 * Sharp for big reductions, where sampling a few pixels aliases text. Colours
 * are averaged premultiplied by alpha, so a transparent pixel's hidden colour
 * never bleeds into its neighbours. It only ever shrinks.
 */
function resize(source: Pixels, width: number, height: number): Pixels {
  if (width === source.width && height === source.height) return source;
  const columns = coverage(source.width, width);
  const rows = coverage(source.height, height);
  const rowSums = new Float64Array(width * 4);
  const sums = new Float64Array(width * 4);
  const out = new Uint8ClampedArray(width * height * 4);
  let summedRow = -1;
  for (let y = 0; y < height; y += 1) {
    sums.fill(0);
    const from = rows.first[y]!;
    const to = rows.last[y]!;
    for (let row = from; row <= to; row += 1) {
      // Neighbouring target rows share the source row on their boundary.
      if (row !== summedRow) {
        sumRow(source, row, columns, rowSums);
        summedRow = row;
      }
      const weight = row === from ? rows.firstWeight[y]! : row === to ? rows.lastWeight[y]! : 1;
      for (let index = 0; index < sums.length; index += 1) {
        sums[index] = sums[index]! + rowSums[index]! * weight;
      }
    }
    const rowScale = rows.scale[y]!;
    for (let index = 0, offset = y * width * 4; index < sums.length; index += 4, offset += 4) {
      const alpha = sums[index + 3]!;
      if (alpha > 0) {
        out[offset] = sums[index]! / alpha;
        out[offset + 1] = sums[index + 1]! / alpha;
        out[offset + 2] = sums[index + 2]! / alpha;
        out[offset + 3] = alpha * rowScale;
      }
    }
  }
  return { width, height, data: new Uint8Array(out.buffer) };
}

/** One source row averaged across the target columns, colours premultiplied. */
function sumRow(source: Pixels, row: number, columns: Coverage, out: Float64Array): void {
  const { data } = source;
  const rowStart = row * source.width * 4;
  for (let x = 0, index = 0; index < out.length; x += 1, index += 4) {
    const from = columns.first[x]!;
    const to = columns.last[x]!;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let column = from; column <= to; column += 1) {
      const offset = rowStart + column * 4;
      const weight =
        column === from ? columns.firstWeight[x]! : column === to ? columns.lastWeight[x]! : 1;
      const covered = data[offset + 3]! * weight;
      red += data[offset]! * covered;
      green += data[offset + 1]! * covered;
      blue += data[offset + 2]! * covered;
      alpha += covered;
    }
    const scale = columns.scale[x]!;
    out[index] = red * scale;
    out[index + 1] = green * scale;
    out[index + 2] = blue * scale;
    out[index + 3] = alpha * scale;
  }
}

/**
 * Where each upright pixel (x, y) sits in the stored picture, per EXIF
 * orientation: stored x = cx + ax·x + bx·y and stored y = cy + ay·x + by·y,
 * with cx/cy counted in stored width − 1 and height − 1.
 */
const ORIENTATIONS: Record<number, readonly [number, number, number, number, number, number]> = {
  // [ax, bx, cx, ay, by, cy]
  2: [-1, 0, 1, 0, 1, 0],
  3: [-1, 0, 1, 0, -1, 1],
  4: [1, 0, 0, 0, -1, 1],
  5: [0, 1, 0, 1, 0, 0],
  6: [0, 1, 0, -1, 0, 1],
  7: [0, -1, 1, -1, 0, 1],
  8: [0, -1, 1, 1, 0, 0],
};

function orient(pixels: Pixels, orientation: number): Pixels {
  const transform = ORIENTATIONS[orientation];
  if (transform === undefined) return pixels;
  const [ax, bx, cx, ay, by, cy] = transform;
  const { width, height, data } = pixels;
  const sideways = orientation >= 5;
  const uprightWidth = sideways ? height : width;
  const uprightHeight = sideways ? width : height;
  const out = new Uint8Array(data.length);
  for (let y = 0, offset = 0; y < uprightHeight; y += 1) {
    for (let x = 0; x < uprightWidth; x += 1, offset += 4) {
      const storedX = cx * (width - 1) + ax * x + bx * y;
      const storedY = cy * (height - 1) + ay * x + by * y;
      const stored = (storedY * width + storedX) * 4;
      out[offset] = data[stored]!;
      out[offset + 1] = data[stored + 1]!;
      out[offset + 2] = data[stored + 2]!;
      out[offset + 3] = data[stored + 3]!;
    }
  }
  return { width: uprightWidth, height: uprightHeight, data: out };
}

/** The EXIF orientation of a JPEG, 1 (as stored) when it has none or it cannot be read. */
function readExifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1]!;
    // Fill bytes, and the markers that stand alone without a length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // EXIF comes before the image data.
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      const orientation = exifOrientation(
        view,
        offset + 4,
        Math.min(bytes.length, offset + 2 + length),
      );
      if (orientation !== null) return orientation;
    }
    offset += 2 + length;
  }
  return 1;
}

/** Orientation from an APP1 payload between `start` and `end`, if it is EXIF and says one. */
function exifOrientation(view: DataView, start: number, end: number): number | null {
  // "Exif\0\0", then a TIFF header: byte order, 42, and where IFD0 starts.
  if (end - start < 14 || view.getUint32(start) !== 0x45786966 || view.getUint16(start + 4) !== 0) {
    return null;
  }
  const tiff = start + 6;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const littleEndian = order === 0x4949;
  if (view.getUint16(tiff + 2, littleEndian) !== 42) return null;
  const directory = tiff + view.getUint32(tiff + 4, littleEndian);
  if (directory + 2 > end) return null;
  const entries = view.getUint16(directory, littleEndian);
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, littleEndian) === 0x0112) {
      const orientation = view.getUint16(entry + 8, littleEndian);
      return orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }
  return null;
}

function encodePng(pixels: Pixels, opaque: boolean): Uint8Array {
  const data = opaque ? withoutAlpha(pixels.data) : pixels.data;
  const png = Object.assign(new PNG(), {
    width: pixels.width,
    height: pixels.height,
    data: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
  });
  return PNG.sync.write(
    png,
    opaque ? { colorType: 2, inputColorType: 2, inputHasAlpha: false } : { colorType: 6 },
  );
}

function withoutAlpha(data: Uint8Array): Uint8Array {
  const out = new Uint8Array((data.length / 4) * 3);
  for (let from = 0, to = 0; from < data.length; from += 4, to += 3) {
    out[to] = data[from]!;
    out[to + 1] = data[from + 1]!;
    out[to + 2] = data[from + 2]!;
  }
  return out;
}

/** The picture over a white page: JPEG has no alpha. */
function onWhite(pixels: Pixels): Pixels {
  const { data } = pixels;
  const out = new Uint8ClampedArray(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    const white = 255 - alpha;
    out[offset] = (data[offset]! * alpha) / 255 + white;
    out[offset + 1] = (data[offset + 1]! * alpha) / 255 + white;
    out[offset + 2] = (data[offset + 2]! * alpha) / 255 + white;
    out[offset + 3] = 255;
  }
  return { width: pixels.width, height: pixels.height, data: new Uint8Array(out.buffer) };
}
