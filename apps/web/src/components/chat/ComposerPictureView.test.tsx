// @vitest-environment happy-dom
/**
 * The open picture draws from the pasted file as the tab keeps it: a big
 * picture is kept smaller, and the view reads its crop at that size.
 */
import { act, useState } from "react";
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

  const bitmap = { width: 4000, height: 3000, close: () => {} } as unknown as ImageBitmap;
  const mount = async (image = picture()) => {
    const changed = vi.fn<(next: ComposerPicture) => void>();
    const closed = vi.fn();
    function Picture() {
      const [value, setValue] = useState(image.picture);
      return (
        <ComposerPictureView
          image={{ ...image, picture: value }}
          bitmap={bitmap}
          mateName="Fen"
          canKeepOriginal
          onChange={(next) => {
            changed(next);
            setValue(next);
          }}
          onClose={closed}
        />
      );
    }
    // These presses edit the source picture; drawing its pixels is covered above.
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(() => root!.render(<Picture />));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog === null) throw new Error("The picture did not open.");
    return { dialog, changed, closed };
  };
  const button = (text: string) => {
    const control = Array.from(document.querySelectorAll("button")).find(
      (entry) => entry.textContent === text,
    );
    if (control === undefined) throw new Error(`The picture has no ${text} button.`);
    return control;
  };
  const key = (target: HTMLElement, value: string, shiftKey = false) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true }));
    });

  it("C opens a picture's crop, Escape discards it, Enter keeps it, and Escape closes the picture", async () => {
    const { dialog, changed, closed } = await mount();

    await key(dialog, "c");
    expect(button("Crop").getAttribute("aria-pressed")).toBe("true");
    await act(() => button("Reset").click());
    await key(dialog, "Escape");
    expect(button("Crop").getAttribute("aria-pressed")).toBe("false");
    expect(changed).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();

    await key(dialog, "C");
    await act(() => button("Reset").click());
    await key(dialog, "Enter");
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ crop: { x: 0, y: 0, w: 8000, h: 6000 } }),
    );
    expect(button("Crop").getAttribute("aria-pressed")).toBe("false");
    await key(dialog, "Escape");
    expect(closed).toHaveBeenCalledOnce();
  });

  it("pressing a picture's note opens its words and Delete removes the selected note", async () => {
    const source = picture();
    const image = {
      ...source,
      picture: {
        ...source.picture,
        marks: [
          { kind: "pin", id: "a", x: 1000, y: 1000, note: "Make this larger" },
          { kind: "pin", id: "b", x: 1200, y: 1200, note: "Keep this" },
        ] as const,
      },
    };
    const { dialog, changed } = await mount(image);

    await act(() => button("Make this larger").click());
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Note text"]')?.value).toBe(
      "Make this larger",
    );
    await key(dialog, "Escape");
    await key(dialog, "Delete");
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ marks: [image.picture.marks[1]] }),
    );
    expect(document.body.textContent).not.toContain("Make this larger");
    expect(button("Keep this")).toBeDefined();
  });

  it.each([
    { gesture: "clicking a point", drag: false, kind: "pin" },
    { gesture: "dragging an area", drag: true, kind: "box" },
  ])("$gesture marks the picture with a $kind and opens its note", async ({ drag, kind }) => {
    const { changed } = await mount();
    const frame = document.querySelector("canvas")?.parentElement;
    if (frame === null || frame === undefined) throw new Error("The picture has no frame.");
    frame.setPointerCapture = vi.fn();
    const pointer = (type: string, at: number) =>
      act(() => {
        frame.dispatchEvent(
          new PointerEvent(type, {
            button: 0,
            pointerId: 1,
            clientX: at,
            clientY: at,
            bubbles: true,
          }),
        );
      });

    await pointer("pointerdown", 5);
    if (drag) await pointer("pointermove", 25);
    await pointer("pointerup", drag ? 25 : 5);

    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({
        marks: [expect.objectContaining({ kind, note: "", id: expect.any(String) })],
      }),
    );
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Note text"]')?.value).toBe("");
  });

  it("Tab and Shift-Tab keep keyboard focus inside the open picture", async () => {
    const { dialog } = await mount();
    for (const control of dialog.querySelectorAll("button, [role=switch], textarea")) {
      Object.defineProperty(control, "offsetParent", { value: document.body });
    }
    const first = dialog.querySelector("button");
    if (first === null) throw new Error("The picture has no close button.");

    button("Done").focus();
    await key(button("Done"), "Tab");
    expect(document.activeElement).toBe(first);
    await key(first, "Tab", true);
    expect(document.activeElement).toBe(button("Done"));
  });
});
