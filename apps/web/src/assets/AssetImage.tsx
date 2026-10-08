import { parseMateImageSource, demandedImageSize } from "@t3tools/client-runtime/data";
import { useMateImage } from "./MateImages";
import { AssetDownloadLink } from "./AssetDownloadLink";
import { useEffect, useState, type RefObject, type ComponentPropsWithoutRef } from "react";

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

function reservedImageStyle(props: ComponentPropsWithoutRef<"img">) {
  const width = Number(props.width);
  const height = Number(props.height);
  return {
    width: width > 0 ? `min(100%, ${width}px)` : "100%",
    ...(width > 0 && height > 0 ? { aspectRatio: `${width} / ${height}` } : {}),
    ...props.style,
  };
}

/** The reserved image keeps its geometry; only decoded pixels become visible. */
function DecodedImage({
  imageRef,
  reserved = false,
  underlay,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  readonly imageRef: RefObject<HTMLImageElement | null>;
  readonly reserved?: boolean;
  readonly underlay?: string | undefined;
}) {
  const [decoded, setDecoded] = useState<string>();
  useEffect(() => {
    const element = imageRef.current;
    if (!element || !props.src || typeof element.decode !== "function") return;
    let active = true;
    void element.decode().then(
      () => {
        if (active) setDecoded(props.src);
      },
      () => {
        // The img error event owns the failure and retry presentation.
      },
    );
    return () => {
      active = false;
    };
  }, [imageRef, props.src]);
  const ready = props.src !== undefined && decoded === props.src;
  return (
    <span
      className="asset-image-frame"
      data-image-pending={!ready || undefined}
      style={reserved ? reservedImageStyle(props) : undefined}
    >
      {underlay ? (
        <img
          src={underlay}
          alt=""
          aria-hidden
          decoding="async"
          className="asset-image-underlay"
          style={{ opacity: ready && props.src !== underlay ? 0 : 1 }}
        />
      ) : null}
      <img
        {...props}
        ref={imageRef}
        style={{ ...props.style, ...(reserved ? { width: "100%" } : {}), opacity: ready ? 1 : 0 }}
      />
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
  const [attempt, setAttempt] = useState(0);
  if (src !== undefined && failedSrc === src && !retrying) {
    return (
      <span className="asset-image-frame" style={reservedImageStyle(props)}>
        <ImageUnavailable
          role="img"
          aria-label={props.alt ? `Image unavailable · ${props.alt}` : "Image unavailable"}
          className={props.className}
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setFailedSrc(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </span>
    );
  }
  return (
    <DecodedImage
      {...props}
      key={attempt}
      imageRef={ref}
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
  const { read, url, originalUrl, previewUrl, loadingOriginal, retry } = useMateImage(key);
  const [failedUrl, setFailedUrl] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const decodeFailed = url !== undefined && failedUrl === url;
  if ((read.kind === "failed" && !url) || decodeFailed)
    return (
      <span
        className={`asset-image-frame ${props.className ?? ""}`}
        style={reservedImageStyle(props)}
      >
        <ImageUnavailable
          reason={
            decodeFailed
              ? "Image cannot be displayed."
              : read.kind === "failed"
                ? read.reason
                : undefined
          }
        />
        {read.kind === "failed" && read.originalAvailable ? (
          <AssetDownloadLink source={props.src ?? ""} download={props.alt || "image"}>
            Download original
          </AssetDownloadLink>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setFailedUrl(undefined);
            setAttempt((value) => value + 1);
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
        <span className="sr-only" role="status">
          Loading original
        </span>
      ) : !url ? (
        <span className="sr-only" role="status">
          {original ? "Loading original" : "Loading image"}
        </span>
      ) : null}
      <DecodedImage
        {...props}
        key={attempt}
        imageRef={ref}
        reserved
        src={original ? originalUrl : url}
        underlay={original ? previewUrl : undefined}
        data-image-src={props.src}
        loading="lazy"
        decoding="async"
        aria-busy={!url || loadingOriginal}
        onError={(event) => {
          setFailedUrl(url);
          props.onError?.(event);
        }}
      />
    </>
  );
}
