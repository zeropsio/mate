// @effect-diagnostics nodeBuiltinImport:off
import * as NodeZlib from "node:zlib";

import { PICTURE_MAX_BYTES, PICTURE_MAX_EDGE } from "@t3tools/shared/composerPictures";
import * as JpegJs from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  fitImage,
  fitImageForProviders,
  needsFit,
  type PictureFit,
  type PictureInput,
  withFittedPicture,
} from "./attachmentFit.ts";

type Rgba = readonly [number, number, number, number];

interface TestImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** A seeded stream of 32-bit numbers, so every fixture is the same on every run. */
function randomBits(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function draw(width: number, height: number, paint: (x: number, y: number) => Rgba): TestImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

/** Smooth gradients under one bit of grain a channel: PNG cannot squeeze the grain away. */
function grain(width: number, height: number): TestImage {
  const next = randomBits(1);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0, offset = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, offset += 4) {
      const bits = next();
      data[offset] = (x * 255) / width + ((bits >>> 8) & 1);
      data[offset + 1] = (y * 255) / height + ((bits >>> 16) & 1);
      data[offset + 2] = ((x + y) * 128) / (width + height) + ((bits >>> 24) & 1);
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A random colour in every pixel: neither PNG nor JPEG can squeeze it. */
function noise(width: number, height: number): TestImage {
  const next = randomBits(2);
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    const bits = next();
    data[offset] = bits;
    data[offset + 1] = bits >>> 8;
    data[offset + 2] = bits >>> 16;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

/** A camera photo stand-in: soft gradients with a little sensor noise. */
function photo(width: number, height: number): TestImage {
  const next = randomBits(3);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0, offset = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, offset += 4) {
      const bits = next();
      data[offset] = 40 + (x * 160) / width + (bits & 7);
      data[offset + 1] = 60 + (y * 120) / height + ((bits >>> 8) & 7);
      data[offset + 2] = 90 + ((x + y) * 80) / (width + height) + ((bits >>> 16) & 7);
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A phone screenshot stand-in: a white page under a coloured bar, with rows of dark words. */
function screenshot(width: number, height: number): TestImage {
  const next = randomBits(4);
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < 160; y += 1) {
    for (let x = 0; x < width; x += 1) data.set([30, 90, 200, 255], (y * width + x) * 4);
  }
  for (let top = 200; top + 20 < height; top += 48) {
    for (let x = 32; x < width - 32;) {
      const word = 12 + (next() % 60);
      for (let y = top; y < top + 20; y += 1) {
        for (let column = x; column < Math.min(x + word, width - 32); column += 1) {
          if ((column + y) % 3 !== 0) data.set([34, 34, 34, 255], (y * width + column) * 4);
        }
      }
      x += word + 10;
    }
  }
  return { width, height, data };
}

function encodePng(image: TestImage, colorType: 2 | 6 = 2): Uint8Array {
  const png = Object.assign(new PNG(), {
    width: image.width,
    height: image.height,
    data: Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  });
  return PNG.sync.write(png, { colorType });
}

function encodeJpeg(image: TestImage, quality = 90): Uint8Array {
  return JpegJs.encode({ width: image.width, height: image.height, data: image.data }, quality)
    .data;
}

function decode(fit: Extract<PictureFit, { _tag: "fitted" }>): TestImage {
  if (fit.mimeType === "image/png") {
    const png = PNG.sync.read(Buffer.from(fit.bytes));
    return { width: png.width, height: png.height, data: png.data };
  }
  return JpegJs.decode(fit.bytes, { useTArray: true });
}

function pixel(image: TestImage, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * 4;
  const [r = 0, g = 0, b = 0, a = 0] = image.data.subarray(offset, offset + 4);
  return [r, g, b, a];
}

function expectFitted(fit: PictureFit): Extract<PictureFit, { _tag: "fitted" }> {
  if (fit._tag !== "fitted") throw new Error(`Expected a fitted picture, got ${fit._tag}.`);
  return fit;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function pngChunk(type: string, body: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(ascii(type), 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, NodeZlib.crc32(chunk.subarray(4, 8 + body.length)));
  return chunk;
}

function pngHeaderChunk(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: boolean,
): Uint8Array {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([bitDepth, colorType, 0, 0, interlace ? 1 : 0], 8);
  return pngChunk("IHDR", header);
}

/** A PNG's signature and header naming a size, with no pixels behind it. */
function pngHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([...PNG_SIGNATURE, ...pngHeaderChunk(width, height, 8, 6, false)]);
}

function webpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(ascii("RIFF"), 0);
  bytes.set(ascii("WEBPVP8X"), 8);
  bytes.set([10, 0, 0, 0], 16);
  bytes.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, (width - 1) >> 16], 24);
  bytes.set([(height - 1) & 0xff, ((height - 1) >> 8) & 0xff, (height - 1) >> 16], 27);
  return bytes;
}

function gifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set(ascii("GIF89a"), 0);
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

describe("needsFit", () => {
  it.each([
    { name: "a small PNG", input: { bytes: encodePng(noise(40, 30)), mimeType: "image/png" } },
    {
      name: "a PNG exactly 2000 px wide",
      input: { bytes: pngHeader(2000, 900), mimeType: "image/png" },
    },
    {
      name: "bytes at the limit",
      input: { bytes: new Uint8Array(PICTURE_MAX_BYTES), mimeType: "image/png" },
    },
  ])("leaves $name alone", ({ input }) => {
    expect(needsFit(input)).toBe(false);
  });

  it.each([
    {
      name: "a PNG wider than 2000 px",
      input: { bytes: pngHeader(2001, 900), mimeType: "image/png" },
    },
    {
      name: "a PNG taller than 2000 px",
      input: { bytes: pngHeader(900, 2001), mimeType: "image/png" },
    },
    {
      name: "a WebP over the edge",
      input: { bytes: webpHeader(3000, 2000), mimeType: "image/webp" },
    },
    {
      name: "a JPEG over the edge",
      input: { bytes: encodeJpeg(photo(2400, 16)), mimeType: "image/jpeg" },
    },
    {
      name: "bytes over the limit",
      input: { bytes: new Uint8Array(PICTURE_MAX_BYTES + 1), mimeType: "image/png" },
    },
  ])("fits $name", ({ input }) => {
    expect(needsFit(input)).toBe(true);
  });
});

describe("fitImageForProviders", () => {
  it.each<{
    readonly name: string;
    readonly input: () => PictureInput;
    readonly expected: Omit<Extract<PictureFit, { _tag: "fitted" }>, "bytes">;
  }>([
    {
      name: "a 3210×2118 grain PNG over the byte limit, as a PNG 2000 px wide",
      input: () => {
        const bytes = encodePng(grain(3210, 2118));
        expect(bytes.byteLength).toBeGreaterThan(PICTURE_MAX_BYTES);
        return { bytes, mimeType: "image/png" };
      },
      expected: { _tag: "fitted", mimeType: "image/png", width: 2000, height: 1320 },
    },
    {
      name: "a 4000×3000 camera JPEG, as a JPEG 2000 px wide",
      input: () => ({ bytes: encodeJpeg(photo(4000, 3000)), mimeType: "image/jpeg" }),
      expected: { _tag: "fitted", mimeType: "image/jpeg", width: 2000, height: 1500 },
    },
    {
      name: "a 1179×2556 phone screenshot, as a PNG 2000 px tall",
      input: () => ({ bytes: encodePng(screenshot(1179, 2556)), mimeType: "image/png" }),
      expected: { _tag: "fitted", mimeType: "image/png", width: 923, height: 2000 },
    },
    {
      name: "a PNG labelled as a JPEG, by what its bytes are",
      input: () => ({ bytes: encodePng(screenshot(600, 2400)), mimeType: "image/jpeg" }),
      expected: { _tag: "fitted", mimeType: "image/png", width: 500, height: 2000 },
    },
  ])("fits $name", ({ input, expected }) => {
    const fit = expectFitted(fitImageForProviders(input()));
    const { bytes, ...rest } = fit;
    expect(rest).toEqual(expected);
    expect(bytes.byteLength).toBeLessThanOrEqual(PICTURE_MAX_BYTES);
    const image = decode(fit);
    expect([image.width, image.height]).toEqual([expected.width, expected.height]);
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(PICTURE_MAX_EDGE);
  });

  it.each<{ readonly name: string; readonly input: () => PictureInput; readonly tag: string }>([
    {
      name: "a 1200×800 PNG within both limits",
      input: () => ({ bytes: encodePng(photo(1200, 800)), mimeType: "image/png" }),
      tag: "unchanged",
    },
    {
      name: "a WebP over the edge",
      input: () => ({ bytes: webpHeader(3000, 2000), mimeType: "image/webp" }),
      tag: "unsupported",
    },
    {
      name: "a GIF over the edge",
      input: () => ({ bytes: gifHeader(3000, 2000), mimeType: "image/gif" }),
      tag: "unsupported",
    },
    {
      name: "a PNG whose pixels cannot be read",
      input: () => ({ bytes: pngHeader(3000, 2000), mimeType: "image/png" }),
      tag: "unsupported",
    },
    {
      name: "bytes over the limit that are no PNG",
      input: () => ({ bytes: new Uint8Array(PICTURE_MAX_BYTES + 1), mimeType: "image/png" }),
      tag: "unsupported",
    },
    {
      name: "a PNG too big to open (100 megapixels)",
      input: () => ({ bytes: pngHeader(10_000, 10_000), mimeType: "image/png" }),
      tag: "too-large",
    },
  ])("answers $tag for $name", ({ input, tag }) => {
    expect(fitImageForProviders(input())).toEqual({ _tag: tag });
  });
});

