import { useAtomValue } from "@effect/atom-react";
import {
  type makeMateImages,
  mateImage,
  parseMateImageSource,
  mateImagePreview,
  mateImageDimensions,
  type MateImageReference,
  type AccountStore,
  type MateImageKey,
  type MateImageRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

export const MateImagesContext = createContext<{
  readonly store: AccountStore;
  readonly images: ReturnType<typeof makeMateImages>;
} | null>(null);
const UNKNOWN = Atom.make<MateImageRead>({ kind: "unknown" });

export function useMateImage(key: MateImageKey | null) {
  const context = useContext(MateImagesContext);
  const identity = key === null ? null : JSON.stringify(key);
  const read = useAtomValue(
    key === null || context === null ? UNKNOWN : context.store.data.project(mateImage, key),
  );
  useEffect(() => {
    if (context === null || identity === null) return;
    return context.images.demand(JSON.parse(identity) as MateImageKey);
  }, [context, identity]);
  const preview = useAtomValue(
    key === null || key.rendition !== "original" || context === null
      ? UNKNOWN
      : context.store.data.project(mateImagePreview, key),
  );
  const originalUrl = useBlobUrl(read.kind === "ready" ? read.blob : null);
  const previewUrl = useBlobUrl(preview.kind === "ready" ? preview.blob : null);
  return {
    read,
    retry: () => {
      if (key !== null) context?.images.retry(key);
    },
    loadingOriginal: key?.rendition === "original" && read.kind !== "ready",
    url: originalUrl ?? previewUrl,
    originalUrl,
    previewUrl,
    dimensions:
      read.kind === "ready"
        ? read.dimensions
        : preview.kind === "ready"
          ? preview.dimensions
          : undefined,
  };
}

/** Blob URLs belong to the presentation; the account retains the bytes. */
function useBlobUrl(blob: Blob | null) {
  const [presentation, setPresentation] = useState<{
    readonly blob: Blob;
    readonly url: string;
  } | null>(null);
  useLayoutEffect(() => {
    if (blob === null) {
      setPresentation(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPresentation({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return blob !== null && presentation?.blob === blob ? presentation.url : undefined;
}

/** A deliberate image-open intent owns original demand until leave, blur or unmount. */
export function useImageIntent(source?: string) {
  const context = useContext(MateImagesContext);
  const held = useRef<{ readonly id: string; readonly release: () => void } | null>(null);
  const release = () => {
    held.current?.release();
    held.current = null;
  };
  useEffect(() => release, [context]);
  const start = (event: { readonly currentTarget: HTMLElement }) => {
    const image = event.currentTarget.querySelector<HTMLElement>("[data-image-src]");
    const reference = parseMateImageSource(source ?? image?.dataset.imageSrc);
    if (reference === null || context === null) return;
    const key = { ...reference, rendition: "original" as const };
    const id = JSON.stringify(key);
    if (held.current?.id === id) return;
    release();
    held.current = { id, release: context.images.demand(key) };
  };
  return {
    onPointerEnter: start,
    onFocus: start,
    onPointerDown: start,
    onPointerLeave: (event: { readonly currentTarget: HTMLElement }) => {
      if (!event.currentTarget.matches(":focus-within")) release();
    },
    onBlur: (event: { readonly currentTarget: HTMLElement }) => {
      if (!event.currentTarget.matches(":hover")) release();
    },
  };
}

const NO_DIMENSIONS = Atom.make<
  ReadonlyMap<string, { readonly width: number; readonly height: number }>
>(new Map());
export function useMateImageDimensions(references: ReadonlyArray<MateImageReference>) {
  const context = useContext(MateImagesContext);
  return useAtomValue(
    context === null ? NO_DIMENSIONS : context.store.data.project(mateImageDimensions, references),
  );
}
