import { PNG } from "pngjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const MACOS_ICON_SIZE = 1024;
export const MACOS_ICON_OPAQUE_INSET = 100;
export const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export interface MacOsActoolInput {
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly partialInfoPlistPath: string;
}

export interface PngIconImage {
  readonly size: number;
  readonly contents: Buffer;
}

export function createMacOsActoolArguments(input: MacOsActoolInput): ReadonlyArray<string> {
  return [
    "actool",
    input.sourcePath,
    "--compile",
    input.outputDirectory,
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "13.4",
    "--target-device",
    "mac",
    "--app-icon",
    "app-icon",
    "--standalone-icon-behavior",
    "all",
    "--output-partial-info-plist",
    input.partialInfoPlistPath,
    "--output-format",
    "human-readable-text",
    "--warnings",
    "--errors",
  ];
}

export function readPngDimensions(contents: Buffer): {
  readonly width: number;
  readonly height: number;
} {
  if (
    contents.length < 24 ||
    !contents.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    contents.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Icon Composer produced an invalid PNG.");
  }

  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
  };
}

export function hasClassicMacOsSafeArea(contents: Buffer): boolean {
  try {
    const png = PNG.sync.read(contents);
    if (png.width !== MACOS_ICON_SIZE || png.height !== MACOS_ICON_SIZE) return false;

    let minX = png.width;
    let minY = png.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const alpha = png.data[(y * png.width + x) * 4 + 3];
        if (alpha === undefined || alpha < 128) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const opaqueMax = MACOS_ICON_SIZE - MACOS_ICON_OPAQUE_INSET - 1;
    return (
      minX === MACOS_ICON_OPAQUE_INSET &&
      minY === MACOS_ICON_OPAQUE_INSET &&
      maxX === opaqueMax &&
      maxY === opaqueMax
    );
  } catch {
    return false;
  }
}

/** Encodes PNG renditions directly into a modern, multi-resolution ICO file. */
export function encodePngIco(images: ReadonlyArray<PngIconImage>): Buffer {
  if (images.length === 0) {
    throw new Error("An ICO file requires at least one PNG rendition.");
  }

  const seenSizes = new Set<number>();
  for (const image of images) {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) {
      throw new Error(`ICO rendition size must be an integer from 1 to 256, got ${image.size}.`);
    }
    if (seenSizes.has(image.size)) {
      throw new Error(`ICO rendition size ${image.size} was provided more than once.`);
    }
    if (image.contents.length === 0) {
      throw new Error(`ICO rendition ${image.size}x${image.size} is empty.`);
    }
    seenSizes.add(image.size);
  }

  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = directoryEntrySize * images.length;
  const header = Buffer.alloc(headerSize + directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = header.length;
  images.forEach((image, index) => {
    const entryOffset = headerSize + index * directoryEntrySize;
    const encodedSize = image.size === 256 ? 0 : image.size;
    header.writeUInt8(encodedSize, entryOffset);
    header.writeUInt8(encodedSize, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.contents.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.contents.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.contents)]);
}
