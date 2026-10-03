/**
 * Pictures in the composer, every part side by side: the composer's text with
 * a picture where it was pasted, the open picture (click the picture, or
 * `?open=1`), the person's message as sent, and what the Mate receives, block
 * by block.
 *
 * Served by the dev server at `/design-pictures.html` (`?theme=dark` for the
 * dark theme, `?open=1` to open the picture, `?fit=1` to fit the 3210 × 2118
 * paste that failed and print what it became). The screenshot is drawn here, so
 * nothing is fetched; the shop and its words are invented.
 *
 * Fixtures only. Nothing here ships — `design-pictures.html` is not
 * `index.html`, and no route imports this module.
 */
import { interleavePictures, type PictureContentPart } from "@t3tools/shared/composerPictures";
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

import { EnvironmentId } from "@t3tools/contracts";

import { collapseExpandedComposerCursor } from "~/composer-logic";
import {
  DraftId,
  type ComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "~/composerDraftStore";
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditor";
import type { ComposerPictureView as ComposerPictureChip } from "~/components/chat/ComposerPicture";
import {
  ComposerPictureView,
  formatPictureBytes,
  pictureDims,
  pictureTypeName,
} from "~/components/chat/ComposerPictureView";
import { MessagePictureBody } from "~/components/chat/MessagePictures";
import { useComposerFiles } from "~/components/chat/useComposerFiles";
import { useComposerPictures } from "~/components/chat/useComposerPictures";
import { placeMessagePictures } from "~/components/chat/messagePictures.logic";
import {
  INLINE_PICTURE_PLACEHOLDER as P,
  fullPictureCrop,
  materializePicturePrompt,
  pictureThumbSize,
  type ComposerPicture,
  type PictureMark,
} from "~/lib/composerPictures";
import type { AttachmentUploadState } from "~/lib/attachmentUploadState";
import { composerAttachmentRoute, optimisticFileAttachments } from "~/lib/composerFiles";
import { fitPictureCopy, pictureCanvasEncoder } from "~/lib/imageCompression";
import { drawPictureComposite } from "~/lib/pictureDrawing";
import type { ChatAttachment } from "~/types";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const FONT = (weight: number, size: number) =>
  `${weight} ${size}px Roboto, -apple-system, "Segoe UI", sans-serif`;

// ---------------------------------------------------------------------------
// The invented screenshot: a bakery's home page, drawn at 2× like a retina capture.
// ---------------------------------------------------------------------------

type Context2D = CanvasRenderingContext2D;

function roundRect(context: Context2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

function loaf(context: Context2D, cx: number, cy: number, rx: number, ry: number) {
  const glaze = context.createRadialGradient(
    cx - rx * 0.3,
    cy - ry * 0.6,
    ry * 0.2,
    cx,
    cy,
    rx * 1.05,
  );
  glaze.addColorStop(0, "#dca060");
  glaze.addColorStop(0.55, "#a0632f");
  glaze.addColorStop(1, "#4f2d15");
  context.fillStyle = glaze;
  context.beginPath();
  context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(248,222,180,.6)";
  context.lineWidth = Math.max(1.5, rx * 0.035);
  context.lineCap = "round";
  for (let cut = -1; cut <= 1; cut += 1) {
    context.beginPath();
    context.ellipse(
      cx + cut * rx * 0.34,
      cy - ry * 0.12,
      rx * 0.2,
      ry * 0.52,
      -0.55,
      Math.PI * 1.15,
      Math.PI * 1.75,
    );
    context.stroke();
  }
}

/** Where the photos sit, for their grain. */
const photoRects: Array<readonly [number, number, number, number]> = [];

function photo(context: Context2D, x: number, y: number, w: number, h: number, loaves: number) {
  photoRects.push([x, y, w, h]);
  context.save();
  roundRect(context, x, y, w, h, 16);
  context.clip();
  const light = context.createLinearGradient(x, y, x + w * 0.6, y + h);
  light.addColorStop(0, "#ecd3ae");
  light.addColorStop(0.6, "#c08c58");
  light.addColorStop(1, "#6f4526");
  context.fillStyle = light;
  context.fillRect(x, y, w, h);
  context.fillStyle = "rgba(58,36,18,.26)";
  context.fillRect(x, y + h * 0.68, w, h * 0.32);
  for (let index = 0; index < loaves; index += 1) {
    const at = loaves === 1 ? 0.5 : 0.22 + (index * 0.56) / (loaves - 1);
    const rx = (w / (loaves + 1.2)) * 0.62;
    loaf(context, x + w * at, y + h * 0.62, rx, Math.min(h * 0.28, rx * 0.55));
  }
  context.restore();
}

function drawHome(context: Context2D, width: number, height: number) {
  const W = width / 2;
  context.save();
  context.scale(2, 2);
  context.textBaseline = "middle";
  context.fillStyle = "#fbf8f3";
  context.fillRect(0, 0, W, height / 2);
  context.fillStyle = "#2b2118";
  context.font = FONT(700, 19);
  context.fillText("linden", 40, 37);
  context.font = FONT(500, 15);
  context.fillStyle = "#4a3e33";
  ["Bread", "Pastry", "Workshops", "Visit us"].forEach((word, index) =>
    context.fillText(word, W * 0.4 + index * 104, 37),
  );
  roundRect(context, W - 160, 19, 120, 36, 18);
  context.fillStyle = "#2b2118";
  context.fill();
  context.fillStyle = "#fbf8f3";
  context.font = FONT(500, 14);
  context.fillText("Cart · 2", W - 131, 37);
  context.fillStyle = "#2b2118";
  context.font = FONT(700, 56);
  context.fillText("Bread that", 40, 196);
  context.fillText("takes its time.", 40, 258);
  context.fillStyle = "#76685b";
  context.font = FONT(400, 18);
  context.fillText("Sourdough, rye and seasonal loaves,", 40, 318);
  context.fillText("baked overnight and ready by seven.", 40, 344);
  roundRect(context, 40, 384, 214, 52, 26);
  context.fillStyle = "#d9772b";
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = FONT(600, 16);
  context.fillText("Order for Saturday", 64, 411);
  photo(context, W * 0.46, 104, W * 0.51, 424, 2);
  context.fillStyle = "#2b2118";
  context.font = FONT(700, 26);
  context.fillText("This week", 40, 712);
  [0, 1, 2].forEach((index) =>
    photo(context, 40 + index * (W / 3.1), 772, W / 3.4, 150, index + 1),
  );
  context.restore();
}

/** Grain in a region, as a real capture's photos carry. */
function grain(context: Context2D, x: number, y: number, w: number, h: number, amount: number) {
  const image = context.getImageData(x, y, w, h);
  let seed = 7;
  for (let index = 0; index < image.data.length; index += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296 - 0.5) * amount;
    image.data[index] = image.data[index]! + noise;
    image.data[index + 1] = image.data[index + 1]! + noise;
    image.data[index + 2] = image.data[index + 2]! + noise * 0.85;
  }
  context.putImageData(image, x, y);
}

/**
 * The screenshot: grain in its photos, as the prototype draws it, and with
 * `everywhere` some over the page too, to weigh as much as a busy capture.
 */
async function screenshot(width: number, height: number, everywhere: number, name: string) {
  await document.fonts.load(FONT(700, 16)).catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  photoRects.length = 0;
  drawHome(context, width, height);
  for (const [x, y, w, h] of photoRects) {
    grain(context, Math.round(x * 2), Math.round(y * 2), Math.round(w * 2), Math.round(h * 2), 18);
  }
  if (everywhere > 0) grain(context, 0, 0, width, height, everywhere);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob!], name, { type: "image/png" });
}

