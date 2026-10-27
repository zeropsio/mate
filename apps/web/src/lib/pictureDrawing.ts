/**
 * The one drawing of a picture's marks: the copy the Mate sees, the picture in
 * the text and the open picture all use it, so a mark looks the same in each.
 *
 * Marks are numbered discs on a white halo; a box is a rounded outline with
 * its number on its corner. Sizes follow the picture's longer side, so a mark
 * burnt into a 2000 px copy reads at the size it had on screen.
 */
import type { PictureMark, PictureRect } from "./composerPictures";

/** The notes' pink: the same in both themes, since it is burnt into the pixels. */
export const PICTURE_NOTE_COLOR = "#e5267a";
const HALO_COLOR = "rgba(255,255,255,.92)";
const DISC_SHADOW = "rgba(0,0,0,.35)";
const MARK_FONT = "Roboto, -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PictureMarkMetrics {
  /** The disc's radius. */
  readonly radius: number;
  readonly halo: number;
  readonly stroke: number;
}

/** A mark's size on a picture whose longer side is `length` px, never under `minRadius`. */
export function pictureMarkMetrics(length: number, minRadius: number): PictureMarkMetrics {
  const radius = Math.max(minRadius, length * 0.012);
  return {
    radius,
    halo: Math.max(1.5, radius * 0.17),
    stroke: Math.max(2, length * 0.0026),
  };
}

function roundedRect(context: Context2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

export interface PictureMarksView {
  /** The source pixel at the canvas's origin, and canvas pixels per source pixel. */
  readonly origin: { readonly x: number; readonly y: number };
  readonly scale: number;
  /** The picture's longer side on this canvas, which sizes the marks. */
  readonly length: number;
  readonly minRadius: number;
  /** The mark drawn as selected (a ring around its disc). */
  readonly selected?: number;
  /** A box being dragged out, drawn without a number. */
  readonly pending?: PictureRect | null;
}

export function drawPictureMarks(
  context: Context2D,
  marks: ReadonlyArray<PictureMark>,
  view: PictureMarksView,
): void {
  const { radius, halo, stroke } = pictureMarkMetrics(view.length, view.minRadius);
  const discs: Array<{ x: number; y: number; index: number }> = [];
  const place = (x: number, y: number) => ({
    x: (x - view.origin.x) * view.scale,
    y: (y - view.origin.y) * view.scale,
  });
  const outline = (rect: PictureRect) => {
    const corner = place(rect.x, rect.y);
    const w = rect.w * view.scale;
    const h = rect.h * view.scale;
    context.save();
    roundedRect(context, corner.x, corner.y, w, h, Math.min(radius * 0.45, w / 2, h / 2));
    context.lineJoin = "round";
    context.strokeStyle = HALO_COLOR;
    context.lineWidth = stroke + halo * 2;
    context.stroke();
    context.strokeStyle = PICTURE_NOTE_COLOR;
    context.lineWidth = stroke;
    context.stroke();
    context.restore();
    return corner;
  };
  marks.forEach((mark, index) => {
    const at = mark.kind === "box" ? outline(mark) : place(mark.x, mark.y);
    discs.push({ ...at, index });
  });
  if (view.pending) outline(view.pending);
  for (const disc of discs) {
    context.save();
    context.shadowColor = DISC_SHADOW;
    context.shadowBlur = radius * 0.6;
    context.shadowOffsetY = radius * 0.1;
    context.beginPath();
    context.arc(disc.x, disc.y, radius + halo, 0, Math.PI * 2);
    context.fillStyle = HALO_COLOR;
    context.fill();
    context.restore();
    if (disc.index === view.selected) {
      context.beginPath();
      context.arc(disc.x, disc.y, radius + halo + Math.max(2.5, radius * 0.24), 0, Math.PI * 2);
      context.strokeStyle = PICTURE_NOTE_COLOR;
      context.lineWidth = Math.max(1.5, radius * 0.12);
      context.stroke();
    }
    context.beginPath();
    context.arc(disc.x, disc.y, radius, 0, Math.PI * 2);
    context.fillStyle = PICTURE_NOTE_COLOR;
    context.fill();
    context.fillStyle = HALO_COLOR;
    context.font = `700 ${Math.round(radius * 1.1)}px ${MARK_FONT}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(disc.index + 1), disc.x, disc.y + radius * 0.06);
  }
}

/**
 * The crop drawn to fill the canvas with the marks burnt in: `fit` scales the
 * whole crop (the copy), `cover` fills the canvas and trims the overflow (the
 * picture in the text). The crop and the marks are in the pasted file's
 * pixels; `imageScale` is the image's pixels per one of them, for a picture
 * kept smaller in the tab.
 */
export function drawPictureComposite(
  context: Context2D,
  input: {
    readonly image: CanvasImageSource;
    readonly imageScale?: number;
    readonly crop: PictureRect;
    readonly marks: ReadonlyArray<PictureMark>;
    readonly width: number;
    readonly height: number;
    readonly mode: "fit" | "cover";
    readonly minRadius: number;
  },
): void {
  let region = { ...input.crop };
  if (input.mode === "cover") {
    const aspect = input.width / input.height;
    if (region.w / region.h > aspect) {
      const w = region.h * aspect;
      region = { ...region, x: region.x + (region.w - w) / 2, w };
    } else {
      const h = region.w / aspect;
      region = { ...region, y: region.y + (region.h - h) / 2, h };
    }
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const imageScale = input.imageScale ?? 1;
  context.drawImage(
    input.image,
    region.x * imageScale,
    region.y * imageScale,
    region.w * imageScale,
    region.h * imageScale,
    0,
    0,
    input.width,
    input.height,
  );
  const scale = input.width / region.w;
  drawPictureMarks(context, input.marks, {
    origin: { x: region.x, y: region.y },
    scale,
    length: Math.max(input.crop.w, input.crop.h) * scale,
    minRadius: input.minRadius,
  });
}
