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
  composerTargetKey,
  useComposerDraftStore,
} from "~/composerDraftStore";
import {
  pictureOriginalUploadKey,
  releaseAttachmentUpload,
  releasePictureCopyUpload,
  retryAttachmentUpload,
} from "~/lib/attachmentUploadQueue";
import type { AttachmentUploadState } from "~/lib/attachmentUploadState";
import { composerAttachmentCount } from "~/lib/composerFiles";
import {
  INLINE_PICTURE_PLACEHOLDER,
  fullPictureCrop,
  insertInlinePicturePlaceholder,
  pictureNeedsNewCopy,
  pictureThumbSize,
  removeInlinePicturePlaceholder,
  type ComposerPicture,
} from "~/lib/composerPictures";
import {
  fitPictureCopy,
  isHeicImageFile,
  pictureBitmapOptions,
  pictureCanvasEncoder,
  pictureCropBitmap,
  pictureFitSize,
  pictureSourceFile,
} from "~/lib/imageCompression";
import { drawPictureComposite } from "~/lib/pictureDrawing";
import type { ImageDimensions } from "@t3tools/shared/imageDimensions";
import { randomUUID } from "~/lib/utils";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import type { ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import type { ComposerPictureView as ComposerPictureChip } from "./ComposerPicture";
import { ComposerPictureView } from "./ComposerPictureView";

/** How long an edit waits for the next before the copy is made again. */
const REMAKE_DELAY_MS = 450;

/** How many pictures taken out of the text are kept, the latest first, for an undo or a paste. */
const HELD_PICTURES = 12;

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
   * The editor's pictures, in its order: the draft follows. A picture taken
   * out of the text is kept a while, and comes back with its place (an undo);
   * a place whose picture is gone for good leaves the text: the prompt
   * without it is returned, or null when nothing had to go.
   */
  readonly sync: (pictureIds: ReadonlyArray<string>, prompt: string) => string | null;
  /**
   * Pictures pasted with words copied from a composer's text: the id each
   * place takes, or null for a picture this composer cannot place again.
   */
  readonly paste: (ids: ReadonlyArray<string>) => ReadonlyArray<string | null>;
  /** Why the message cannot go yet, or null. */
  readonly blockReason: string | null;
  /** The open picture, rendered over everything. */
  readonly view: ReactNode;
}

type DraftTarget = ScopedThreadRef | DraftId;