// ---------------------------------------------------------------------------
// The picture, made as the composer makes it.
// ---------------------------------------------------------------------------

const MARKS: ReadonlyArray<PictureMark> = [
  { kind: "pin", id: "m1", x: 252, y: 74, note: "The logo is too small next to the menu." },
  {
    kind: "box",
    id: "m2",
    x: 80,
    y: 1084,
    w: 2864,
    h: 236,
    note: "Too much space above the product grid.",
  },
];
const BEFORE = "The header on the home page feels off:";
const AFTER = "Can you fix both, and check the phone layout too?";

interface Made {
  readonly image: ComposerImageAttachment & { readonly picture: ComposerPicture };
  readonly thumbnail: string;
}

async function makeCopy(
  source: File,
  bitmap: ImageBitmap,
  picture: ComposerPicture,
): Promise<Made> {
  const copy = await fitPictureCopy({
    source: { type: source.type, bytes: source.size, width: bitmap.width, height: bitmap.height },
    crop: picture.crop,
    markCount: picture.marks.length,
    encode: pictureCanvasEncoder({ image: bitmap, crop: picture.crop, marks: picture.marks }),
  });
  if (copy.kind === "too-large") throw new Error("too large");
  const file =
    copy.kind === "as-pasted"
      ? source
      : new File([copy.blob], copy.type === "image/png" ? "home-page.png" : "home-page.jpg", {
          type: copy.type,
        });
  const size = pictureThumbSize(picture.crop);
  const canvas = document.createElement("canvas");
  canvas.width = size.width * 2;
  canvas.height = size.height * 2;
  drawPictureComposite(canvas.getContext("2d")!, {
    image: bitmap,
    crop: picture.crop,
    marks: picture.marks,
    width: canvas.width,
    height: canvas.height,
    mode: "cover",
    minRadius: 0,
  });
  return {
    thumbnail: canvas.toDataURL("image/png"),
    image: {
      type: "image",
      id: "picture-1",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
      picture: {
        ...picture,
        width: copy.kind === "as-pasted" ? bitmap.width : copy.width,
        height: copy.kind === "as-pasted" ? bitmap.height : copy.height,
        asPasted: copy.kind === "as-pasted",
        preparing: false,
      },
    },
  };
}

