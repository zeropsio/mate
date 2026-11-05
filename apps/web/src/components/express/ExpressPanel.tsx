/**
 * The panel's Adobe Express: start a design, edit a picture or make one from words, or continue a
 * design a conversation's link named. What the person saves lands in their message as a picture
 * the agent can look at; what the conversation holds of Express is listed to open again.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import { ImagePlusIcon, LayoutTemplateIcon, PencilIcon, SparklesIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";

import { useMateImage } from "~/assets/MateImages";
import { Failure } from "../ui/failure";
import type { ExpressHistoryEntry } from "./expressHistory.logic";
import { ExpressMark } from "./ExpressMark";
import { type ExpressOpenRequest, useExpressOpen } from "./expressOpen";
import {
  EXPRESS_EXPORTS,
  type ExpressCallbacks,
  expressAssetFile,
  expressClientId,
  loadExpress,
  resetExpress,
} from "./expressSdk";

type Stage =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "open" }
  | { readonly kind: "failed"; readonly details: string };

type SavedPicture = Extract<ExpressHistoryEntry, { readonly kind: "picture" }>;

/** How much of the history the panel shows; older entries stay in the conversation. */
const HISTORY_SHOWN = 12;
/** A history tile's picture: about 190 px at twice the pixels. */
const TILE_PICTURE = { width: 384, height: 384 } as const;

export function ExpressPanel({
  mate,
  environmentId,
  history,
  onAttach,
  onEditingChange,
}: {
  /** The Mate's name, for the line saying where a saved design goes. */
  readonly mate: string | undefined;
  /** The Mate the conversation's pictures are read from. */
  readonly environmentId: EnvironmentId | null;
  /** What the conversation holds of Express, newest first (`expressHistoryOf`). */
  readonly history: ReadonlyArray<ExpressHistoryEntry>;
  readonly onAttach: (files: File[]) => void;
  /** Adobe's editor opened or closed: it is a desktop tool, and the host gives it room while open. */
  readonly onEditingChange?: (editing: boolean) => void;
}) {
  const containerId = `express-${useId().replaceAll(":", "")}`;
  const pictureInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  // A saved picture with no design to return to opens again from its file, read when asked.
  const [reopening, setReopening] = useState<SavedPicture | null>(null);
  const pending = useExpressOpen((state) => state.pending);
  const clientId = expressClientId ?? "";

  const callbacks: ExpressCallbacks = {
    onPublish: (_intent, params) => {
      setStage({ kind: "idle" });
      const file = expressAssetFile(params);
      if (file !== null) onAttach([file]);
    },
    onCancel: () => setStage({ kind: "idle" }),
    onError: (error) => setStage({ kind: "failed", details: String(error) }),
  };
  // `fill` mounts Adobe's frame into the panel edge to edge, with no backdrop or frame of its own.
  const container = { mode: "fill", parentElementId: containerId } as const;

  const launch = async (open: (sdk: Awaited<ReturnType<typeof loadExpress>>) => void) => {
    const replacing = stage.kind === "open" || stage.kind === "opening";
    setStage({ kind: "opening" });
    try {
      if (replacing) await resetExpress();
      open(await loadExpress(clientId));
      setStage({ kind: "open" });
    } catch (error) {
      setStage({ kind: "failed", details: String(error) });
    }
  };

  const newDesign = () =>
    void launch((sdk) => sdk.editor.create({}, { callbacks }, EXPRESS_EXPORTS, container));
  const editAgain = (projectId: string) =>
    void launch((sdk) =>
      sdk.editor.edit({ documentId: projectId }, { callbacks }, EXPRESS_EXPORTS, container),
    );
  const fromWords = () =>
    void launch((sdk) =>
      sdk.module.createImageFromText({ appVersion: "2", callbacks }, EXPRESS_EXPORTS, container),
    );
  const editPicture = (file: Blob) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const data = String(reader.result);
      void launch((sdk) =>
        sdk.module.editImage(
          { asset: { type: "image", dataType: "base64", data } },
          { appVersion: "2", callbacks },
          EXPRESS_EXPORTS,
          container,
        ),
      );
    });
    reader.readAsDataURL(file);
  };
  // What the conversation asked for (a design its link named, a picture to edit) opens here once,
  // whether the tab was open or opened for it.
  const openNamed = useEffectEvent((request: ExpressOpenRequest & { readonly id: number }) => {
    useExpressOpen.getState().take(request.id);
    if (request.kind === "design") editAgain(request.documentId);
    else editPicture(request.picture);
  });
  useEffect(() => {
    if (pending !== null) openNamed(pending);
  }, [pending]);
  const editing = stage.kind === "open" || stage.kind === "opening";
  const reportEditing = useEffectEvent((value: boolean) => onEditingChange?.(value));
  useEffect(() => {
    if (!editing) return;
    reportEditing(true);
    return () => reportEditing(false);
  }, [editing]);

  if (expressClientId === null) return null;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-express-panel={stage.kind}>
      {/* Adobe's frame lands here; it stays mounted so a flow never loses its parent. */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden [&>*]:absolute [&>*]:inset-0"
        hidden={!editing}
        id={containerId}
      />
      {editing ? null : (
        <div className="@container flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-5 pb-4">
          <header className="flex items-center gap-3">
            <ExpressMark className="size-10 shrink-0 rounded-lg shadow-xs/10" />
            <div className="flex min-w-0 flex-col">
              <h2 className="text-base font-semibold leading-6">Adobe Express</h2>
              <p className="text-muted-foreground text-sm leading-5">
                {`Design here; what you save goes into your message to ${mate ?? "this Mate"}.`}
              </p>
            </div>
          </header>

          {stage.kind === "failed" ? (
            <Failure cause="Adobe Express could not open." details={stage.details} />
          ) : null}

          <div className="grid grid-cols-1 gap-2 @lg:grid-cols-3">
            <ExpressTile
              icon={<LayoutTemplateIcon />}
              line="Start from a blank canvas or one of Adobe's templates."
              onClick={newDesign}
              title="New design"
            />
            <ExpressTile
              icon={<ImagePlusIcon />}
              line="Crop it, remove the background, add text."
              onClick={() => pictureInput.current?.click()}
              title="Edit a picture"
            />
            <ExpressTile
              icon={<SparklesIcon />}
              line="Describe it and Adobe Firefly draws it."
              onClick={fromWords}
              title="Picture from words"
            />
          </div>
          <input
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) editPicture(file);
            }}
            ref={pictureInput}
            type="file"
          />

          {history.length === 0 ? null : (
            <section className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-medium">In this conversation</h3>
              <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
                {history
                  .slice(0, HISTORY_SHOWN)
                  .map((entry) =>
                    entry.kind === "design" ? (
                      <LinkedDesign
                        entry={entry}
                        key={entry.key}
                        onOpen={() => editAgain(entry.documentId)}
                      />
                    ) : (
                      <SavedDesign
                        entry={entry}
                        environmentId={environmentId}
                        key={entry.key}
                        onEdit={() =>
                          entry.documentId === undefined
                            ? setReopening(entry)
                            : editAgain(entry.documentId)
                        }
                        reopening={reopening?.key === entry.key}
                      />
                    ),
                  )}
              </div>
            </section>
          )}
          {reopening === null || environmentId === null ? null : (
            <PictureReader
              environmentId={environmentId}
              key={reopening.key}
              onFailed={(details) => {
                setReopening(null);
                setStage({ kind: "failed", details });
              }}
              onRead={(picture) => {
                setReopening(null);
                editPicture(picture);
              }}
              picture={reopening}
            />
          )}

          <footer className="text-muted-foreground mt-auto flex items-center gap-2 text-xs">
            <ExpressMark className="size-4 rounded-sm" />
            <span>Powered by Adobe Express · saving asks for your Adobe account</span>
          </footer>
        </div>
      )}
    </div>
  );
}

