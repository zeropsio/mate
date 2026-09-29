/**
 * The composer's pictures: a picture pasted or dropped lands at the caret, its
 * copy for the Mate is made (and made again after every edit, the latest edit
 * winning), the open picture edits it, and the draft's pictures follow the
 * text's order as the person types, moves and deletes.
 *
 * The draft store holds each picture (its copy as the attachment's file, its
 * edits beside it); this hook holds what only this tab needs: the decoded
 * pictures, their thumbnails with the marks drawn in, and the open one.
 */
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  isProviderSendTurnSupportedImageMimeType,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { collapseExpandedComposerCursor } from "~/composer-logic";
import {
  type ComposerImageAttachment,
  type DraftId,
  useComposerDraftStore,
} from "~/composerDraftStore";
import {
  pictureOriginalUploadKey,
  releaseAttachmentUpload,
  releasePictureCopyUpload,
  retryAttachmentUpload,
} from "~/lib/attachmentUploadQueue";
import type { AttachmentUploadState } from "~/lib/attachmentUploadState";
import {
  INLINE_PICTURE_PLACEHOLDER,
  fullPictureCrop,
  insertInlinePicturePlaceholder,
  pictureThumbSize,
  removeInlinePicturePlaceholder,
  type ComposerPicture,
} from "~/lib/composerPictures";
import {
  fitPictureCopy,
  isHeicImageFile,
  pictureCanvasEncoder,
  pictureFitSize,
  pictureSourceFile,
} from "~/lib/imageCompression";
import { drawPictureComposite } from "~/lib/pictureDrawing";
import { randomUUID } from "~/lib/utils";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import type { ComposerPictureView as ComposerPictureChip } from "./ComposerPicture";
import { ComposerPictureView } from "./ComposerPictureView";

/** How long an edit waits for the next before the copy is made again. */
const REMAKE_DELAY_MS = 450;

export interface ComposerPicturesInput {
  readonly draftTarget: ScopedThreadRef | DraftId;
  readonly environmentId: EnvironmentId;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly supportsAttachmentUploads: boolean;
  readonly uploadsByImageId: Readonly<Record<string, AttachmentUploadState>>;
  readonly editorRef: RefObject<ComposerPromptEditorHandle | null>;
  readonly promptRef: RefObject<string>;
  /** The prompt was written here (a picture's place came or went): the caret goes to `cursor`. */
  readonly onPromptWritten: (prompt: string, cursor: number) => void;
  /** Why no picture can be added right now, or null. */
  readonly refusal: () => string | null;
  readonly onError: (message: string) => void;
}

export interface ComposerPictures {
  /** What the text shows of each picture, in the order they sit. */
  readonly chips: ReadonlyArray<ComposerPictureChip>;
  readonly add: (files: ReadonlyArray<File>) => Promise<void>;
  readonly open: (id: string) => void;
  readonly remove: (id: string) => void;
  readonly retry: (id: string) => void;
  /**
   * The editor's pictures, in its order: the draft follows. A place whose
   * picture is already gone (undone back into the text) leaves it; the
   * prompt without it is returned, or null when nothing had to go.
   */
  readonly sync: (pictureIds: ReadonlyArray<string>, prompt: string) => string | null;
  /** Why the message cannot go yet, or null. */
  readonly blockReason: string | null;
  /** The open picture, rendered over everything. */
  readonly view: ReactNode;
}

