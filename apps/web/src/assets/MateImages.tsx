import { useAtomValue } from "@effect/atom-react";
import {
  type makeMateImages,
  mateImage,
  mateImagePreview,
  mateImageDimensions,
  type MateImageReference,
  type AccountStore,
  type MateImageKey,
  type MateImageRead,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useState } from "react";

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
  const blob = read.kind === "ready" ? read.blob : preview.kind === "ready" ? preview.blob : null;
  const [presentation, setPresentation] = useState<{
    readonly blob: Blob;
    readonly url: string;
  } | null>(null);
  useEffect(() => {
    if (blob === null) {
      setPresentation(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPresentation({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return {
    read,
    retry: () => {
      if (key !== null) context?.images.retry(key);
    },
    loadingOriginal: key?.rendition === "original" && read.kind !== "ready",
    url: blob !== null && presentation?.blob === blob ? presentation.url : undefined,
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
