/**
 * A take's picture as a thumbnail shows it. A page that is mostly empty — an
 * API's JSON, a plain-text page — shown whole at thumbnail size is a white
 * box with a smudge along its top, a take that reads as broken (Nova,
 * 2026-09-26: `/api/time` at 126 × 78). Such a picture is cropped to where
 * its content is, never narrower than a quarter of the page, so the thumbnail
 * shows the text as text. A page with content across it is shown whole.
 */
import { useEffect, useState } from "react";

export interface CropBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A picture whose content covers less of it than this is cropped to the content. */
const SPARSE_AREA = 0.2;
/** The crop is never narrower than this share of the page: text stays text-sized. */
const MIN_CROP_WIDTH = 0.25;
/** How far a pixel's channel may stray from the page's background and still be background. */
const INK_DISTANCE = 40;

/**
 * Where a picture's content is, as a box in its own pixels with the frame's
 * aspect, when the content covers little of it; null for a picture with
 * content across it, or none. `pixels` is RGBA, row by row.
 */
export function sparseCropBox(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  aspect: number,
): CropBox | null {
  if (width === 0 || height === 0) return null;
  // The page's background: the colour most of its corners share.
  const at = (x: number, y: number) => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const background =
    corners.find(
      (corner) =>
        corners.filter((other) =>
          [0, 1, 2].every((channel) => pixels[corner + channel] === pixels[other + channel]),
        ).length >= 2,
    ) ?? corners[0]!;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = at(x, y);
      const ink = [0, 1, 2].some(
        (channel) =>
          Math.abs(pixels[pixel + channel]! - pixels[background + channel]!) > INK_DISTANCE,
      );
      if (!ink) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const inkWidth = right - left + 1;
  const inkHeight = bottom - top + 1;
  if ((inkWidth * inkHeight) / (width * height) >= SPARSE_AREA) return null;
  // The content with a margin, at least a quarter of the page wide, in the
  // frame's shape, and inside the picture.
  const margin = Math.round(width * 0.02);
  let cropWidth = Math.max(inkWidth + margin * 2, Math.round(width * MIN_CROP_WIDTH));
  let cropHeight = Math.round(cropWidth / aspect);
  if (cropHeight < inkHeight + margin * 2) {
    cropHeight = inkHeight + margin * 2;
    cropWidth = Math.round(cropHeight * aspect);
  }
  cropWidth = Math.min(cropWidth, width);
  cropHeight = Math.min(cropHeight, height);
  const x = Math.min(Math.max(0, left - margin), width - cropWidth);
  const y = Math.min(Math.max(0, top - margin), height - cropHeight);
  return { x, y, width: cropWidth, height: cropHeight };
}

/** The sample a picture is read at: its content is found on this many pixels across. */
const SAMPLE_WIDTH = 160;

const thumbnails = new Map<string, string>();

async function cropSparse(src: string, aspect: number): Promise<string> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const sampleWidth = Math.min(SAMPLE_WIDTH, image.naturalWidth);
  const scale = sampleWidth / image.naturalWidth;
  const sampleHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const sample = document.createElement("canvas");
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (sampleContext === null) return src;
  sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const box = sparseCropBox(
    sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data,
    sampleWidth,
    sampleHeight,
    aspect,
  );
  if (box === null) return src;
  // Drawn from the full picture, at twice a thumbnail's width for dense screens.
  const out = document.createElement("canvas");
  out.width = 320;
  out.height = Math.round(320 / aspect);
  const context = out.getContext("2d");
  if (context === null) return src;
  context.drawImage(
    image,
    box.x / scale,
    box.y / scale,
    box.width / scale,
    box.height / scale,
    0,
    0,
    out.width,
    out.height,
  );
  return out.toDataURL("image/png");
}

/**
 * The picture a take's thumbnail draws: the picture itself, or — once read,
 * for a mostly empty page — its content cropped. Read once per picture.
 */
export function useTakeThumbnail(src: string | undefined, aspect: number): string | undefined {
  const key = src === undefined ? undefined : `${aspect}:${src}`;
  const [cropped, setCropped] = useState<{ key: string; src: string } | null>(null);
  useEffect(() => {
    if (key === undefined || src === undefined || thumbnails.has(key)) return;
    let current = true;
    cropSparse(src, aspect).then(
      (thumbnail) => {
        thumbnails.set(key, thumbnail);
        if (current) setCropped({ key, src: thumbnail });
      },
      // An image the browser cannot read is shown as it is.
      () => thumbnails.set(key, src),
    );
    return () => {
      current = false;
    };
  }, [aspect, key, src]);
  if (key === undefined) return undefined;
  return thumbnails.get(key) ?? (cropped?.key === key ? cropped.src : src);
}
