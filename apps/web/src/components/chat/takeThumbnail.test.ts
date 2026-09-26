import { describe, expect, it } from "vite-plus/test";

import { sparseCropBox } from "./takeThumbnail";

type Rect = readonly [x: number, y: number, width: number, height: number];

/** A picture of `width` × `height` on a background, with blocks of ink. */
function picture(
  width: number,
  height: number,
  background: number,
  ink: number,
  blocks: ReadonlyArray<Rect>,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(background);
  for (const [bx, by, bw, bh] of blocks) {
    for (let y = by; y < by + bh; y += 1) {
      for (let x = bx; x < bx + bw; x += 1) {
        const at = (y * width + x) * 4;
        pixels[at] = ink;
        pixels[at + 1] = ink;
        pixels[at + 2] = ink;
      }
    }
  }
  return pixels;
}

describe("sparseCropBox", () => {
  it.each([
    {
      name: "a JSON line along the top of a white page",
      pixels: picture(160, 72, 255, 30, [[2, 2, 100, 2]]),
      box: { x: 0, y: 0, width: 106, height: 66 },
    },
    {
      name: "a short line: never narrower than a quarter of the page",
      pixels: picture(160, 72, 255, 30, [[4, 4, 10, 2]]),
      box: { x: 1, y: 1, width: 40, height: 25 },
    },
    {
      name: "light words on a dark page",
      pixels: picture(160, 72, 20, 230, [[60, 30, 30, 4]]),
      box: { x: 57, y: 27, width: 40, height: 25 },
    },
    {
      name: "a page with content across it",
      pixels: picture(160, 72, 255, 30, [[0, 0, 120, 60]]),
      box: null,
    },
    { name: "an empty page", pixels: picture(160, 72, 255, 30, []), box: null },
  ])("crops $name", ({ pixels, box }) => {
    expect(sparseCropBox(pixels, 160, 72, 1.6)).toEqual(box);
  });
});
