import { parseMateImageSource, demandedImageSize } from "@t3tools/client-runtime/data";
import { useMateImage } from "./MateImages";
import { AssetDownloadLink } from "./AssetDownloadLink";
import { useEffect, useState, type ComponentPropsWithoutRef } from "react";

import { useNearViewport } from "../hooks/useNearViewport";

export function ImageUnavailable({
  reason,
  className,
  ...props
}: ComponentPropsWithoutRef<"span"> & { readonly reason?: string | undefined }) {
  return (
    <span {...props} className={`asset-image-unavailable ${className ?? ""}`}>
      <span>Image unavailable</span>
      {reason ? <small>{reason}</small> : null}
    </span>
  );
}

/** Keep hidden history and the browser's broad native preload margin from reading asset bytes. */
function DirectAssetImage({
  src,
  onError,
  retrying = false,
  ...props
}: ComponentPropsWithoutRef<"img"> & { readonly retrying?: boolean }) {
  const { ref, near } = useNearViewport<HTMLImageElement>();
  const [failedSrc, setFailedSrc] = useState<string>();
  if (src !== undefined && failedSrc === src && !retrying) {
    return (
      <ImageUnavailable
        role="img"
        aria-label={props.alt ? `Image unavailable · ${props.alt}` : "Image unavailable"}
        className={props.className}
        style={{ width: props.width, height: props.height, ...props.style }}
      />
    );
  }
  return (
    <img
      {...props}
      ref={ref}
      src={near ? src : undefined}
      data-image-src={src}
      loading="lazy"
      decoding="async"
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}

export function AssetImage(
  props: ComponentPropsWithoutRef<"img"> & {
    readonly retrying?: boolean;
    readonly original?: boolean;
  },
) {
  const reference = parseMateImageSource(props.src);
  const { original: _, ...direct } = props;
  return reference === null ? (
    <DirectAssetImage {...direct} />
  ) : (
    <ManagedAssetImage {...props} reference={reference} />
  );
}

function ManagedAssetImage({
  reference,
  original = false,
  retrying: _retrying,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  readonly retrying?: boolean;
  readonly original?: boolean;
  readonly reference: NonNullable<ReturnType<typeof parseMateImageSource>>;
}) {
  const { ref, near } = useNearViewport<HTMLImageElement>();
  const [slot, setSlot] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !near) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const available = element.parentElement?.getBoundingClientRect();
      const width = Math.round(
        box.width ||
          Math.min(
            Number(props.width) || available?.width || 0,
            available?.width || Number(props.width) || 0,
          ),
      );
      const height =
        Math.round(box.height) ||
        (Number(props.width) && Number(props.height)
          ? Math.round((width * Number(props.height)) / Number(props.width))
          : Math.round(available?.height || 0) || width);
      if (width > 0)
        setSlot((held) =>
          held?.width === width && held.height === height ? held : { width, height },
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref, props.width, props.height]);
  const sourceSize =
    props.width && props.height
      ? { width: Number(props.width), height: Number(props.height) }
      : null;
  const demanded =
    slot === null
      ? null
      : sourceSize
        ? demandedImageSize(sourceSize, slot, window.devicePixelRatio || 1)
        : {
            width: Math.min(8192, Math.ceil(slot.width * (window.devicePixelRatio || 1))),
            height: Math.min(8192, Math.ceil(slot.height * (window.devicePixelRatio || 1))),
          };
  const key =
    near && (original || demanded !== null)
      ? { ...reference, rendition: original ? ("original" as const) : demanded! }
      : null;
  const { read, url, loadingOriginal, retry } = useMateImage(key);
  if (read.kind === "failed" && !url)
    return (
      <span className={props.className}>
        <ImageUnavailable reason={read.reason} />
        {read.originalAvailable ? (
          <AssetDownloadLink source={props.src ?? ""} download={props.alt || "image"}>
            Download original
          </AssetDownloadLink>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            retry();
          }}
        >
          Try again
        </button>
      </span>
    );
  return (
    <>
      {read.kind === "failed" ? (
        <span role="status">{read.reason}</span>
      ) : url && loadingOriginal ? (
        <span role="status">Loading original</span>
      ) : !url ? (
        <span className="sr-only" role="status">
          {original ? "Loading original" : "Loading image"}
        </span>
      ) : null}
      <img
        {...props}
        ref={ref}
        src={url}
        data-image-src={props.src}
        loading="lazy"
        decoding="async"
        aria-busy={!url || loadingOriginal}
      />
    </>
  );
}
