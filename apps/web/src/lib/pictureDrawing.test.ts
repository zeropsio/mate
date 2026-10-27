import { describe, expect, it, vi } from "vite-plus/test";

import { drawPictureComposite } from "./pictureDrawing";

/** A 2D context that records where the picture was drawn from and to. */
function recordingContext() {
  const drawImage = vi.fn();
  const context = {
    drawImage,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    roundRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
  return { context: context as unknown as CanvasRenderingContext2D, drawImage };
}

describe("drawPictureComposite", () => {
  const crop = { x: 400, y: 200, w: 1600, h: 1200 };

  it.each([
    ["from a picture kept whole, its crop in its own pixels", 1, [400, 200, 1600, 1200]],
    ["from a picture kept at half its size, its crop at half", 0.5, [200, 100, 800, 600]],
  ])("draws %s", (_label, imageScale, source) => {
    const { context, drawImage } = recordingContext();
    drawPictureComposite(context, {
      image: {} as CanvasImageSource,
      imageScale,
      crop,
      marks: [],
      width: 800,
      height: 600,
      mode: "fit",
      minRadius: 0,
    });
    expect(drawImage).toHaveBeenCalledExactlyOnceWith({}, ...source, 0, 0, 800, 600);
  });
});
