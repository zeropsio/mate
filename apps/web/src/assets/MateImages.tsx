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
import { createContext, useContext, useEffect, useRef } from "react";
import type { imagePresentationsOf } from "./imagePresentation";

export const MateImagesContext = createContext<{
  readonly store: AccountStore;
  readonly images: ReturnType<typeof makeMateImages>;
  readonly presentations: ReturnType<typeof imagePresentationsOf>;
} | null>(null);
const UNKNOWN = Atom.make<MateImageRead>({ kind: "unknown" });

export function useMateImage(key: MateImageKey | null, reference: MateImageReference | null = key) {
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
    reference === null || context === null
      ? UNKNOWN
      : context.store.data.project(mateImagePreview, reference),
  );
  const held =
    read.kind === "ready"
      ? read
      : preview.kind === "ready" && read.kind !== "failed"
        ? preview
        : null;
  const presentation =
    held !== null && reference !== null
      ? context?.presentations.get(reference.environmentId, held.blob, held.digest)
      : undefined;
  const originalUrl = read.kind === "ready" ? presentation?.url : undefined;
  const previewPresentation =
    preview.kind === "ready" && reference !== null
      ? context?.presentations.get(reference.environmentId, preview.blob, preview.digest)
      : undefined;
  const previewUrl = previewPresentation?.url;
  return {
    read,
    retry: () => {
      if (key !== null) context?.images.retry(key);
    },
    loadingOriginal: key?.rendition === "original" && read.kind !== "ready",
    url: presentation?.url ?? (key?.rendition === "original" ? previewUrl : undefined),
    presentation: presentation ?? (key?.rendition === "original" ? previewPresentation : undefined),
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
