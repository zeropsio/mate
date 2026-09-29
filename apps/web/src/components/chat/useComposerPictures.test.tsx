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
const B = DraftId.make("draft-b");

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

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** The bitmaps made, and a gate a decode waits at while a test holds it shut. */
const decoding = { made: [] as FakeBitmap[], gate: null as Promise<unknown> | null };

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
    vi.fn(async (file: File) => {
      await decoding.gate;
      const bitmap = new FakeBitmap(file.name);
      decoding.made.push(bitmap);
      return bitmap;
    }),
  );
  decoding.made.length = 0;
  decoding.gate = null;
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

describe("whichever Mate is on screen", () => {
  const words = (target: DraftId, prompt: string) =>
    useComposerDraftStore.getState().setPrompt(target, prompt);

  it("a picture still being read when another Mate comes on screen lands in its own draft", async () => {
    words(A, "Mate A's words");
    words(B, "Mate B's words");
    await show(A);
    const opened = deferred<void>();
    decoding.gate = opened.promise;

    const adding = api.add([pngFile("shot-1200x800.png")]);
    await show(B);
    opened.resolve();
    await act(() => adding);
    await settle();

    expect(draftOf(A)).toMatchObject({ prompt: `Mate A's words${P}` });
    expect(draftOf(A)!.images.map((image) => image.name)).toEqual(["shot-1200x800.png"]);
    expect(draftOf(B)).toMatchObject({ prompt: "Mate B's words", images: [] });
  });

  it("a picture's copy made while another Mate is on screen settles in its own draft", async () => {
    await show(A);
    const made = deferred<unknown>();
    copies.fit.mockReturnValue(made.promise);
    await act(() => api.add([pngFile("shot-1200x800.png")]));
    const [picture] = draftOf(A)!.images;
    expect(picture!.picture!.preparing).toBe(true);

    await show(B);
    const blob = new Blob([new Uint8Array(32)], { type: "image/jpeg" });
    made.resolve({ kind: "fitted", blob, width: 1000, height: 667, type: "image/jpeg" });
    await settle();

    expect(imageOf(A, picture!.id)).toMatchObject({
      mimeType: "image/jpeg",
      sizeBytes: 32,
      picture: { preparing: false, width: 1000, height: 667 },
    });
    expect(draftOf(B)?.images ?? []).toEqual([]);
  });

  it("a picture too large even fitted, found while another Mate is on screen, leaves its own draft", async () => {
    words(B, "Mate B's words");
    await show(A);
    const made = deferred<unknown>();
    copies.fit.mockReturnValue(made.promise);
    await act(() => api.add([pngFile("huge-9000x9000.png")]));

    await show(B);
    made.resolve({ kind: "too-large" });
    await settle();

    expect(draftOf(A)?.images ?? []).toEqual([]);
    expect(draftOf(A)?.prompt ?? "").toBe("");
    expect(draftOf(B)).toMatchObject({ prompt: "Mate B's words" });
    expect(errors).toEqual(["'huge-9000x9000.png' is too large to send, even fitted."]);
  });

  it("a picture keeps what it holds while another Mate is on screen, and lets it go when it leaves", async () => {
    await show(A);
    await act(() => api.add([pngFile("shot-1200x800.png")]));
    const [bitmap] = decoding.made;

    await show(B);
    expect(bitmap!.close).not.toHaveBeenCalled();

    await show(A);
    await act(() => api.remove(draftOf(A)!.images[0]!.id));
    expect(bitmap!.close).toHaveBeenCalled();
  });
});

async function addedPicture(target = A) {
  await show(target);
  await act(() => api.add([pngFile("shot-1200x800.png")]));
  await settle();
  return draftOf(target)!.images.at(-1)!;
}

/** What the editor reports after an edit: the pictures it holds, and its text. */
async function textHolds(pictureIds: ReadonlyArray<string>, prompt: string) {
  let healed: string | null = null;
  await act(() => {
    healed = api.sync(pictureIds, prompt);
  });
  return healed;
}