describe("fitImage ladder", () => {
  // Noise costs PNG 3 bytes a pixel and JPEG about 2 at quality 92, falling to
  // about 1 at quality 68, so these byte budgets fall between the rungs.
  it("uses JPEG when the PNG does not fit", () => {
    const image = noise(200, 150);
    const fit = expectFitted(
      fitImage(
        { bytes: encodePng(image), mimeType: "image/png" },
        { maxEdge: PICTURE_MAX_EDGE, maxBytes: 200 * 150 * 2.6 },
      ),
    );
    expect([fit.mimeType, fit.width, fit.height]).toEqual(["image/jpeg", 200, 150]);
    expect(fit.bytes.byteLength).toBeLessThanOrEqual(200 * 150 * 2.6);
  });

  it("shrinks to three quarters when no quality fits, and never grows", () => {
    const fit = expectFitted(
      fitImage(
        { bytes: encodePng(noise(200, 150)), mimeType: "image/png" },
        { maxEdge: PICTURE_MAX_EDGE, maxBytes: 200 * 150 * 0.8 },
      ),
    );
    expect([fit.mimeType, fit.width, fit.height]).toEqual(["image/jpeg", 150, 113]);
    expect(fit.bytes.byteLength).toBeLessThanOrEqual(200 * 150 * 0.8);
  });

  it("gives up when nothing fits even at its smallest", () => {
    expect(
      fitImage(
        { bytes: encodePng(noise(64, 48)), mimeType: "image/png" },
        { maxEdge: 32, maxBytes: 100 },
      ),
    ).toEqual({ _tag: "too-large" });
  });
});

describe("fitImage transparency", () => {
  it("keeps transparency when the PNG fits, blending edges without darkening them", () => {
    const image = draw(400, 300, (x) => (x <= 200 ? [0, 0, 0, 0] : [0, 0, 255, 255]));
    const fit = expectFitted(
      fitImage(
        { bytes: encodePng(image, 6), mimeType: "image/png" },
        { maxEdge: 200, maxBytes: PICTURE_MAX_BYTES },
      ),
    );
    expect([fit.mimeType, fit.width, fit.height]).toEqual(["image/png", 200, 150]);
    const fitted = decode(fit);
    expect(pixel(fitted, 50, 75)[3]).toBe(0);
    expect(pixel(fitted, 100, 75)).toEqual([0, 0, 255, 128]);
    expect(pixel(fitted, 150, 75)).toEqual([0, 0, 255, 255]);
  });

  it("puts transparent pixels on white when it has to use JPEG", () => {
    const grainy = noise(200, 150);
    const image = draw(200, 150, (x, y) => {
      if (x < 100) return [0, 0, 0, 0];
      if (y < 75) return pixel(grainy, x, y);
      return [255, 0, 0, 128];
    });
    const bytes = encodePng(image, 6);
    // The noise costs this PNG about 26 kB and its JPEG about 18 kB.
    const maxBytes = 22_000;
    expect(bytes.byteLength).toBeGreaterThan(maxBytes);
    const fit = expectFitted(
      fitImage({ bytes, mimeType: "image/png" }, { maxEdge: PICTURE_MAX_EDGE, maxBytes }),
    );
    expect([fit.mimeType, fit.width, fit.height]).toEqual(["image/jpeg", 200, 150]);
    const fitted = decode(fit);
    for (const channel of pixel(fitted, 50, 75).slice(0, 3)) expect(channel).toBeGreaterThan(249);
    const [r, g, b] = pixel(fitted, 150, 112);
    expect(Math.abs(r - 255)).toBeLessThan(6);
    expect(Math.abs(g - 127)).toBeLessThan(6);
    expect(Math.abs(b - 127)).toBeLessThan(6);
  });
});

