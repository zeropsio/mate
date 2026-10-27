/** Raster formats kept in private change descriptions; SVG and document types are excluded. */
export const RASTER_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;
export type RasterContentType = (typeof RASTER_CONTENT_TYPES)[number];

const matches = (bytes: Uint8Array, signature: ReadonlyArray<number>, offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);
const word = (bytes: Uint8Array, offset: number, text: string) =>
  [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));

/** The type in the stored bytes, independent of a filename or a caller's declared type. */
export function rasterContentType(bytes: Uint8Array): RasterContentType | undefined {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (word(bytes, 0, "GIF87a") || word(bytes, 0, "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && word(bytes, 0, "RIFF") && word(bytes, 8, "WEBP")) return "image/webp";
  if (bytes.length >= 16 && word(bytes, 4, "ftyp")) {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    // The major brand or a compatible brand inside the file-type box; never arbitrary payload.
    if (size >= 16 && size <= bytes.length && size % 4 === 0) {
      const avifAt = (offset: number) => word(bytes, offset, "avif") || word(bytes, offset, "avis");
      if (avifAt(8)) return "image/avif";
      for (let offset = 16; offset < size; offset += 4) {
        if (avifAt(offset)) return "image/avif";
      }
    }
  }
  return undefined;
}