describe("a picture taken out of the text", () => {
  it("comes back with an undo, as it was", async () => {
    const picture = await addedPicture();

    await textHolds([], "");
    expect(draftOf(A)?.images ?? []).toEqual([]);
    expect(uploads.released).toEqual([picture.id]);

    expect(await textHolds([picture.id], P)).toBeNull();
    const [back] = draftOf(A)!.images;
    expect(back).toEqual({ ...picture, previewUrl: back!.previewUrl });
    expect(back!.previewUrl).not.toBe(picture.previewUrl);
  });

  it("comes back with an undo after its corner took it out", async () => {
    const picture = await addedPicture();

    await act(() => api.remove(picture.id));
    expect(draftOf(A)?.images ?? []).toEqual([]);

    expect(await textHolds([picture.id], P)).toBeNull();
    expect(draftOf(A)!.images.map((image) => image.id)).toEqual([picture.id]);
  });

  it("taken out while its copy was being made, is made again when it comes back", async () => {
    await show(A);
    const first = deferred<unknown>();
    copies.fit.mockReturnValueOnce(first.promise);
    await act(() => api.add([pngFile("shot-1200x800.png")]));
    const picture = draftOf(A)!.images[0]!;

    await textHolds([], "");
    first.resolve({ kind: "as-pasted" });
    await settle();
    await textHolds([picture.id], P);
    await settle();

    expect(copies.fit).toHaveBeenCalledTimes(2);
    expect(imageOf(A, picture.id)!.picture!.preparing).toBe(false);
  });

  it("a picture too large to send does not come back", async () => {
    copies.fit.mockResolvedValue({ kind: "too-large" });
    await show(A);
    await act(() => api.add([pngFile("huge-9000x9000.png")]));
    await settle();
    expect(draftOf(A)?.images ?? []).toEqual([]);

    const [id] = [...new Set(uploads.released)];
    expect(await textHolds([id!], `Look${P}`)).toBe("Look");
    expect(draftOf(A)?.images ?? []).toEqual([]);
  });
});

describe("pictures pasted with words copied from the text", () => {
  it("a picture cut from the text comes back itself", async () => {
    const picture = await addedPicture();
    await textHolds([], "");

    expect(api.paste([picture.id])).toEqual([picture.id]);
    expect(await textHolds([picture.id], P)).toBeNull();
    expect(draftOf(A)!.images.map((image) => image.id)).toEqual([picture.id]);
  });

  it("a picture copied comes as a picture of its own, with the same edits", async () => {
    const picture = await addedPicture();

    const [copyId] = api.paste([picture.id]);
    expect(copyId).not.toBe(picture.id);
    expect(await textHolds([picture.id, copyId!], `${P}${P}`)).toBeNull();

    const [, copy] = draftOf(A)!.images;
    expect(copy).toEqual({ ...picture, id: copyId, previewUrl: copy!.previewUrl });
    expect(copy!.previewUrl).not.toBe(picture.previewUrl);
  });

  it("a picture cut and pasted twice comes back once, then as a copy", async () => {
    const picture = await addedPicture();
    await textHolds([], "");

    expect(api.paste([picture.id])).toEqual([picture.id]);
    await textHolds([picture.id], P);
    const [copyId] = api.paste([picture.id]);
    await textHolds([picture.id, copyId!], `${P}${P}`);

    expect(draftOf(A)!.images.map((image) => image.id)).toEqual([picture.id, copyId]);
  });

  it("a picture copied from another Mate's draft comes as one of this draft's", async () => {
    const picture = await addedPicture(A);
    await show(B);

    const [copyId] = api.paste([picture.id]);
    await textHolds([copyId!], P);

    expect(draftOf(B)!.images.map((image) => image.id)).toEqual([copyId]);
    expect(draftOf(A)!.images.map((image) => image.id)).toEqual([picture.id]);
  });

  it("a picture this composer never had cannot come", async () => {
    await show(A);
    expect(api.paste(["from-another-window"])).toEqual([null]);
  });
});