/** An EXIF block after the JPEG's start marker, saying how to turn the picture upright. */
function withOrientation(
  jpeg: Uint8Array,
  orientation: number,
  byteOrder: "II" | "MM",
): Uint8Array {
  const little = byteOrder === "II";
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([byteOrder.charCodeAt(0), byteOrder.charCodeAt(1)], 0);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little);
  view.setUint16(12, 3, little);
  view.setUint32(14, 1, little);
  view.setUint16(18, orientation, little);
  const payload = [...ascii("Exif"), 0, 0, ...tiff];
  const length = payload.length + 2;
  return Uint8Array.from([
    ...jpeg.subarray(0, 2),
    0xff,
    0xe1,
    length >> 8,
    length & 0xff,
    ...payload,
    ...jpeg.subarray(2),
  ]);
}

const CORNERS = {
  red: [230, 30, 30],
  green: [30, 200, 30],
  blue: [30, 30, 230],
  yellow: [230, 230, 30],
} as const;
type Corner = keyof typeof CORNERS;

/** A landscape frame, 300×200 as stored: red, green, blue and yellow corners clockwise from top left. */
function cornered(): TestImage {
  return draw(300, 200, (x, y) => {
    const left = x < 40;
    const right = x >= 260;
    const top = y < 40;
    const bottom = y >= 160;
    const corner: Corner | null =
      top && left
        ? "red"
        : top && right
          ? "green"
          : bottom && right
            ? "yellow"
            : bottom && left
              ? "blue"
              : null;
    return corner === null ? [128, 128, 128, 255] : [...CORNERS[corner], 255];
  });
}

function cornerAt(image: TestImage, x: number, y: number): Corner | null {
  const [r, g, b] = pixel(image, x, y);
  const found = Object.entries(CORNERS).find(
    ([, color]) =>
      Math.abs(color[0] - r) < 40 && Math.abs(color[1] - g) < 40 && Math.abs(color[2] - b) < 40,
  );
  return (found?.[0] as Corner | undefined) ?? null;
}

describe("fitImage orientation", () => {
  // Each EXIF orientation names where the stored rows and columns belong on
  // screen; the stored corner that shows at the top left and top right pins it.
  it.each<{
    readonly orientation: number;
    readonly byteOrder: "II" | "MM";
    readonly size: readonly [number, number];
    readonly topLeft: Corner;
    readonly topRight: Corner;
  }>([
    { orientation: 1, byteOrder: "II", size: [150, 100], topLeft: "red", topRight: "green" },
    { orientation: 2, byteOrder: "II", size: [150, 100], topLeft: "green", topRight: "red" },
    { orientation: 3, byteOrder: "MM", size: [150, 100], topLeft: "yellow", topRight: "blue" },
    { orientation: 4, byteOrder: "MM", size: [150, 100], topLeft: "blue", topRight: "yellow" },
    { orientation: 5, byteOrder: "II", size: [100, 150], topLeft: "red", topRight: "blue" },
    { orientation: 6, byteOrder: "II", size: [100, 150], topLeft: "blue", topRight: "red" },
    { orientation: 6, byteOrder: "MM", size: [100, 150], topLeft: "blue", topRight: "red" },
    { orientation: 7, byteOrder: "MM", size: [100, 150], topLeft: "yellow", topRight: "green" },
    { orientation: 8, byteOrder: "II", size: [100, 150], topLeft: "green", topRight: "yellow" },
  ])(
    "turns orientation $orientation ($byteOrder) upright",
    ({ orientation, byteOrder, size, topLeft, topRight }) => {
      const bytes = withOrientation(encodeJpeg(cornered(), 95), orientation, byteOrder);
      const fit = expectFitted(
        fitImage({ bytes, mimeType: "image/jpeg" }, { maxEdge: 150, maxBytes: PICTURE_MAX_BYTES }),
      );
      expect([fit.mimeType, fit.width, fit.height]).toEqual(["image/jpeg", ...size]);
      const upright = decode(fit);
      expect([upright.width, upright.height]).toEqual(size);
      expect(cornerAt(upright, 5, 5)).toBe(topLeft);
      expect(cornerAt(upright, upright.width - 6, 5)).toBe(topRight);
    },
  );

  it("reads a malformed EXIF block as upright", () => {
    const bytes = withOrientation(encodeJpeg(cornered(), 95), 6, "II");
    // Point IFD0 past the end of the block.
    bytes.set([0xff, 0xff, 0, 0], 2 + 4 + 6 + 4);
    const fit = expectFitted(
      fitImage({ bytes, mimeType: "image/jpeg" }, { maxEdge: 150, maxBytes: PICTURE_MAX_BYTES }),
    );
    expect([fit.width, fit.height]).toEqual([150, 100]);
    expect(cornerAt(decode(fit), 5, 5)).toBe("red");
  });
});

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface PngVariant {
  readonly colorType: 0 | 2 | 3 | 4 | 6;
  readonly bitDepth: 8 | 16;
  readonly interlace: boolean;
}

