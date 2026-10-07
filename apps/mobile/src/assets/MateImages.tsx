import {
  mateImage,
  type AccountStore,
  type MateImageKey,
  type MateImageRead,
  type makeMateImages,
} from "@t3tools/client-runtime/data";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

export const MateImagesContext = createContext<{
  readonly data: AccountStore["data"];
  readonly registry: AtomRegistry.AtomRegistry;
  readonly images: ReturnType<typeof makeMateImages>;
} | null>(null);
const UNKNOWN: MateImageRead = { kind: "unknown" };

/** Native presentations keep authorized original bytes in memory, including their save/share URI. */
export function useMateImageUri(key: MateImageKey | null) {
  const context = useContext(MateImagesContext);
  const identity = key === null ? null : JSON.stringify(key);
  const atom = key === null || context === null ? null : context.data.project(mateImage, key);
  const read = useSyncExternalStore(
    (notify) =>
      context === null || atom === null ? () => {} : context.registry.subscribe(atom, notify),
    () => (context === null || atom === null ? UNKNOWN : context.registry.get(atom)),
    () => UNKNOWN,
  );
  useEffect(() => {
    if (context === null || identity === null) return;
    return context.images.demand(JSON.parse(identity) as MateImageKey);
  }, [context, identity]);
  const blob = read.kind === "ready" ? read.blob : null;
  const [presentation, setPresentation] = useState<{
    readonly blob: Blob;
    readonly uri: string;
  } | null>(null);
  useEffect(() => {
    if (blob === null) {
      setPresentation(null);
      return;
    }
    let active = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (active && typeof reader.result === "string")
        setPresentation({ blob, uri: reader.result });
    };
    reader.readAsDataURL(blob);
    return () => {
      active = false;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [blob]);
  return {
    read,
    uri:
      blob !== null && presentation !== null && presentation.blob === blob
        ? presentation.uri
        : null,
  };
}