function State(props: {
  readonly label: string;
  readonly note: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-2" data-harness-state={props.label}>
      <div>
        <h2 className="font-medium text-foreground text-sm">{props.label}</h2>
        <p className="text-muted-foreground text-xs">{props.note}</p>
      </div>
      {props.children}
    </section>
  );
}

const LIVE_DRAFT = DraftId.make("harness-pictures");
const LIVE_ENVIRONMENT = EnvironmentId.make("harness-environment");

/**
 * The composer's own picture handling on the real draft store: paste a
 * picture (or `window.pastePicture()` it) and it lands at the caret, is fitted,
 * opens on click; the line under it is what goes when the message is sent.
 */
function LiveComposer() {
  const draft = useComposerThreadDraft(LIVE_DRAFT);
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const promptRef = useRef(draft.prompt);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Uploads as the harness plays them: a file is halfway at once and up a
  // moment later, or fails when asked to.
  const [uploads, setUploads] = useState<Record<string, AttachmentUploadState>>({});
  const files = useComposerFiles({
    draftTarget: LIVE_DRAFT,
    environmentId: LIVE_ENVIRONMENT,
    files: draft.files,
    uploadsByImageId: uploads,
    editorRef,
    promptRef,
    onPromptWritten: (_prompt, nextCursor) => setCursor(nextCursor),
    refusal: () => null,
    onError: setError,
  });
  const playUploads = useCallback((outcome: "ready" | "failed") => {
    const known = new Set(
      useComposerDraftStore
        .getState()
        .getComposerDraft(LIVE_DRAFT)
        ?.files.map((file) => file.id),
    );
    const settle = (status: "uploading" | "ready" | "failed") =>
      setUploads((current) => {
        const next = { ...current };
        for (const id of known) {
          if (current[id]?.status === "ready") continue;
          next[id] =
            status === "uploading"
              ? { status, environmentId: LIVE_ENVIRONMENT, progress: 0.42 }
              : status === "ready"
                ? { status, environmentId: LIVE_ENVIRONMENT, attachmentId: `att-${id}` }
                : { status, environmentId: LIVE_ENVIRONMENT, reason: "Upload failed" };
        }
        return next;
      });
    settle("uploading");
    window.setTimeout(() => settle(outcome), 1200);
  }, []);
  const pictures = useComposerPictures({
    draftTarget: LIVE_DRAFT,
    environmentId: LIVE_ENVIRONMENT,
    images: draft.images,
    supportsAttachmentUploads: false,
    uploadsByImageId: {},
    editorRef,
    promptRef,
    onPromptWritten: (_prompt, nextCursor) => setCursor(nextCursor),
    refusal: () => null,
    onError: setError,
  });
  useEffect(() => {
    (window as unknown as { pastePicture: () => Promise<void> }).pastePicture = async () => {
      const file = await screenshot(3024, 1964, 0, "home-page.png");
      await pictures.add([file]);
    };
    // `window.pasteFile("spec.pdf", 482000, "failed")`: a file that is not a picture.
    (
      window as unknown as {
        pasteFile: (name?: string, bytes?: number, outcome?: "ready" | "failed") => void;
      }
    ).pasteFile = (name = "quarterly-report-final-v2.pdf", bytes = 482_000, outcome = "ready") => {
      files.add([new File([new Uint8Array(bytes)], name)]);
      window.setTimeout(() => playUploads(outcome), 0);
    };
  }, [files, pictures, playUploads]);
  return (
    <div className="grid gap-3">
      <div className="rounded-3xl border border-border bg-card px-4 pt-4 pb-3 shadow-lg/5">
        <ComposerPromptEditor
          editorRef={editorRef}
          value={draft.prompt}
          cursor={cursor}
          terminalContexts={[]}
          skills={[]}
          pictures={pictures.chips}
          onOpenPicture={pictures.open}
          onRemovePicture={pictures.remove}
          onRetryPicture={pictures.retry}
          files={files.chips}
          onRemoveFile={files.remove}
          onRetryFile={() => playUploads("ready")}
          disabled={false}
          placeholder="Paste a picture or a file here…"
          onRemoveTerminalContext={() => undefined}
          onChange={(value, nextCursor, _expanded, _adjacent, _contexts, pictureIds, fileIds) => {
            const healed = pictures.sync(pictureIds, value);
            const next = files.sync(fileIds, healed ?? value) ?? healed ?? value;
            promptRef.current = next;
            setPrompt(LIVE_DRAFT, next);
            setCursor(nextCursor);
          }}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length === 0) return;
            event.preventDefault();
            const routes = pasted.map((file) => [file, composerAttachmentRoute(file)] as const);
            files.add(routes.flatMap(([file, route]) => (route.kind === "file" ? [file] : [])));
            void pictures.add(
              routes.flatMap(([file, route]) => (route.kind === "picture" ? [file] : [])),
            );
            window.setTimeout(() => playUploads("ready"), 0);
          }}
        />
      </div>
      <pre className="whitespace-pre-wrap font-mono text-muted-foreground text-xs" data-live-wire>
        {materializePicturePrompt(draft.prompt, draft.images, draft.files)}
      </pre>
      <LiveSent
        text={materializePicturePrompt(draft.prompt, draft.images, draft.files)}
        attachments={[...optimisticFileAttachments(draft.files), ...draft.images]}
      />
      <p className="text-muted-foreground text-xs" data-live-status>
        {error ?? pictures.blockReason ?? "Ready to send"}
      </p>
      {pictures.view}
    </div>
  );
}