function ExpressTile(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly line: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="group/tile flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left shadow-xs/5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring @lg:flex-col"
      onClick={props.onClick}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-4.5">
        {props.icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium leading-5">{props.title}</span>
        <span className="text-muted-foreground text-xs leading-4">{props.line}</span>
      </span>
    </button>
  );
}

function SavedDesign({
  entry,
  environmentId,
  onEdit,
  reopening,
}: {
  readonly entry: SavedPicture;
  readonly environmentId: EnvironmentId | null;
  readonly onEdit: () => void;
  readonly reopening: boolean;
}) {
  const { url } = useMateImage(
    environmentId === null
      ? null
      : { environmentId, resource: entry.picture, rendition: TILE_PICTURE },
  );
  return (
    <figure className="group/saved relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
      {url === undefined ? null : (
        <img alt={entry.name} className="size-full object-contain" src={url} />
      )}
      <button
        className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs font-medium opacity-0 shadow-xs backdrop-blur-sm transition-opacity group-hover/saved:opacity-100 focus-visible:opacity-100 data-reopening:opacity-100"
        data-reopening={reopening || undefined}
        disabled={reopening}
        onClick={onEdit}
        type="button"
      >
        <PencilIcon aria-hidden="true" className="size-3" />
        {reopening ? "Opening…" : "Edit again"}
      </button>
    </figure>
  );
}

/** A design the Mate linked that no saved picture stands for yet. */
function LinkedDesign({
  entry,
  onOpen,
}: {
  readonly entry: Extract<ExpressHistoryEntry, { readonly kind: "design" }>;
  readonly onOpen: () => void;
}) {
  return (
    <button
      className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted p-3 text-center outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      type="button"
    >
      <ExpressMark className="size-8 rounded-lg" />
      <span className="line-clamp-2 text-xs font-medium leading-4">
        {entry.words ?? "Adobe Express design"}
      </span>
      {entry.words === undefined ? (
        <span className="font-mono text-muted-foreground text-xs leading-4">
          {entry.documentId.slice(-7)}
        </span>
      ) : null}
    </button>
  );
}

/** Reads a saved picture's full file (its kept original when the composer had to fit it). */
function PictureReader({
  environmentId,
  picture,
  onRead,
  onFailed,
}: {
  readonly environmentId: EnvironmentId;
  readonly picture: SavedPicture;
  readonly onRead: (picture: Blob) => void;
  readonly onFailed: (details: string) => void;
}) {
  const { read } = useMateImage({
    environmentId,
    resource: picture.original ?? picture.picture,
    rendition: "original",
  });
  const settle = useEffectEvent((value: typeof read) => {
    if (value.kind === "ready") onRead(value.blob);
    else if (value.kind === "failed") onFailed(value.reason);
  });
  useEffect(() => settle(read), [read]);
  return null;
}
