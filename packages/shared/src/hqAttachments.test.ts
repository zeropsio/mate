import { describe, expect, it } from "vite-plus/test";
import { rasterContentType } from "./hqAttachments.ts";

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
export const RASTERS = [
  ["image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ["image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
  ["image/gif", new Uint8Array(ascii("GIF89a"))],
  ["image/webp", new Uint8Array([...ascii("RIFF"), 4, 0, 0, 0, ...ascii("WEBP")])],
  [
    "image/avif",
    new Uint8Array([0, 0, 0, 24, ...ascii("ftypavif"), 0, 0, 0, 0, ...ascii("mif1avif")]),
  ],
] as const;

describe("HQ's raster pictures", () => {
  it.each(RASTERS)("detects %s from its bytes", (type, bytes) => {
    expect(rasterContentType(bytes)).toBe(type);
  });
  it("accepts GIF87a and AVIF's compatible brand", () => {
    expect(rasterContentType(new Uint8Array(ascii("GIF87a")))).toBe("image/gif");
    const avif = new Uint8Array(RASTERS[4][1]);
    avif.set(ascii("mif1"), 8);
    expect(rasterContentType(avif)).toBe("image/avif");
  });
  it.each([
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
    "<html>picture</html>",
    "RIFFfakeJUNK",
    "ftypavif",
  ])("refuses non-raster or malformed bytes: %s", (text) => {
    expect(rasterContentType(new Uint8Array(ascii(text)))).toBeUndefined();
  });
  it("refuses an AVIF brand outside its bounded file-type box", () => {
    const avif = new Uint8Array(RASTERS[4][1]);
    avif[3] = 16;
    avif.set(ascii("mif1"), 8);
    expect(rasterContentType(avif)).toBeUndefined();
  });
});
