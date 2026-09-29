// @vitest-environment happy-dom
/**
 * The open picture draws from the pasted file as the tab keeps it: a big
 * picture is kept smaller, and the view reads its crop at that size.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ComposerImageAttachment } from "../../composerDraftStore";
import type { ComposerPicture } from "../../lib/composerPictures";
import { ComposerPictureView } from "./ComposerPictureView";

let root: Root | undefined;
const drawImage = vi.fn();

function picture(): ComposerImageAttachment & { readonly picture: ComposerPicture } {
  const file = new File([new Uint8Array(8)], "photo.png", { type: "image/png" });
  return {
    type: "image",
    id: "photo",
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: "blob:photo",
    file,
    picture: {
      source: file,
      sourceWidth: 8000,
      sourceHeight: 6000,
      crop: { x: 800, y: 600, w: 4000, h: 3000 },
      marks: [],
      keepOriginal: false,
      width: 2000,
      height: 1500,
      asPasted: false,
      preparing: false,
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        drawImage,
        setTransform: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low",
      }) as unknown as CanvasRenderingContext2D,
  );
  drawImage.mockClear();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the open picture", () => {
  it("draws its crop from a picture the tab keeps at half its size", async () => {
    const bitmap = { width: 4000, height: 3000, close: () => {} } as unknown as ImageBitmap;
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(() =>
      root!.render(
        <ComposerPictureView
          image={picture()}
          bitmap={bitmap}
          mateName="Fen"
          canKeepOriginal
          onChange={() => {}}
          onClose={() => {}}
        />,
      ),
    );

    const [source, x, y, w, h] = drawImage.mock.calls[0] ?? [];
    expect(source).toBe(bitmap);
    expect([x, y, w, h]).toEqual([400, 300, 2000, 1500]);
  });
});
