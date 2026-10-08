import { useMateImage } from "~/assets/MateImages";
import { parseMateImageSource } from "@t3tools/client-runtime/data";
import type { EnvironmentId } from "@t3tools/contracts";
import { isProjectFaviconFallbackUrl } from "@t3tools/shared/projectFavicon";
import { FolderIcon } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { useAssetUrlState } from "../assets/assetUrls";
import { useNearViewport } from "../hooks/useNearViewport";
import { cn } from "~/lib/utils";

export function ProjectFavicon(input: {
  environmentId: EnvironmentId;
  cwd: string;
  faviconPath?: string | null | undefined;
  className?: string | undefined;
  fallbackIcon?: ComponentType<{ className?: string }>;
}) {
  const state = useProjectFaviconAsset(input);
  const src = state._tag === "Success" ? state.url : null;
  const reference = parseMateImageSource(src ?? undefined);
  const { ref, near } = useNearViewport<HTMLSpanElement>();
  const [drawn, setDrawn] = useState(14);
  useEffect(() => {
    const element = ref.current;
    if (!element || !near) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) setDrawn(Math.max(box.width, box.height));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, near]);
  const size = Math.ceil(
    drawn * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1),
  );
  const image = useMateImage(
    reference !== null && near ? { ...reference, rendition: { width: size, height: size } } : null,
  );
  const [failedUrl, setFailedUrl] = useState<string>();
  const FallbackIcon = input.fallbackIcon ?? FolderIcon;
  const url =
    reference !== null ? image.url : src && !isProjectFaviconFallbackUrl(src) ? src : null;
  return (
    <span ref={ref} className={cn("inline-flex size-3.5 shrink-0", input.className)}>
      {url && url !== failedUrl ? (
        <img
          src={url}
          alt=""
          decoding="async"
          onError={() => setFailedUrl(url)}
          className="size-full rounded-[25%] object-contain"
        />
      ) : (
        <FallbackIcon className="size-full text-icon-muted" />
      )}
    </span>
  );
}

export function useProjectFaviconAsset(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly faviconPath?: string | null | undefined;
}) {
  return useAssetUrlState(input.environmentId, {
    _tag: "project-favicon",
    cwd: input.cwd,
    ...(input.faviconPath ? { path: input.faviconPath } : {}),
  });
}