function copyName(name: string, type: string): string {
  const extension = type === "image/png" ? ".png" : type === "image/jpeg" ? ".jpg" : null;
  if (!extension) return name;
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name || "image"}${extension}`;
}

function thumbnailOf(bitmap: ImageBitmap, picture: ComposerPicture): string | null {
  const size = pictureThumbSize(picture.crop);
  const canvas = document.createElement("canvas");
  canvas.width = size.width * 2;
  canvas.height = size.height * 2;
  const context = canvas.getContext("2d");
  if (!context) return null;
  drawPictureComposite(context, {
    image: bitmap,
    crop: picture.crop,
    marks: picture.marks,
    width: canvas.width,
    height: canvas.height,
    mode: "cover",
    minRadius: 0,
  });
  return canvas.toDataURL("image/png");
}

export function useComposerPictures(input: ComposerPicturesInput): ComposerPictures {
  const insertImage = useComposerDraftStore((store) => store.insertImage);
  const updateImage = useComposerDraftStore((store) => store.updateImage);
  const syncImages = useComposerDraftStore((store) => store.syncImages);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const mate = useZeropsMate(input.environmentId);
  const mateName = mate.kind === "mate" ? mate.mate.name : "The Mate";

  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const bitmaps = useRef(new Map<string, ImageBitmap>());
  const decoding = useRef(new Map<string, Promise<ImageBitmap>>());
  const tokens = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, number>());
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The open picture, and its pasted file decoded (null after a reload dropped it).
  const [opened, setOpened] = useState<{
    readonly id: string;
    readonly bitmap: ImageBitmap | null;
  } | null>(null);

  const imageOf = useCallback(
    (id: string) =>
      useComposerDraftStore
        .getState()
        .getComposerDraft(latest.current.draftTarget)
        ?.images.find((image) => image.id === id),
    [],
  );

  const drawThumbnail = useCallback((id: string, picture: ComposerPicture) => {
    const bitmap = bitmaps.current.get(id);
    const thumbnail = bitmap ? thumbnailOf(bitmap, picture) : null;
    setThumbnails((current) => {
      // Thumbnails of pictures no longer in the draft go as a new one comes.
      const next = new Map([...current].filter(([key]) => bitmaps.current.has(key)));
      if (thumbnail) next.set(id, thumbnail);
      else next.delete(id);
      return next;
    });
  }, []);

  /** A new edit: a copy still being made from the old one must not land. */
  const supersede = useCallback((id: string) => {
    tokens.current.set(id, (tokens.current.get(id) ?? 0) + 1);
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    return tokens.current.get(id)!;
  }, []);

  const removePicture = useCallback(
    (id: string) => {
      const { draftTarget, promptRef, onPromptWritten } = latest.current;
      const images = useComposerDraftStore.getState().getComposerDraft(draftTarget)?.images ?? [];
      const index = images.findIndex((image) => image.id === id);
      if (index < 0) return;
      supersede(id);
      releaseAttachmentUpload(id);
      const removal = removeInlinePicturePlaceholder(promptRef.current, index);
      promptRef.current = removal.prompt;
      syncImages(
        draftTarget,
        images.filter((image) => image.id !== id).map((image) => image.id),
      );
      setPrompt(draftTarget, removal.prompt);
      onPromptWritten(
        removal.prompt,
        collapseExpandedComposerCursor(removal.prompt, removal.cursor),
      );
    },
    [setPrompt, supersede, syncImages],
  );

  /** Makes the picture's copy from its current edits; the latest edit wins. */
  const makeCopy = useCallback(
    async (id: string) => {
      const token = supersede(id);
      const image = imageOf(id);
      const picture = image?.picture;
      const bitmap = bitmaps.current.get(id);
      if (!image || !picture?.source || !bitmap) return;
      const source = picture.source;
      const copy = await fitPictureCopy({
        source: {
          type: source.type,
          bytes: source.size,
          width: picture.sourceWidth,
          height: picture.sourceHeight,
        },
        crop: picture.crop,
        markCount: picture.marks.length,
        encode: pictureCanvasEncoder({ image: bitmap, crop: picture.crop, marks: picture.marks }),
      });
      const now = imageOf(id);
      if (
        tokens.current.get(id) !== token ||
        !now?.picture ||
        now.picture.crop !== picture.crop ||
        now.picture.marks !== picture.marks
      ) {
        return;
      }
      if (copy.kind === "too-large") {
        removePicture(id);
        latest.current.onError(`'${source.name}' is too large to send, even fitted.`);
        return;
      }
      const file =
        copy.kind === "as-pasted"
          ? source
          : new File([copy.blob], copyName(now.name, copy.type), { type: copy.type });
      const size =
        copy.kind === "as-pasted"
          ? { width: picture.sourceWidth, height: picture.sourceHeight }
          : { width: copy.width, height: copy.height };
      if (now.file !== file) releasePictureCopyUpload(id);
      updateImage(latest.current.draftTarget, {
        ...now,
        name: file.name || now.name,
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: now.file === file ? now.previewUrl : URL.createObjectURL(file),
        file,
        picture: {
          ...now.picture,
          ...size,
          asPasted: copy.kind === "as-pasted",
          preparing: false,
        },
      });
    },
    [imageOf, removePicture, supersede, updateImage],
  );

  const scheduleCopy = useCallback(
    (id: string, delay: number) => {
      supersede(id);
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          void makeCopy(id);
        }, delay),
      );
    },
    [makeCopy, supersede],
  );

  /** A picture's pasted file, decoded once for its thumbnail, its copy and its view. */
  const decode = useCallback((id: string, file: File): Promise<ImageBitmap> => {
    const known = bitmaps.current.get(id);
    if (known) return Promise.resolve(known);
    const pending = decoding.current.get(id);
    if (pending) return pending;
    const decoded = createImageBitmap(file).then(
      (bitmap) => {
        decoding.current.delete(id);
        bitmaps.current.set(id, bitmap);
        return bitmap;
      },
      (error: unknown) => {
        decoding.current.delete(id);
        throw error;
      },
    );
    decoding.current.set(id, decoded);
    return decoded;
  }, []);

  const add = useCallback(
    async (files: ReadonlyArray<File>) => {
      const refusal = latest.current.refusal();
      if (refusal) {
        latest.current.onError(refusal);
        return;
      }
      for (const file of files) {
        const { draftTarget, editorRef, promptRef, onPromptWritten, onError } = latest.current;
        const count =
          useComposerDraftStore.getState().getComposerDraft(draftTarget)?.images.length ?? 0;
        if (count >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
          onError(
            `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} pictures per message.`,
          );
          return;
        }
        const heic = isHeicImageFile(file);
        if (!heic && !isProviderSendTurnSupportedImageMimeType(file.type)) {
          onError(
            `'${file.name}' is not a picture this can send. Attach PNG, JPEG, WebP, GIF or HEIC.`,
          );
          continue;
        }
        const prepared = await pictureSourceFile(file);
        if (!prepared.ok) {
          onError(
            prepared.reason === "unreadable"
              ? `'${file.name}' could not be read as a picture.`
              : `'${file.name}' is too large to open.`,
          );
          continue;
        }
        const id = randomUUID();
        const source = prepared.file;
        let bitmap: ImageBitmap;
        try {
          bitmap = await decode(id, source);
        } catch {
          onError(`'${file.name}' could not be read as a picture.`);
          continue;
        }
        const crop = fullPictureCrop(bitmap.width, bitmap.height);
        const fitted = pictureFitSize(crop);
        const picture: ComposerPicture = {
          source,
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
          crop,
          marks: [],
          keepOriginal: false,
          width: fitted.width,
          height: fitted.height,
          asPasted: false,
          preparing: true,
        };
        drawThumbnail(id, picture);
        const snapshot = editorRef.current?.readSnapshot();
        const prompt = snapshot?.value ?? promptRef.current;
        const insertion = insertInlinePicturePlaceholder(
          prompt,
          snapshot?.expandedCursor ?? prompt.length,
        );
        insertImage(
          draftTarget,
          insertion.prompt,
          {
            type: "image",
            id,
            name: source.name || "image.png",
            mimeType: source.type,
            sizeBytes: source.size,
            previewUrl: URL.createObjectURL(source),
            file: source,
            picture,
          },
          insertion.pictureIndex,
        );
        promptRef.current = insertion.prompt;
        onPromptWritten(
          insertion.prompt,
          collapseExpandedComposerCursor(insertion.prompt, insertion.cursor),
        );
        void makeCopy(id);
      }
    },
    [decode, drawThumbnail, insertImage, makeCopy],
  );

  const edit = useCallback(
    (id: string, next: ComposerPicture) => {
      const image = imageOf(id);
      if (!image?.picture) return;
      const remake = next.crop !== image.picture.crop || next.marks !== image.picture.marks;
      updateImage(latest.current.draftTarget, {
        ...image,
        picture: { ...next, preparing: remake || image.picture.preparing },
      });
      if (!remake) return;
      drawThumbnail(id, next);
      scheduleCopy(id, REMAKE_DELAY_MS);
    },
    [drawThumbnail, imageOf, scheduleCopy, updateImage],
  );

  const open = useCallback(
    (id: string) => {
      const source = imageOf(id)?.picture?.source;
      if (!source) {
        setOpened({ id, bitmap: null });
        return;
      }
      // Restored with its pasted file (a queued message, a failed send), it is
      // decoded first; a picture pasted here already is.
      void decode(id, source).then(
        (bitmap) => setOpened({ id, bitmap }),
        () => setOpened({ id, bitmap: null }),
      );
    },
    [decode, imageOf],
  );

  const close = useCallback(
    (id: string) => {
      setOpened(null);
      if (timers.current.has(id)) void makeCopy(id);
      const { draftTarget, promptRef, editorRef } = latest.current;
      const images = useComposerDraftStore.getState().getComposerDraft(draftTarget)?.images ?? [];
      const index = images.findIndex((image) => image.id === id);
      let seen = -1;
      const prompt = promptRef.current;
      for (let at = 0; at < prompt.length; at += 1) {
        if (prompt[at] !== INLINE_PICTURE_PLACEHOLDER) continue;
        seen += 1;
        if (seen === index) {
          // The caret waits right after the picture, as if it had just been pasted.
          const cursor = collapseExpandedComposerCursor(prompt, at + 1);
          window.requestAnimationFrame(() => editorRef.current?.focusAt(cursor));
          return;
        }
      }
    },
    [makeCopy],
  );

  // An image that reached the draft without being a picture (an older draft, a
  // stash, a queued message) becomes one: its file is what was pasted.
  useEffect(() => {
    for (const image of input.images) {
      if (image.picture || bitmaps.current.has(image.id) || decoding.current.has(image.id)) {
        continue;
      }
      const id = image.id;
      void decode(id, image.file).then(
        (bitmap) => {
          const now = imageOf(id);
          if (!now || now.picture) return;
          const crop = fullPictureCrop(bitmap.width, bitmap.height);
          const fitted = pictureFitSize(crop);
          const picture: ComposerPicture = {
            source: now.file,
            sourceWidth: bitmap.width,
            sourceHeight: bitmap.height,
            crop,
            marks: [],
            keepOriginal: false,
            width: fitted.width,
            height: fitted.height,
            asPasted: false,
            preparing: true,
          };
          updateImage(latest.current.draftTarget, { ...now, picture });
          void makeCopy(id);
        },
        () => {
          // Not something this browser can draw: it goes as it came.
        },
      );
    }
  }, [decode, imageOf, input.images, makeCopy, updateImage]);

  // What a picture no longer in the draft held goes with it.
  useEffect(() => {
    const ids = new Set(input.images.map((image) => image.id));
    for (const [id, bitmap] of bitmaps.current) {
      if (ids.has(id)) continue;
      bitmap.close();
      bitmaps.current.delete(id);
      supersede(id);
      tokens.current.delete(id);
    }
  }, [input.images, supersede]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      for (const bitmap of bitmaps.current.values()) bitmap.close();
      bitmaps.current.clear();
    },
    [],
  );

  const sync = useCallback(
    (pictureIds: ReadonlyArray<string>, prompt: string): string | null => {
      const { draftTarget } = latest.current;
      const images = useComposerDraftStore.getState().getComposerDraft(draftTarget)?.images ?? [];
      const known = new Set(images.map((image) => image.id));
      const kept = pictureIds.filter((id) => known.has(id));
      for (const image of images) {
        if (!kept.includes(image.id)) releaseAttachmentUpload(image.id);
      }
      syncImages(draftTarget, kept);
      if (kept.length === pictureIds.length) return null;
      let healed = prompt;
      for (let index = pictureIds.length - 1; index >= 0; index -= 1) {
        if (!known.has(pictureIds[index]!)) {
          healed = removeInlinePicturePlaceholder(healed, index).prompt;
        }
      }
      return healed;
    },
    [syncImages],
  );

  const retry = useCallback(
    (id: string) => {
      const image = imageOf(id);
      if (image) retryAttachmentUpload({ environmentId: latest.current.environmentId, image });
    },
    [imageOf],
  );

  const chips = useMemo(
    () =>
      input.images.map((image, index): ComposerPictureChip => {
        const size = image.picture
          ? pictureThumbSize(image.picture.crop)
          : { width: 80, height: 80 };
        const failed = [image.id, pictureOriginalUploadKey(image.id)].some(
          (key) => input.uploadsByImageId[key]?.status === "failed",
        );
        return {
          id: image.id,
          number: index + 1,
          name: image.picture?.source?.name ?? image.name,
          src: thumbnails.get(image.id) ?? image.previewUrl,
          width: size.width,
          height: size.height,
          keepOriginal: Boolean(image.picture?.keepOriginal && image.picture.source),
          preparing: image.picture?.preparing ?? false,
          failed,
        };
      }),
    [input.images, input.uploadsByImageId, thumbnails],
  );

  // A picture removed while open closes with it.
  const openImage =
    opened === null ? undefined : input.images.find((image) => image.id === opened.id);
  const view =
    openImage?.picture && opened !== null ? (
      <ComposerPictureView
        key={opened.id}
        image={{ ...openImage, picture: openImage.picture }}
        bitmap={opened.bitmap}
        mateName={mateName}
        canKeepOriginal={input.supportsAttachmentUploads}
        onChange={(next) => edit(opened.id, next)}
        onClose={() => close(opened.id)}
      />
    ) : null;

  return {
    chips,
    add,
    open,
    remove: removePicture,
    retry,
    sync,
    blockReason: input.images.some((image) => image.picture?.preparing)
      ? "Picture still preparing"
      : null,
    view,
  };
}