/** PNG variants pngjs cannot write: palette, gray, 16-bit, Adam7. Unfiltered rows. */
function encodePngVariant(image: TestImage, variant: PngVariant): Uint8Array {
  const palette: Rgba[] = [];
  const samples = (rgba: Rgba): number[] => {
    const [r, g, b, a] = rgba;
    switch (variant.colorType) {
      case 0:
        return [r];
      case 2:
        return [r, g, b];
      case 3: {
        const index = palette.findIndex((entry) => entry.every((value, i) => value === rgba[i]));
        if (index !== -1) return [index];
        palette.push(rgba);
        return [palette.length - 1];
      }
      case 4:
        return [r, a];
      case 6:
        return [r, g, b, a];
    }
  };
  const rows: number[] = [];
  for (const [left, top, stepX, stepY] of variant.interlace ? ADAM7 : [[0, 0, 1, 1] as const]) {
    for (let y = top; y < image.height; y += stepY) {
      rows.push(0);
      for (let x = left; x < image.width; x += stepX) {
        for (const sample of samples(pixel(image, x, y))) {
          // A 16-bit sample of v is v·257: the byte v twice.
          rows.push(...(variant.bitDepth === 16 ? [sample, sample] : [sample]));
        }
      }
    }
  }
  const chunks = [
    pngHeaderChunk(
      image.width,
      image.height,
      variant.bitDepth,
      variant.colorType,
      variant.interlace,
    ),
  ];
  if (variant.colorType === 3) {
    chunks.push(pngChunk("PLTE", Uint8Array.from(palette.flatMap(([r, g, b]) => [r, g, b]))));
    chunks.push(pngChunk("tRNS", Uint8Array.from(palette.map(([, , , a]) => a))));
  }
  chunks.push(pngChunk("IDAT", NodeZlib.deflateSync(Uint8Array.from(rows))));
  chunks.push(pngChunk("IEND", new Uint8Array(0)));
  return Uint8Array.from([...PNG_SIGNATURE, ...chunks.flatMap((chunk) => [...chunk])]);
}

