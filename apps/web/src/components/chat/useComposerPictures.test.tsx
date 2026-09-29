// @vitest-environment happy-dom
/**
 * The composer's pictures as the person meets them: added while another Mate
 * comes on screen, edited after a reload, taken out and brought back.
 */
import { EnvironmentId } from "@t3tools/contracts";
import { act, useLayoutEffect, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DraftId,
  useComposerDraftStore,
  type ComposerImageAttachment,
} from "../../composerDraftStore";
import {
  INLINE_PICTURE_PLACEHOLDER as P,
  fullPictureCrop,
  type ComposerPicture,
  type PictureMark,
} from "../../lib/composerPictures";
import type { ComposerPictureViewProps } from "./ComposerPictureView";
import { useComposerPictures, type ComposerPictures } from "./useComposerPictures";

const uploads = vi.hoisted(() => ({ released: [] as string[] }));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  pictureOriginalUploadKey: (id: string) => `${id}:original`,
  releaseAttachmentUpload: (id: string) => uploads.released.push(id),
  releasePictureCopyUpload: () => {},
  retryAttachmentUpload: () => {},
}));
vi.mock("../../zerops/useZeropsMates", () => ({ useZeropsMate: () => ({ kind: "unknown" }) }));
const copies = vi.hoisted(() => ({ fit: vi.fn() }));
vi.mock("../../lib/imageCompression", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/imageCompression")>()),
  fitPictureCopy: (input: unknown) => copies.fit(input),
  pictureCanvasEncoder: () => async () => null,
}));

const ENVIRONMENT = EnvironmentId.make("environment-local");
const A = DraftId.make("draft-a");

/** A bitmap as `createImageBitmap` would make one: its size is in the file's name. */
class FakeBitmap {
  readonly width: number;
  readonly height: number;
  readonly close = vi.fn();
  constructor(name: string) {
    const [, width, height] = /(\d+)x(\d+)/u.exec(name) ?? ["", "100", "100"];
    this.width = Number(width);
    this.height = Number(height);
  }
}

const pngFile = (name: string) =>
  new File([new Uint8Array(64).fill(7)], name, { type: "image/png" });

const pin = (id: string, x: number, y: number, note: string): PictureMark => ({
  kind: "pin",
  id,
  x,
  y,
  note,
});

/** A picture as a reload brings it back: its copy, its edits, not its pasted file. */
function reloadedPicture(id: string, marks: ReadonlyArray<PictureMark>): ComposerImageAttachment {
  const file = pngFile(`${id}-1200x800.png`);
  const picture: ComposerPicture = {
    source: null,
    sourceWidth: 1200,
    sourceHeight: 800,
    crop: fullPictureCrop(1200, 800),
    marks,
    keepOriginal: false,
    width: 1200,
    height: 800,
    asPasted: false,
    preparing: false,
  };
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${id}`,
    file,
    picture,
  };
}

const draftOf = (target: DraftId) => useComposerDraftStore.getState().getComposerDraft(target);
const imageOf = (target: DraftId, id: string) =>
  draftOf(target)?.images.find((image) => image.id === id);

const NO_IMAGES: ReadonlyArray<ComposerImageAttachment> = [];
let api: ComposerPictures;
const errors: string[] = [];

/** The composer as far as its pictures go: whichever draft is on screen, and its prompt. */
function Composer({ target }: { readonly target: DraftId }) {
  const images = useComposerDraftStore(
    (store) => store.getComposerDraft(target)?.images ?? NO_IMAGES,
  );
  const promptRef = useRef("");
  useLayoutEffect(() => {
    promptRef.current = draftOf(target)?.prompt ?? "";
  }, [target]);
  const pictures = useComposerPictures({
    draftTarget: target,
    environmentId: ENVIRONMENT,
    images,
    supportsAttachmentUploads: true,
    uploadsByImageId: {},
    editorRef: { current: null },
    promptRef,
    onPromptWritten: () => {},
    refusal: () => null,
    onError: (message) => errors.push(message),
  });
  useLayoutEffect(() => {
    api = pictures;
  });
  return null;
}

let root: Root | undefined;

async function show(target: DraftId) {
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root!.render(<Composer target={target} />));
}

/** Lets every pending promise and timer of the composer run out. */
async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (file: File) => new FakeBitmap(file.name)),
  );
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  copies.fit.mockReset();
  copies.fit.mockResolvedValue({ kind: "as-pasted" });
  uploads.released.length = 0;
  errors.length = 0;
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a picture's copy", () => {
  it("a note edited after a reload leaves the picture ready to send", async () => {
    const mark = pin("m1", 40, 40, "Too small");
    useComposerDraftStore.getState().insertImage(A, `Look:${P}`, reloadedPicture("one", [mark]), 0);
    await show(A);

    await act(() => api.open("one"));
    const view = api.view as ReactElement<ComposerPictureViewProps>;
    const picture = imageOf(A, "one")!.picture!;
    await act(() =>
      view.props.onChange({ ...picture, marks: [{ ...mark, note: "Far too small" }] }),
    );
    await settle(600);

    expect(imageOf(A, "one")!.picture).toMatchObject({
      preparing: false,
      marks: [{ note: "Far too small" }],
    });
    expect(api.blockReason).toBeNull();
    expect(copies.fit).not.toHaveBeenCalled();
  });

  it("a copy that cannot be made leaves the picture as it was, ready to send", async () => {
    copies.fit.mockRejectedValue(new Error("The canvas went away"));
    await show(A);

    await act(() => api.add([pngFile("shot-1200x800.png")]));
    await settle();

    const [image] = draftOf(A)!.images;
    expect(image!.picture!.preparing).toBe(false);
    expect(api.blockReason).toBeNull();
    expect(errors).toEqual(["'shot-1200x800.png' could not be prepared, so it goes as it was."]);
  });
});