const draftOf = (target: DraftTarget) => useComposerDraftStore.getState().getComposerDraft(target);
const imagesOf = (target: DraftTarget) => draftOf(target)?.images ?? [];

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
    imageScale: bitmap.width / picture.sourceWidth,
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
  // The draft each picture belongs to: its copy lands there and it leaves
  // from there, whichever Mate is on screen by then.
  const owners = useRef(new Map<string, DraftTarget>());
  // Pictures still being read, in no draft yet.
  const arriving = useRef(new Set<string>());
  // Images of a draft being opened to become pictures, and those too big to.
  const opening = useRef(new Set<string>());
  const unopenable = useRef(new Set<string>());
  // Pictures taken out of the text, the latest last: an undo or a paste
  // brings them back as they were.
  const held = useRef(new Map<string, ComposerImageAttachment>());
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The open picture, and its pasted file decoded (null after a reload dropped it).
  const [opened, setOpened] = useState<{
    readonly id: string;
    readonly bitmap: ImageBitmap | null;
  } | null>(null);

  const targetOf = useCallback(
    (id: string): DraftTarget => owners.current.get(id) ?? latest.current.draftTarget,
    [],
  );
  const imageOf = useCallback(
    (id: string) => imagesOf(targetOf(id)).find((image) => image.id === id),
    [targetOf],
  );
  const isOnScreen = useCallback(
    (target: DraftTarget) =>
      composerTargetKey(target) === composerTargetKey(latest.current.draftTarget),
    [],
  );

  const drawThumbnail = useCallback((id: string, picture: ComposerPicture) => {
    const bitmap = bitmaps.current.get(id);
    const thumbnail = bitmap ? thumbnailOf(bitmap, picture) : null;
    setThumbnails((current) => {
      // Thumbnails of pictures gone for good go as a new one comes.
      const shown = new Set(latest.current.images.map((image) => image.id));
      const next = new Map(
        [...current].filter(
          ([key]) => bitmaps.current.has(key) || held.current.has(key) || shown.has(key),
        ),
      );
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

  /** A picture's pasted file, decoded once for its thumbnail, its copy and its view. */
  /**
   * A picture's pasted file, decoded once for its thumbnail and its view: at
   * most the kept size a side, when its size is known.
   */
  const decode = useCallback(
    (id: string, file: File, size?: ImageDimensions | null): Promise<ImageBitmap> => {
      const known = bitmaps.current.get(id);
      if (known) return Promise.resolve(known);
      const pending = decoding.current.get(id);
      if (pending) return pending;
      const options = size ? pictureBitmapOptions(size) : undefined;
      const decoded = (options ? createImageBitmap(file, options) : createImageBitmap(file)).then(
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
    },
    [],
  );

  /** A picture leaves the text: its upload goes, and it is kept a while in case it comes back. */
  const hold = useCallback(
    (image: ComposerImageAttachment) => {
      supersede(image.id);
      releaseAttachmentUpload(image.id);
      held.current.delete(image.id);
      held.current.set(image.id, image);
      for (const id of held.current.keys()) {
        if (held.current.size <= HELD_PICTURES) break;
        held.current.delete(id);
      }
    },
    [supersede],
  );

  const removePicture = useCallback(
    (id: string, options?: { readonly forGood?: boolean }) => {
      const target = targetOf(id);
      const images = imagesOf(target);
      const index = images.findIndex((image) => image.id === id);
      if (index < 0) return;
      if (options?.forGood) {
        supersede(id);
        releaseAttachmentUpload(id);
      } else {
        hold(images[index]!);
      }
      const shown = isOnScreen(target);
      const { promptRef, onPromptWritten } = latest.current;
      const removal = removeInlinePicturePlaceholder(
        shown ? promptRef.current : (draftOf(target)?.prompt ?? ""),
        index,
      );
      syncImages(
        target,
        images.filter((image) => image.id !== id).map((image) => image.id),
      );
      setPrompt(target, removal.prompt);
      if (!shown) return;
      promptRef.current = removal.prompt;
      onPromptWritten(
        removal.prompt,
        collapseExpandedComposerCursor(removal.prompt, removal.cursor),
      );
    },
    [hold, isOnScreen, setPrompt, supersede, syncImages, targetOf],
  );

  /** The picture goes as it is: nothing is making its copy any more. */
  const settleCopy = useCallback(
    (id: string) => {
      const image = imageOf(id);
      if (!image?.picture?.preparing) return;
      updateImage(targetOf(id), { ...image, picture: { ...image.picture, preparing: false } });
    },
    [imageOf, targetOf, updateImage],
  );

  /** Makes the picture's copy from its current edits; the latest edit wins. */
  const makeCopy = useCallback(
    async (id: string) => {
      const token = supersede(id);
      const image = imageOf(id);
      const picture = image?.picture;
      if (!image || !picture) return;
      const source = picture.source;
      // A reload dropped the pasted file: the copy it made is what goes.
      if (!source) {
        settleCopy(id);
        return;
      }
      let copy: Awaited<ReturnType<typeof fitPictureCopy<Blob>>>;
      try {
        const size = { width: picture.sourceWidth, height: picture.sourceHeight };
        const kept = bitmaps.current.get(id) ?? (await decode(id, source, size));
        // A picture kept smaller in the tab is copied from its crop, decoded
        // afresh at the copy's size and let go once the copy is made.
        const crop =
          kept.width < picture.sourceWidth ? await pictureCropBitmap(source, picture.crop) : null;
        try {
          copy = await fitPictureCopy({
            source: { type: source.type, bytes: source.size, ...size },
            crop: picture.crop,
            markCount: picture.marks.length,
            encode: pictureCanvasEncoder(
              crop
                ? {
                    image: crop,
                    imageScale: crop.width / picture.crop.w,
                    crop: { x: 0, y: 0, w: picture.crop.w, h: picture.crop.h },
                    marks: picture.marks.map((mark) => ({
                      ...mark,
                      x: mark.x - picture.crop.x,
                      y: mark.y - picture.crop.y,
                    })),
                  }
                : { image: kept, crop: picture.crop, marks: picture.marks },
            ),
          });
        } finally {
          crop?.close();
        }
      } catch {
        if (tokens.current.get(id) !== token) return;
        settleCopy(id);
        latest.current.onError(`'${source.name}' could not be prepared, so it goes as it was.`);
        return;
      }
      const now = imageOf(id);
      if (
        tokens.current.get(id) !== token ||
        !now?.picture ||
        pictureNeedsNewCopy(picture, now.picture)
      ) {
        return;
      }
      if (copy.kind === "too-large") {
        removePicture(id, { forGood: true });
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
      updateImage(targetOf(id), {
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
    [decode, imageOf, removePicture, settleCopy, supersede, targetOf, updateImage],
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

  const add = useCallback(
    async (files: ReadonlyArray<File>) => {
      const refusal = latest.current.refusal();
      if (refusal) {
        latest.current.onError(refusal);
        return;
      }
      // The pictures go to the draft they were added to, even when another
      // Mate is on screen by the time they are read.
      const target = latest.current.draftTarget;
      for (const file of files) {
        const { onError } = latest.current;
        const draft = draftOf(target);
        if (
          composerAttachmentCount(draft?.images ?? [], draft?.files ?? []) >=
          PROVIDER_SEND_TURN_MAX_ATTACHMENTS
        ) {
          onError(
            `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} pictures and files per message.`,
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
        owners.current.set(id, target);
        arriving.current.add(id);
        let bitmap: ImageBitmap;
        try {
          bitmap = await decode(id, source, prepared.size);
        } catch {
          arriving.current.delete(id);
          owners.current.delete(id);
          onError(`'${file.name}' could not be read as a picture.`);
          continue;
        }
        // Its own size, whatever size it is kept at.
        const size = prepared.size ?? { width: bitmap.width, height: bitmap.height };
        const crop = fullPictureCrop(size.width, size.height);
        const fitted = pictureFitSize(crop);
        const picture: ComposerPicture = {
          source,
          sourceWidth: size.width,
          sourceHeight: size.height,
          crop,
          marks: [],
          keepOriginal: false,
          width: fitted.width,
          height: fitted.height,
          asPasted: false,
          preparing: true,
        };
        drawThumbnail(id, picture);
        // On screen it lands at the caret; in a draft off screen, at its end.
        const shown = isOnScreen(target);
        const { editorRef, promptRef, onPromptWritten } = latest.current;
        const snapshot = shown ? editorRef.current?.readSnapshot() : undefined;
        const prompt =
          snapshot?.value ?? (shown ? promptRef.current : (draftOf(target)?.prompt ?? ""));
        const insertion = insertInlinePicturePlaceholder(
          prompt,
          snapshot?.expandedCursor ?? prompt.length,
        );
        insertImage(
          target,
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
        arriving.current.delete(id);
        if (shown) {
          promptRef.current = insertion.prompt;
          onPromptWritten(
            insertion.prompt,
            collapseExpandedComposerCursor(insertion.prompt, insertion.cursor),
          );
        }
        void makeCopy(id);
      }
    },
    [decode, drawThumbnail, insertImage, isOnScreen, makeCopy],
  );

  const edit = useCallback(
    (id: string, next: ComposerPicture) => {
      const image = imageOf(id);
      if (!image?.picture) return;
      const remake = pictureNeedsNewCopy(image.picture, next);
      updateImage(targetOf(id), {
        ...image,
        picture: { ...next, preparing: remake || image.picture.preparing },
      });
      if (!remake) return;
      drawThumbnail(id, next);
      scheduleCopy(id, REMAKE_DELAY_MS);
    },
    [drawThumbnail, imageOf, scheduleCopy, targetOf, updateImage],
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
      const picture = imageOf(id)?.picture;
      const size = picture ? { width: picture.sourceWidth, height: picture.sourceHeight } : null;
      void decode(id, source, size).then(
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

  // A picture on screen belongs to the draft on screen.
  useEffect(() => {
    for (const image of input.images) owners.current.set(image.id, input.draftTarget);
  }, [input.draftTarget, input.images]);

  // An image that reached the draft without being a picture (an older draft, a
  // stash, a queued message) becomes one: its file is what was pasted. One
  // too big to open goes as it came.
  useEffect(() => {
    const target = input.draftTarget;
    for (const image of input.images) {
      if (
        image.picture ||
        opening.current.has(image.id) ||
        unopenable.current.has(image.id) ||
        bitmaps.current.has(image.id)
      ) {
        continue;
      }
      const id = image.id;
      opening.current.add(id);
      void pictureSourceFile(image.file)
        .then(async (prepared) => {
          if (!prepared.ok) {
            unopenable.current.add(id);
            return;
          }
          const bitmap = await decode(id, prepared.file, prepared.size);
          const now = imagesOf(target).find((entry) => entry.id === id);
          if (!now || now.picture) return;
          const size = prepared.size ?? { width: bitmap.width, height: bitmap.height };
          const crop = fullPictureCrop(size.width, size.height);
          const fitted = pictureFitSize(crop);
          const picture: ComposerPicture = {
            source: prepared.file,
            sourceWidth: size.width,
            sourceHeight: size.height,
            crop,
            marks: [],
            keepOriginal: false,
            width: fitted.width,
            height: fitted.height,
            asPasted: false,
            preparing: true,
          };
          updateImage(target, { ...now, picture });
          void makeCopy(id);
        })
        .catch(() => {
          // Not something this browser can draw: it goes as it came.
        })
        .finally(() => opening.current.delete(id));
    }
  }, [decode, input.draftTarget, input.images, makeCopy, updateImage]);

  // What a picture held goes when it leaves its own draft, whichever draft is
  // on screen: another Mate's coming into view is no picture leaving.
  useEffect(() => {
    const forgetGone = () => {
      for (const [id, bitmap] of bitmaps.current) {
        if (arriving.current.has(id)) continue;
        if (imagesOf(targetOf(id)).some((image) => image.id === id)) continue;
        bitmap.close();
        bitmaps.current.delete(id);
        supersede(id);
        tokens.current.delete(id);
        owners.current.delete(id);
      }
    };
    forgetGone();
    return useComposerDraftStore.subscribe(forgetGone);
  }, [supersede, targetOf]);

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
      const target = latest.current.draftTarget;
      const images = imagesOf(target);
      const inDraft = new Set(images.map((image) => image.id));
      // A picture taken out comes back as it was, with a preview of its own.
      const returning = pictureIds.flatMap((id) => {
        const image = inDraft.has(id) ? undefined : held.current.get(id);
        return image ? [{ ...image, previewUrl: URL.createObjectURL(image.file) }] : [];
      });
      const known = new Set([...inDraft, ...returning.map((image) => image.id)]);
      // A picture has one place: a second place for it is a place without one.
      const placed = new Set<string>();
      const keeps = pictureIds.map((id) => {
        if (!known.has(id) || placed.has(id)) return false;
        placed.add(id);
        return true;
      });
      const kept = pictureIds.filter((_id, index) => keeps[index]);
      for (const image of images) {
        if (!placed.has(image.id)) hold(image);
      }
      for (const image of returning) {
        held.current.delete(image.id);
        owners.current.set(image.id, target);
      }
      syncImages(target, kept, returning);
      for (const image of returning) {
        if (image.picture?.preparing) void makeCopy(image.id);
      }
      if (keeps.every(Boolean)) return null;
      let healed = prompt;
      for (let index = pictureIds.length - 1; index >= 0; index -= 1) {
        if (!keeps[index]) healed = removeInlinePicturePlaceholder(healed, index).prompt;
      }
      return healed;
    },
    [hold, makeCopy, syncImages],
  );

  /**
   * A picture cut from the text comes back itself, once; one still in a draft
   * (a copy, or a second paste of a cut) comes as a picture of its own with
   * the same edits; one this composer never had cannot come. What comes waits
   * with the pictures taken out, for the text to hold it.
   */
  const paste = useCallback(
    (ids: ReadonlyArray<string>): ReadonlyArray<string | null> => {
      const back = new Set<string>();
      return ids.map((id) => {
        if (held.current.has(id) && !back.has(id)) {
          back.add(id);
          return id;
        }
        const image = held.current.get(id) ?? imageOf(id);
        if (!image) return null;
        const copyId = randomUUID();
        held.current.set(copyId, { ...image, id: copyId });
        setThumbnails((current) => {
          const thumbnail = current.get(id);
          return thumbnail === undefined ? current : new Map(current).set(copyId, thumbnail);
        });
        return copyId;
      });
    },
    [imageOf],
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
    paste,
    blockReason: input.images.some((image) => image.picture?.preparing)
      ? "Picture still preparing"
      : null,
    view,
  };
}