describe("fitImage PNG kinds", () => {
  it.each<{
    readonly name: string;
    readonly variant: PngVariant;
    readonly left: Rgba;
    readonly right: Rgba;
  }>([
    {
      name: "16-bit RGB",
      variant: { colorType: 2, bitDepth: 16, interlace: false },
      left: [220, 40, 40, 255],
      right: [40, 40, 220, 255],
    },
    {
      name: "16-bit RGBA",
      variant: { colorType: 6, bitDepth: 16, interlace: false },
      left: [220, 40, 40, 255],
      right: [40, 40, 220, 128],
    },
    {
      name: "palette with transparency",
      variant: { colorType: 3, bitDepth: 8, interlace: false },
      left: [220, 40, 40, 255],
      right: [40, 40, 220, 128],
    },
    {
      name: "grayscale",
      variant: { colorType: 0, bitDepth: 8, interlace: false },
      left: [40, 40, 40, 255],
      right: [200, 200, 200, 255],
    },
    {
      name: "grayscale with alpha",
      variant: { colorType: 4, bitDepth: 8, interlace: false },
      left: [40, 40, 40, 255],
      right: [200, 200, 200, 128],
    },
    {
      name: "interlaced RGBA",
      variant: { colorType: 6, bitDepth: 8, interlace: true },
      left: [220, 40, 40, 255],
      right: [40, 40, 220, 128],
    },
    {
      name: "interlaced 16-bit grayscale",
      variant: { colorType: 0, bitDepth: 16, interlace: true },
      left: [40, 40, 40, 255],
      right: [200, 200, 200, 255],
    },
  ])("opens a $name PNG", ({ variant, left, right }) => {
    const image = draw(64, 48, (x) => (x < 32 ? left : right));
    const fit = expectFitted(
      fitImage(
        { bytes: encodePngVariant(image, variant), mimeType: "image/png" },
        { maxEdge: 32, maxBytes: PICTURE_MAX_BYTES },
      ),
    );
    expect([fit.mimeType, fit.width, fit.height]).toEqual(["image/png", 32, 24]);
    const fitted = decode(fit);
    expect(pixel(fitted, 8, 12)).toEqual(left);
    expect(pixel(fitted, 24, 12)).toEqual(right);
  });
});

describe("fitImage PNG data past its header", () => {
  // A small upload whose header names a small picture while its data inflates
  // without end: pngjs inflates interlaced data unbounded, so it must not open it.
  it.each([
    { name: "interlaced", interlace: true, inflatedMegabytes: 64 },
    { name: "interlaced, far past its size", interlace: true, inflatedMegabytes: 160 },
  ])("refuses an $name PNG unopened", ({ interlace, inflatedMegabytes }) => {
    const read = vi.spyOn(PNG.sync, "read");
    const bytes = Uint8Array.from([
      ...PNG_SIGNATURE,
      ...pngHeaderChunk(PICTURE_MAX_EDGE + 1, 1, 8, 6, interlace),
      ...pngChunk(
        "IDAT",
        NodeZlib.deflateSync(new Uint8Array(inflatedMegabytes * 1024 * 1024), { level: 9 }),
      ),
      ...pngChunk("IEND", new Uint8Array(0)),
    ]);
    try {
      expect(fitImageForProviders({ bytes, mimeType: "image/png" })._tag).toBe("unsupported");
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});

describe("withFittedPicture", () => {
  const picture = {
    _tag: "fitted" as const,
    bytes: new Uint8Array(1234),
    width: 2000,
    height: 1500,
  };

  it.each([
    { name: "shot.png", from: "image/png", to: "image/jpeg" as const, expected: "shot.jpg" },
    { name: "Shot.PNG", from: "image/png", to: "image/jpeg" as const, expected: "Shot.jpg" },
    {
      name: "IMG_0412.jpg",
      from: "image/jpeg",
      to: "image/jpeg" as const,
      expected: "IMG_0412.jpg",
    },
    {
      name: "IMG_0412.jpeg",
      from: "image/png",
      to: "image/jpeg" as const,
      expected: "IMG_0412.jpeg",
    },
    {
      name: "labelled.jpg",
      from: "image/jpeg",
      to: "image/png" as const,
      expected: "labelled.png",
    },
    {
      name: "mislabelled.png",
      from: "image/jpeg",
      to: "image/jpeg" as const,
      expected: "mislabelled.png",
    },
    {
      name: "Screenshot 2026-09-29 at 10.42.13",
      from: "image/png",
      to: "image/jpeg" as const,
      expected: "Screenshot 2026-09-29 at 10.42.13.jpg",
    },
    {
      name: `${"a".repeat(251)}.png`,
      from: "image/png",
      to: "image/jpeg" as const,
      expected: `${"a".repeat(251)}.jpg`,
    },
    {
      name: "a".repeat(255),
      from: "image/png",
      to: "image/jpeg" as const,
      expected: `${"a".repeat(251)}.jpg`,
    },
  ])("names $name ($from as $to) $expected", ({ name, from, to, expected }) => {
    const attachment = {
      type: "image" as const,
      id: "thread-1-a",
      name,
      mimeType: from,
      sizeBytes: 9,
    };
    expect(withFittedPicture(attachment, { ...picture, mimeType: to })).toEqual({
      ...attachment,
      name: expected,
      mimeType: to,
      sizeBytes: 1234,
    });
  });
});
