/**
 * The open picture: the picture large on a dark stage, where a click pins a
 * numbered note and a drag boxes an area, C crops it to what matters, and the
 * bar says what the Mate receives — the copy's size and weight, and the
 * original when the person keeps it.
 *
 * It edits the picture's marks, crop and "keep original"; the composer makes
 * the copy again from them. After a reload the pasted file is gone, so the
 * copy is shown as it is: its notes still change, its marks and crop do not.
 */
import { CropIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { ComposerImageAttachment } from "~/composerDraftStore";
import {
  cropPictureMarks,
  fullPictureCrop,
  pictureMarkAt,
  type ComposerPicture,
  type PictureMark,
  type PicturePoint,
  type PictureRect,
} from "~/lib/composerPictures";
import { pictureFitSize } from "~/lib/imageCompression";
import { drawPictureMarks, pictureMarkMetrics } from "~/lib/pictureDrawing";
import { cn, randomUUID } from "~/lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogMediaPopup } from "../ui/dialog";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "~/lib/toasts";
import { Text } from "~/components/ui/text";

type Mode = "mark" | "crop";
type CropHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
type CropDrag = {
  readonly mode: CropHandle | "move" | "draw";
  readonly start: PicturePoint;
  readonly from: PictureRect;
};
type MarkDrag = {
  readonly start: PicturePoint;
  readonly x: number;
  readonly y: number;
  moved: boolean;
};

const CROP_HANDLES: ReadonlyArray<CropHandle> = ["nw", "ne", "sw", "se", "n", "s", "e", "w"];

/** The crop's handles: corner brackets and side bars, white on the picture, to drag. */
const CROP_HANDLE_CLASS_NAME: Record<CropHandle, string> = {
  nw: "-top-1 -left-1 size-5.5 cursor-nwse-resize before:inset-0 before:border-t-4 before:border-l-4",
  ne: "-top-1 -right-1 size-5.5 cursor-nesw-resize before:inset-0 before:border-t-4 before:border-r-4",
  sw: "-bottom-1 -left-1 size-5.5 cursor-nesw-resize before:inset-0 before:border-b-4 before:border-l-4",
  se: "-right-1 -bottom-1 size-5.5 cursor-nwse-resize before:inset-0 before:border-r-4 before:border-b-4",
  n: "-top-1.5 left-1/2 -ml-4 h-4 w-8 cursor-ns-resize before:inset-x-0 before:top-1.25 before:h-1 before:rounded-full before:bg-stage-foreground",
  s: "-bottom-1.5 left-1/2 -ml-4 h-4 w-8 cursor-ns-resize before:inset-x-0 before:bottom-1.25 before:h-1 before:rounded-full before:bg-stage-foreground",
  w: "top-1/2 -left-1.5 -mt-4 h-8 w-4 cursor-ew-resize before:inset-y-0 before:left-1.25 before:w-1 before:rounded-full before:bg-stage-foreground",
  e: "top-1/2 -right-1.5 -mt-4 h-8 w-4 cursor-ew-resize before:inset-y-0 before:right-1.25 before:w-1 before:rounded-full before:bg-stage-foreground",
};

/** A note's number in the notes' pink: by its pin, and beside its words in the sent message. */
export function PictureNoteNumber({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-4.5 flex-none rounded-full bg-annotation text-center text-caption leading-4.5 font-medium tabular-nums text-stage-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
/** Marks on screen never shrink under this radius, however small the picture. */
const VIEW_MIN_RADIUS = 11;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const rectBetween = (a: PicturePoint, b: PicturePoint): PictureRect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

export function formatPictureBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / 1_048_576;
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

const TYPE_NAMES: Readonly<Record<string, string>> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
};
export const pictureTypeName = (type: string): string =>
  TYPE_NAMES[type] ?? type.replace("image/", "").toUpperCase();
export const pictureDims = (width: number, height: number): string =>
  `${Math.round(width)} × ${Math.round(height)}`;

export interface ComposerPictureViewProps {
  readonly image: ComposerImageAttachment & { readonly picture: ComposerPicture };
  /** The pasted file, decoded; null once a reload dropped it. */
  readonly bitmap: ImageBitmap | null;
  readonly mateName: string;
  /** Whether the untouched file can travel too (it needs uploads). */
  readonly canKeepOriginal: boolean;
  readonly onChange: (picture: ComposerPicture) => void;
  readonly onClose: () => void;
}

export function ComposerPictureView(props: ComposerPictureViewProps) {
  const { image, bitmap } = props;
  const picture = image.picture;
  const editable = bitmap !== null;
  const [mode, setMode] = useState<Mode>("mark");
  const [selected, setSelected] = useState(-1);
  const [noteFor, setNoteFor] = useState(-1);
  const [noteDraft, setNoteDraft] = useState("");
  const [pendingBox, setPendingBox] = useState<PictureRect | null>(null);
  const [cropDraft, setCropDraft] = useState<PictureRect>(picture.crop);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [copyImage, setCopyImage] = useState<HTMLImageElement | null>(null);
  const [hoverMark, setHoverMark] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The stage as it mounts: the dialog draws its popup a beat after the view, so it is measured
  // once it is there rather than on the view's first commit.
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const noteTextRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());
  const markDragRef = useRef<MarkDrag | null>(null);
  const cropDragRef = useRef<CropDrag | null>(null);
  const undoRef = useRef<ComposerPicture[]>([]);
  const redoRef = useRef<ComposerPicture[]>([]);

  // What the view draws from: the pasted file, or after a reload the copy.
  useEffect(() => {
    if (bitmap) return;
    const element = new Image();
    element.addEventListener("load", () => setCopyImage(element), { once: true });
    element.src = image.previewUrl;
  }, [bitmap, image.previewUrl]);

  const sourceSize = bitmap
    ? { w: picture.sourceWidth, h: picture.sourceHeight }
    : { w: picture.width, h: picture.height };
  const sourceWidth = picture.sourceWidth;
  // In crop mode the whole picture shows; otherwise the crop does. After a
  // reload the copy is already the crop.
  const view: PictureRect =
    mode === "crop"
      ? fullPictureCrop(sourceSize.w, sourceSize.h)
      : bitmap
        ? picture.crop
        : fullPictureCrop(picture.width, picture.height);
  // Copy space to source space, for marks drawn after a reload.
  const toCopy = bitmap ? 1 : picture.width / picture.crop.w;

  const layout = (() => {
    if (!stage) return null;
    const padX = stage.width < 600 ? 12 : 36;
    const available = {
      w: Math.max(60, stage.width - padX * 2),
      h: Math.max(60, stage.height - 36),
    };
    const aspect = view.w / view.h;
    const width = Math.max(1, Math.round(Math.min(available.w, available.h * aspect, view.w * 2)));
    const height = Math.max(1, Math.round(width / aspect));
    return { width, height, scale: width / view.w };
  })();

  const marks = picture.marks;
  const length = layout ? Math.max(picture.crop.w, picture.crop.h) * toCopy * layout.scale : 0;
  const metrics = pictureMarkMetrics(length, VIEW_MIN_RADIUS);

  /**
   * A mark's anchor on the frame, in screen pixels. Marks are kept in the
   * pasted file's pixels; after a reload the frame shows the copy, which
   * starts at the crop and is scaled by `toCopy`.
   */
  const anchorOf = (mark: PictureMark) => {
    const scale = layout?.scale ?? 1;
    return bitmap
      ? { x: (mark.x - view.x) * scale, y: (mark.y - view.y) * scale }
      : {
          x: (mark.x - picture.crop.x) * toCopy * scale,
          y: (mark.y - picture.crop.y) * toCopy * scale,
        };
  };

  // The stage's size decides the frame's.
  useLayoutEffect(() => {
    const element = stageNode;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setStage((current) =>
        current && current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageNode]);

  const frameWidth = layout?.width ?? 0;
  const frameHeight = layout?.height ?? 0;
  const frameScale = layout?.scale ?? 1;

  // The picture itself, redrawn when the frame or what it shows changes.
  useLayoutEffect(() => {
    const canvas = baseRef.current;
    const source = bitmap ?? copyImage;
    if (!canvas || frameWidth === 0 || !source) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(frameWidth * ratio);
    canvas.height = Math.round(frameHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // A big picture is kept smaller in the tab: its pixels per pasted pixel.
    const scale = bitmap ? bitmap.width / sourceWidth : 1;
    context.drawImage(
      source,
      view.x * scale,
      view.y * scale,
      view.w * scale,
      view.h * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [bitmap, copyImage, frameHeight, frameWidth, sourceWidth, view.h, view.w, view.x, view.y]);

  // The marks and, while cropping, the dimmed outside of the crop.
  useLayoutEffect(() => {
    const canvas = marksRef.current;
    if (!canvas || frameWidth === 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(frameWidth * ratio);
    canvas.height = Math.round(frameHeight * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    // After a reload the marks are already in the copy's pixels.
    if (bitmap) {
      drawPictureMarks(context, marks, {
        origin: { x: view.x, y: view.y },
        scale: frameScale,
        length,
        minRadius: VIEW_MIN_RADIUS,
        ...(mode === "mark" ? { selected, pending: pendingBox } : {}),
      });
    }
    if (mode !== "crop") return;
    const x = (cropDraft.x - view.x) * frameScale;
    const y = (cropDraft.y - view.y) * frameScale;
    const w = cropDraft.w * frameScale;
    const h = cropDraft.h * frameScale;
    context.save();
    context.fillStyle = "rgba(8,9,11,.62)";
    context.beginPath();
    context.rect(0, 0, frameWidth, frameHeight);
    context.rect(x, y, w, h);
    context.fill("evenodd");
    context.strokeStyle = "rgba(255,255,255,.3)";
    context.lineWidth = 1;
    context.beginPath();
    for (const third of [1, 2]) {
      context.moveTo(x + (w * third) / 3, y);
      context.lineTo(x + (w * third) / 3, y + h);
      context.moveTo(x, y + (h * third) / 3);
      context.lineTo(x + w, y + (h * third) / 3);
    }
    context.stroke();
    context.restore();
  }, [
    bitmap,
    cropDraft,
    frameHeight,
    frameScale,
    frameWidth,
    length,
    marks,
    mode,
    pendingBox,
    selected,
    view.x,
    view.y,
  ]);

  // Each note sits beside its mark, on the side with room.
  useLayoutEffect(() => {
    if (!layout) return;
    for (const [index, chip] of chipRefs.current) {
      const mark = marks[index];
      if (!mark) continue;
      const anchor = anchorOf(mark);
      let x = anchor.x + metrics.radius + 8;
      if (x + chip.offsetWidth > layout.width + 24)
        x = anchor.x - metrics.radius - 8 - chip.offsetWidth;
      chip.style.left = `${x}px`;
      chip.style.top = `${clamp(anchor.y - chip.offsetHeight / 2, -12, layout.height - chip.offsetHeight + 12)}px`;
    }
  });

  // The note being written sits beside its mark, inside the stage.
  useLayoutEffect(() => {
    const note = noteRef.current;
    const mark = marks[noteFor];
    const frame = frameRef.current;
    const stageElement = stageRef.current;
    if (!note || !mark || !frame || !stageElement || !layout) return;
    const frameRect = frame.getBoundingClientRect();
    const stageRect = stageElement.getBoundingClientRect();
    const anchor = anchorOf(mark);
    const offset = { x: frameRect.left - stageRect.left, y: frameRect.top - stageRect.top };
    let x = offset.x + anchor.x + metrics.radius + 12;
    if (x + note.offsetWidth > stageRect.width - 8)
      x = offset.x + anchor.x - metrics.radius - 12 - note.offsetWidth;
    note.style.left = `${clamp(x, 8, Math.max(8, stageRect.width - note.offsetWidth - 8))}px`;
    note.style.top = `${clamp(offset.y + anchor.y - 22, 8, Math.max(8, stageRect.height - note.offsetHeight - 8))}px`;
  });

  const change = (next: Partial<ComposerPicture>) => {
    undoRef.current.push(picture);
    redoRef.current = [];
    props.onChange({ ...picture, ...next });
  };

  const commitNote = () => {
    if (noteFor < 0) return;
    const mark = marks[noteFor];
    const text = noteDraft.trim();
    if (mark && text !== mark.note) {
      change({
        marks: marks.map((entry, index) => (index === noteFor ? { ...entry, note: text } : entry)),
      });
    }
    setNoteFor(-1);
  };

  const openNote = (index: number) => {
    setSelected(index);
    setNoteFor(index);
    setNoteDraft(marks[index]?.note ?? "");
    requestAnimationFrame(() => noteTextRef.current?.focus({ preventScroll: true }));
  };

  const removeMark = (index: number) => {
    if (!editable || index < 0 || index >= marks.length) return;
    change({ marks: marks.filter((_, entry) => entry !== index) });
    setNoteFor(-1);
    setSelected(-1);
    doneRef.current?.focus({ preventScroll: true });
  };

  const applyCrop = () => {
    const next = {
      x: Math.round(cropDraft.x),
      y: Math.round(cropDraft.y),
      w: Math.round(cropDraft.w),
      h: Math.round(cropDraft.h),
    };
    const current = picture.crop;
    if (
      next.x === current.x &&
      next.y === current.y &&
      next.w === current.w &&
      next.h === current.h
    )
      return;
    const cropped = cropPictureMarks(marks, next);
    change({ crop: next, marks: cropped.marks });
    if (cropped.removed > 0) {
      toastManager.add({
        type: "info",
        title:
          cropped.removed === 1
            ? "A note outside the crop was removed."
            : `${cropped.removed} notes outside the crop were removed.`,
      });
    }
  };

  const enterCrop = () => {
    if (!editable) return;
    commitNote();
    setSelected(-1);
    setCropDraft(picture.crop);
    setMode("crop");
  };

  const leaveCrop = (apply: boolean) => {
    if (apply) applyCrop();
    setMode("mark");
  };

  const close = () => {
    commitNote();
    if (mode === "crop") applyCrop();
    props.onClose();
  };

  const toSource = (event: { clientX: number; clientY: number }): PicturePoint => {
    const frame = frameRef.current?.getBoundingClientRect();
    const scale = layout?.scale ?? 1;
    return {
      x: view.x + (event.clientX - (frame?.left ?? 0)) / scale,
      y: view.y + (event.clientY - (frame?.top ?? 0)) / scale,
    };
  };
  const clampToView = (point: PicturePoint): PicturePoint => ({
    x: clamp(point.x, view.x, view.x + view.w),
    y: clamp(point.y, view.y, view.y + view.h),
  });
  const markAt = (point: PicturePoint) =>
    pictureMarkAt(bitmap ? marks : [], point, {
      pinRadius: (metrics.radius + 4) / (layout?.scale ?? 1),
      edge: 7 / (layout?.scale ?? 1),
    });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !layout || !editable) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-picture-chip]")) return;
    event.preventDefault();
    frameRef.current?.setPointerCapture(event.pointerId);
    const point = clampToView(toSource(event));
    if (mode === "crop") {
      const handle = target.dataset.handle as CropHandle | undefined;
      cropDragRef.current = {
        mode: handle ?? (target.classList.contains("picture-crop") ? "move" : "draw"),
        start: point,
        from: cropDraft,
      };
      return;
    }
    commitNote();
    const hit = markAt(toSource(event));
    if (hit >= 0) {
      openNote(hit);
      return;
    }
    setSelected(-1);
    markDragRef.current = { start: point, x: event.clientX, y: event.clientY, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layout || !editable) return;
    if (mode === "crop") {
      const drag = cropDragRef.current;
      if (!drag) return;
      const point = clampToView(toSource(event));
      const limit = Math.max(16, 24 / layout.scale);
      const { from } = drag;
      if (drag.mode === "move") {
        setCropDraft({
          ...from,
          x: clamp(from.x + point.x - drag.start.x, 0, sourceSize.w - from.w),
          y: clamp(from.y + point.y - drag.start.y, 0, sourceSize.h - from.h),
        });
      } else if (drag.mode === "draw") {
        const rect = rectBetween(drag.start, point);
        if (rect.w >= limit && rect.h >= limit) setCropDraft(rect);
      } else {
        let [x1, y1, x2, y2] = [from.x, from.y, from.x + from.w, from.y + from.h];
        if (drag.mode.includes("w")) x1 = clamp(point.x, 0, x2 - limit);
        if (drag.mode.includes("e")) x2 = clamp(point.x, x1 + limit, sourceSize.w);
        if (drag.mode.includes("n")) y1 = clamp(point.y, 0, y2 - limit);
        if (drag.mode.includes("s")) y2 = clamp(point.y, y1 + limit, sourceSize.h);
        setCropDraft({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      }
      return;
    }
    const drag = markDragRef.current;
    if (!drag) {
      setHoverMark(markAt(toSource(event)) >= 0);
      return;
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5)
      drag.moved = true;
    if (drag.moved) setPendingBox(rectBetween(drag.start, clampToView(toSource(event))));
  };

  const onPointerUp = () => {
    if (mode === "crop") {
      cropDragRef.current = null;
      return;
    }
    const drag = markDragRef.current;
    const box = pendingBox;
    markDragRef.current = null;
    setPendingBox(null);
    if (!drag || !layout) return;
    const id = randomUUID();
    const mark: PictureMark =
      drag.moved && box && box.w * layout.scale >= 10 && box.h * layout.scale >= 10
        ? { kind: "box", id, ...box, note: "" }
        : { kind: "pin", id, x: drag.start.x, y: drag.start.y, note: "" };
    change({ marks: [...marks, mark] });
    openNote(marks.length);
  };

  const onPointerCancel = () => {
    markDragRef.current = null;
    cropDragRef.current = null;
    setPendingBox(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (noteFor >= 0) {
        commitNote();
        doneRef.current?.focus({ preventScroll: true });
      } else if (mode === "crop") leaveCrop(false);
      else close();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(
        rootRef.current?.querySelectorAll<HTMLElement>("button, [role=switch], textarea") ?? [],
      ).filter((element) => element.offsetParent !== null && !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const next = event.shiftKey
        ? index <= 0
          ? focusable.length - 1
          : index - 1
        : index === focusable.length - 1
          ? 0
          : index + 1;
      focusable[next]?.focus();
      return;
    }
    if (event.target === noteTextRef.current) return;
    if (editable && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      const from = event.shiftKey ? redoRef.current : undoRef.current;
      const to = event.shiftKey ? undoRef.current : redoRef.current;
      const previous = from.pop();
      if (previous) {
        to.push(picture);
        props.onChange(previous);
        setMode("mark");
        setSelected(-1);
        setPendingBox(null);
      }
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && selected >= 0 && mode === "mark") {
      event.preventDefault();
      removeMark(selected);
      return;
    }
    const onControl = (event.target as HTMLElement).closest("button, [role=switch]");
    if (event.key === "Enter" && mode === "crop" && !onControl) {
      event.preventDefault();
      leaveCrop(true);
      return;
    }
    if (
      (event.key === "c" || event.key === "C") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (mode === "crop") leaveCrop(true);
      else enterCrop();
    }
  };

  const cropping = mode === "crop";
  const shownCrop = cropping ? cropDraft : picture.crop;
  const ready = !cropping && !picture.preparing;
  const sends = ready
    ? { width: picture.width, height: picture.height }
    : pictureFitSize(shownCrop);
  const tail = ready
    ? picture.asPasted
      ? ` · as pasted, ${formatPictureBytes(image.sizeBytes)}`
      : ` · ${pictureTypeName(image.mimeType)}, ${formatPictureBytes(image.sizeBytes)}`
    : cropping
      ? ""
      : " · preparing…";
  const source = picture.source;

  return (
    <Dialog
      onOpenChange={(open, details) => {
        // Escape is the view's own, a layer at a time (a note, the crop, then the view).
        if (!open && details.reason !== "escape-key") close();
      }}
      open
    >
      <DialogMediaPopup
        aria-label={`Picture: ${source?.name ?? image.name}`}
        initialFocus={doneRef}
      >
        {/* The picture's stage, filling the kit's media dialog: its head, the picture with its
            marks and notes, and the bar that says what goes. */}
        <div
          ref={rootRef}
          className="flex size-full flex-col bg-stage font-sans text-stage-foreground"
          onKeyDown={onKeyDown}
        >
          <div className="flex h-12 min-w-0 flex-none items-center gap-2.5 ps-4 pe-2">
            <span className="min-w-0 truncate text-body font-medium">
              {source?.name ?? image.name}
            </span>
            <span className="whitespace-nowrap text-line tabular-nums text-stage-foreground/62">
              {source
                ? `${pictureDims(picture.sourceWidth, picture.sourceHeight)} · ${formatPictureBytes(source.size)}`
                : pictureDims(picture.width, picture.height)}
            </span>
            <Button
              variant="scrim"
              size="icon-md"
              className="ms-auto"
              aria-label="Close picture"
              onClick={close}
            >
              <XIcon aria-hidden="true" className="size-4.5" />
            </Button>
          </div>
          <div
            ref={(node) => {
              stageRef.current = node;
              setStageNode(node);
            }}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          >
            {layout ? (
              <div
                ref={frameRef}
                // The picture drawn on two canvases (it, then its marks), centred in the room left.
                className="relative flex-none touch-none shadow-popup data-editable:cursor-crosshair data-over-mark:cursor-pointer"
                data-mode={mode}
                data-editable={editable ? "true" : undefined}
                data-over-mark={hoverMark ? "true" : undefined}
                style={{ width: layout.width, height: layout.height }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                <canvas ref={baseRef} className="absolute inset-0 block size-full" />
                <canvas ref={marksRef} className="absolute inset-0 block size-full" />
                {mode === "mark"
                  ? marks.map((mark, index) =>
                      index === noteFor || mark.note.length === 0 ? null : (
                        <Button
                          key={mark.id}
                          ref={(element) => {
                            if (element) chipRefs.current.set(index, element);
                            else chipRefs.current.delete(index);
                          }}
                          variant="bare"
                          className="group/chip absolute max-w-55"
                          data-picture-chip=""
                          data-selected={index === selected ? "true" : undefined}
                          aria-label={`Note ${index + 1}: ${mark.note}. Edit it`}
                          onClick={() => {
                            commitNote();
                            openNote(index);
                          }}
                        >
                          {/* A note's words beside its pin, two lines at most. */}
                          <span className="line-clamp-2 cursor-pointer whitespace-normal rounded-control bg-popover px-2.25 py-1.25 text-left text-body text-popover-foreground shadow-popup ring-1 ring-border group-hover/chip:ring-2 group-hover/chip:ring-annotation group-data-selected/chip:ring-2 group-data-selected/chip:ring-annotation">
                            {mark.note}
                          </span>
                        </Button>
                      ),
                    )
                  : null}
                {cropping ? (
                  <div
                    className="absolute z-4 cursor-move touch-none outline-2 outline-stage-foreground/95"
                    style={{
                      left: (cropDraft.x - view.x) * layout.scale,
                      top: (cropDraft.y - view.y) * layout.scale,
                      width: cropDraft.w * layout.scale,
                      height: cropDraft.h * layout.scale,
                    }}
                  >
                    {CROP_HANDLES.map((handle) => (
                      <span
                        key={handle}
                        className={cn(
                          "absolute touch-none before:pointer-events-none before:absolute before:border-stage-foreground",
                          CROP_HANDLE_CLASS_NAME[handle],
                        )}
                        data-handle={handle}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {noteFor >= 0 ? (
              // A note being written: a small popover by its pin.
              <div
                ref={noteRef}
                className="absolute z-6 w-62.5 rounded-card border border-border bg-popover px-2.5 pt-2.5 pb-2 text-popover-foreground shadow-popup"
              >
                <div className="mb-1.5 flex items-center gap-2 text-caption leading-4.5 font-medium text-muted-foreground">
                  <PictureNoteNumber>{noteFor + 1}</PictureNoteNumber>
                  <span>Note</span>
                </div>
                <Textarea
                  ref={noteTextRef}
                  unstyled
                  size="sm"
                  rows={2}
                  value={noteDraft}
                  placeholder="What should change here?"
                  aria-label="Note text"
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      commitNote();
                      doneRef.current?.focus({ preventScroll: true });
                    }
                  }}
                />
                <Text
                  className="mt-1.5 flex items-center justify-between gap-2"
                  render={<div />}
                  variant="label"
                >
                  <span>↵ to save, empty is fine</span>
                  {editable ? (
                    <Button
                      variant="destructive-ghost"
                      size="xs"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => removeMark(noteFor)}
                    >
                      <Trash2Icon aria-hidden="true" />
                      Remove
                    </Button>
                  ) : null}
                </Text>
              </div>
            ) : null}
          </div>
          <div className="flex flex-none justify-center px-3 pt-2.5 pb-3.5">
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-card border border-border bg-popover p-1.5 text-popover-foreground shadow-popup">
              {editable ? (
                <>
                  <Button
                    variant="ghost"
                    aria-pressed={cropping}
                    data-pressed={cropping || undefined}
                    onClick={() => (cropping ? leaveCrop(true) : enterCrop())}
                  >
                    <CropIcon aria-hidden="true" />
                    Crop
                  </Button>
                  <Separator className="mx-1 h-5" orientation="vertical" />
                </>
              ) : null}
              {cropping ? (
                <span className="inline-flex items-center gap-1.5 ps-1.5 whitespace-nowrap text-line tabular-nums text-muted-foreground">
                  <span>{pictureDims(cropDraft.w, cropDraft.h)}</span>
                  <Button
                    variant="ghost-muted"
                    size="xs"
                    onClick={() => setCropDraft(fullPictureCrop(sourceSize.w, sourceSize.h))}
                  >
                    Reset
                  </Button>
                </span>
              ) : (
                <span className="px-1.5 whitespace-nowrap text-line tabular-nums text-muted-foreground max-[47.5rem]:hidden">
                  {editable
                    ? "Click to pin a note, drag to box an area"
                    : "Its marks and crop stay as they were before the reload"}
                </span>
              )}
              <Separator className="mx-1 h-5" orientation="vertical" />
              <span
                className="min-w-59 px-1.5 whitespace-nowrap text-line tabular-nums text-muted-foreground max-[47.5rem]:min-w-0 [&_b]:font-medium [&_b]:text-popover-foreground"
                aria-live="polite"
              >
                Sends <b>{pictureDims(sends.width, sends.height)}</b>
                {tail}
                {picture.keepOriginal && source ? (
                  <span className="font-medium text-popover-foreground">
                    {" "}
                    + original {formatPictureBytes(source.size)}
                  </span>
                ) : null}
              </span>
              {props.canKeepOriginal && source ? (
                <span className="flex h-8 items-center whitespace-nowrap px-2">
                  <Label>
                    <Switch
                      checked={picture.keepOriginal}
                      onCheckedChange={(checked) => change({ keepOriginal: checked })}
                      aria-describedby="picture-keep-why"
                    />
                    <span>Keep original</span>
                    <span id="picture-keep-why" className="sr-only">
                      {`${props.mateName} still looks at the fitted copy. The untouched file is saved next to it for ${props.mateName} to use.`}
                    </span>
                  </Label>
                </span>
              ) : null}
              <Button ref={doneRef} onClick={close}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </DialogMediaPopup>
    </Dialog>
  );
}