/** The live draft as the conversation draws it once sent. */
function LiveSent(props: { readonly text: string; readonly attachments: ChatAttachment[] }) {
  const placed = placeMessagePictures(props.text, props.attachments);
  if (!placed) return null;
  return (
    <div className="flex justify-end" data-live-sent>
      <div className="relative max-w-4/5 rounded-2xl bg-message px-3.5 py-2.5 text-prose text-message-foreground">
        <MessagePictureBody
          segments={placed.segments}
          dimensions={new Map()}
          onOpen={() => undefined}
          renderText={(words) => <p className="whitespace-pre-wrap">{words.text}</p>}
        />
      </div>
    </div>
  );
}

function Wire(props: { readonly parts: ReadonlyArray<PictureContentPart>; readonly made: Made }) {
  return (
    <ol className="grid gap-0 rounded-2xl border border-border bg-card text-card-foreground">
      {props.parts.map((part) => (
        <li
          key={part.kind === "image" ? `image-${part.index}` : `text-${part.text}`}
          className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 border-border border-t px-3.5 py-2 first:border-t-0"
          data-wire-part={part.kind}
        >
          <span className="font-mono text-muted-foreground text-xs uppercase">{part.kind}</span>
          {part.kind === "text" ? (
            <pre className="whitespace-pre-wrap font-mono text-xs leading-5">{part.text}</pre>
          ) : (
            <span className="text-sm tabular-nums">
              Picture {part.index + 1} ·{" "}
              {pictureDims(props.made.image.picture.width, props.made.image.picture.height)} ·{" "}
              {pictureTypeName(props.made.image.mimeType)} ·{" "}
              {formatPictureBytes(props.made.image.sizeBytes)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Harness() {
  const [source, setSource] = useState<{ file: File; bitmap: ImageBitmap } | null>(null);
  const [picture, setPicture] = useState<ComposerPicture | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [open, setOpen] = useState(params.get("open") === "1");
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const [prompt, setPrompt] = useState(`${BEFORE}${P}${AFTER}`);

  useEffect(() => {
    void (async () => {
      const file = await screenshot(3024, 1964, 0, "home-page.png");
      const bitmap = await createImageBitmap(file);
      setSource({ file, bitmap });
      setPicture({
        source: file,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        crop: fullPictureCrop(bitmap.width, bitmap.height),
        marks: MARKS,
        keepOriginal: params.get("original") === "1",
        width: 0,
        height: 0,
        asPasted: false,
        preparing: true,
      });
    })();
  }, []);

  useEffect(() => {
    if (!source || !picture) return;
    let current = true;
    void makeCopy(source.file, source.bitmap, picture).then((next) => {
      if (current) setMade(next);
    });
    return () => {
      current = false;
    };
  }, [picture, source]);

  const chips = useMemo<ReadonlyArray<ComposerPictureChip>>(() => {
    if (!made) return [];
    const size = pictureThumbSize(made.image.picture.crop);
    return [
      {
        id: made.image.id,
        number: 1,
        name: "home-page.png",
        src: made.thumbnail,
        width: size.width,
        height: size.height,
        keepOriginal: made.image.picture.keepOriginal,
        preparing: false,
        failed: false,
      },
    ];
  }, [made]);

  const text = made ? materializePicturePrompt(prompt, [made.image]) : "";
  const attachments: ChatAttachment[] = made
    ? [
        made.image,
        ...(made.image.picture.keepOriginal && source
          ? [
              {
                type: "file" as const,
                id: "picture-1-original",
                name: source.file.name,
                mimeType: source.file.type,
                sizeBytes: source.file.size,
              },
            ]
          : []),
      ]
    : [];
  const placed = made ? placeMessagePictures(text, attachments) : null;
  const pathLines = made
    ? [
        '[Picture 1 is saved at: "/home/zerops/.t3/userdata/attachments/thread-1-8f2c.png"]',
        ...(made.image.picture.keepOriginal
          ? [
              '[Picture 1\'s original, "home-page.png", is saved at: "/home/zerops/.t3/userdata/attachments/thread-1-a91d.png"]',
            ]
          : []),
      ]
    : [];
  const wire = made ? interleavePictures(`${text}\n\n${pathLines.join("\n")}`, 1) : null;

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto grid w-full max-w-3xl gap-10">
        <State
          label="The composer"
          note="The picture sits where it was pasted, between the words, with its marks drawn in. Click it to open it."
        >
          <div className="rounded-3xl border border-border bg-card px-4 pt-4 pb-3 shadow-lg/5">
            {made ? (
              <ComposerPromptEditor
                editorRef={editorRef}
                value={prompt}
                cursor={collapseExpandedComposerCursor(prompt, prompt.length)}
                terminalContexts={[]}
                skills={[]}
                pictures={chips}
                onOpenPicture={() => setOpen(true)}
                onRemovePicture={() => setPrompt(prompt.replace(P, ""))}
                disabled={false}
                placeholder="Describe what you want to build or change…"
                onRemoveTerminalContext={() => undefined}
                onChange={(next) => setPrompt(next)}
                onPaste={() => undefined}
              />
            ) : (
              <p className="text-muted-foreground text-sm">Drawing the screenshot…</p>
            )}
          </div>
        </State>
        <State
          label="Paste here"
          note="The composer's own picture handling on the draft store: paste a picture where you are writing."
        >
          <LiveComposer />
        </State>
        <State
          label="The person's message"
          note="Each picture where it was put, its notes under it; the original's line when it went along."
        >
          <div className="flex justify-end">
            <div className="relative max-w-4/5 rounded-2xl bg-message px-3.5 py-2.5 text-prose text-message-foreground">
              {placed ? (
                <MessagePictureBody
                  segments={placed.segments}
                  dimensions={new Map()}
                  onOpen={() => setOpen(true)}
                  renderText={(words) => <p className="whitespace-pre-wrap">{words.text}</p>}
                />
              ) : null}
            </div>
          </div>
        </State>
        <State
          label="What the Mate receives"
          note="Block by block, as the Claude adapter sends it: the picture right after its label, and the text ending the message."
        >
          {wire && made ? <Wire parts={wire} made={made} /> : null}
        </State>
      </div>
      {open && made && source ? (
        <ComposerPictureView
          image={made.image}
          bitmap={source.bitmap}
          mateName="Nova"
          canKeepOriginal
          onChange={(next) => setPicture(next)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** `?fit=1`: the paste that failed, fitted as the composer fits it, with timings. */
async function fitReport() {
  const lines: string[] = [];
  const everywhere = Number(params.get("grain") ?? "6");
  for (const [width, height, amount] of [
    [3210, 2118, 0],
    [3210, 2118, everywhere],
  ] as const) {
    const started = performance.now();
    const file = await screenshot(width, height, amount, "paste.png");
    const bitmap = await createImageBitmap(file);
    const drawn = performance.now();
    const copy = await fitPictureCopy({
      source: { type: file.type, bytes: file.size, width, height },
      crop: fullPictureCrop(width, height),
      markCount: 0,
      encode: pictureCanvasEncoder({
        image: bitmap,
        crop: fullPictureCrop(width, height),
        marks: [],
      }),
    });
    const done = performance.now();
    lines.push(
      copy.kind === "fitted"
        ? `${width} × ${height} PNG, ${file.size} bytes (${formatPictureBytes(file.size)}) → ${copy.width} × ${copy.height} ${pictureTypeName(copy.type)}, ${copy.blob.size} bytes (${formatPictureBytes(copy.blob.size)}), base64 ${Math.ceil(copy.blob.size / 3) * 4} chars; fitted in ${Math.round(done - drawn)} ms (drawing the test image took ${Math.round(drawn - started)} ms)`
        : `${width} × ${height}: ${copy.kind}`,
    );
  }
  const pre = document.createElement("pre");
  pre.id = "fit-report";
  pre.textContent = lines.join("\n");
  document.body.prepend(pre);
}

// The app sets the theme on the document element (`themePalette.ts`), so the
// harness does the same.
const appearance = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
if (params.get("fit") === "1") void fitReport();
