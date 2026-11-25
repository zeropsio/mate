import { parseMateImageSource, demandedImageSize } from "@t3tools/client-runtime/data";
import { useMateImage } from "./MateImages";
import { AssetDownloadLink } from "./AssetDownloadLink";
import { useEffect, useState, type RefObject, type ComponentPropsWithoutRef } from "react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { useNearViewport } from "../hooks/useNearViewport";
import type { ImagePresentation } from "./imagePresentation";

export function ImageUnavailable({
  reason,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"span"> & { readonly reason?: string | undefined }) {
  return (
    <span
      {...props}
      className={cn(
        "flex min-h-10 flex-col items-center justify-center gap-0.75 bg-muted p-1.5 text-center text-2xs text-muted-foreground",
        className,
      )}
    >
      <span>{reason ?? "Image unavailable"}</span>
      {children}
    </span>
  );
}

/** A picture's room, on the card's corners. */
const FRAME_CLASS_NAME = "relative inline-block max-w-full rounded-card align-top";

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
  presentation,
  onReady,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  readonly imageRef: RefObject<HTMLImageElement | null>;
  readonly reserved?: boolean;
  readonly underlay?: string | undefined;
  readonly presentation?: ImagePresentation | undefined;
  /** Its pixels are fully shown, its fade over the underlay ended: called once per `src` and underlay, including a `src` already decoded at first render. */
  readonly onReady?: (() => void) | undefined;
}) {
  const [decoded, setDecoded] = useState<string>();
  useEffect(() => {
    const element = imageRef.current;
    if (!element || !props.src || typeof element.decode !== "function") return;
    let active = true;
    if (presentation?.decoded) return;
    void (presentation?.decode() ?? element.decode()).then(
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
  }, [imageRef, props.src, presentation]);
  const ready =
    props.src !== undefined && (presentation?.decoded === true || decoded === props.src);
  const readySrc = ready ? props.src : undefined;
  useEffect(() => {
    const element = imageRef.current;
    if (readySrc === undefined || !onReady || !element) return;
    // Already fully shown (decoded at first render, or no fade under reduced motion).
    if (getComputedStyle(element).opacity === "1") {
      onReady();
      return;
    }
    // Otherwise the underlay stays until the fade that covers it has ended; a cancelled fade
    // still counts when its end state is the shown picture.
    const shown = (event: TransitionEvent) => {
      if (event.propertyName !== "opacity" || element.style.opacity !== "1") return;
      stop();
      onReady();
    };
    const stop = () => {
      element.removeEventListener("transitionend", shown);
      element.removeEventListener("transitioncancel", shown);
    };
    element.addEventListener("transitionend", shown);
    element.addEventListener("transitioncancel", shown);
    return stop;
    // A new callback identity for the same shown source is not a new readiness; an underlay
    // that arrives after the picture is shown is told at once.
  }, [readySrc, underlay]);
  return (
    // Fetching and decoding hold the picture's room and paint nothing in it: the picture fades in
    // once decoded.
    <span
      className={FRAME_CLASS_NAME}
      data-image-frame=""
      data-image-pending={!ready || undefined}
      style={reserved ? reservedImageStyle(props) : undefined}
    >
      {underlay ? (
        <img
          src={underlay}
          alt=""
          aria-hidden
          decoding="async"
          draggable={false}
          // Laid over the picture it stands in for, it never takes the pointer: a press reaches
          // the picture (and a zoomed viewer's pan) even after it has faded out.
          className="pointer-events-none absolute inset-0 size-full object-contain"
          style={{ opacity: ready && props.src !== underlay ? 0 : 1 }}
        />
      ) : null}
      <img
        {...props}
        className={cn(
          "transition-opacity duration-200 ease-out-strong motion-reduce:transition-none",
          props.className,
        )}
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
      <span className={FRAME_CLASS_NAME} data-image-frame="" style={reservedImageStyle(props)}>
        <ImageUnavailable
          role="img"
          aria-label={props.alt ? `Image unavailable · ${props.alt}` : "Image unavailable"}
          className={props.className}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setFailedSrc(undefined);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </ImageUnavailable>
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
      loading="eager"
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
    /**
     * Its picture cannot be shown — its read failed, or its bytes did not decode: a place that
     * says so itself (a result's tile) takes it over instead of the words drawn here.
     */
    readonly onUnavailable?: (reason: string | undefined) => void;
    /** A picture drawn under the Mate's copy until that copy is shown. */
    readonly underlay?: string | undefined;
    /** The Mate's copy is fully shown, its fade over the underlay ended. */
    readonly onReady?: (() => void) | undefined;
  },
) {
  const { underlay, onReady, ...image } = props;
  const reference = parseMateImageSource(image.src);
  const { original: _, onUnavailable: _unavailable, ...direct } = image;
  return reference === null ? (
    <DirectAssetImage {...direct} />
  ) : (
    <ManagedAssetImage {...image} reference={reference} underlay={underlay} onReady={onReady} />
  );
}

function ManagedAssetImage({
  reference,
  original = false,
  retrying: _retrying,
  onUnavailable,
  underlay,
  onReady,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  readonly retrying?: boolean;
  readonly original?: boolean;
  readonly onUnavailable?: (reason: string | undefined) => void;
  readonly underlay?: string | undefined;
  readonly onReady?: (() => void) | undefined;
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
          // Hidden or moving content has no new drawn size to demand.
          held !== null && (box.width <= 0 || box.height <= 0)
            ? held
            : held?.width === width && held.height === height
              ? held
              : { width, height },
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
  const key = original
    ? { ...reference, rendition: "original" as const }
    : near && demanded !== null
      ? { ...reference, rendition: demanded }
      : null;
  const { read, url, originalUrl, previewUrl, presentation, loadingOriginal, retry } = useMateImage(
    key,
    reference,
  );
  const [failedUrl, setFailedUrl] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const decodeFailed = url !== undefined && failedUrl === url;
  const unavailable = (read.kind === "failed" && !url) || decodeFailed;
  const unavailableReason = decodeFailed
    ? "Image cannot be displayed."
    : read.kind === "failed"
      ? read.reason
      : undefined;
  useEffect(() => {
    if (unavailable) onUnavailable?.(unavailableReason);
  }, [onUnavailable, unavailable, unavailableReason]);
  if (unavailable)
    return (
      <span
        className={cn(FRAME_CLASS_NAME, props.className)}
        data-image-frame=""
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
        >
          {read.kind === "failed" && read.originalAvailable ? (
            <AssetDownloadLink source={props.src ?? ""} download={props.alt || "image"}>
              Download original
            </AssetDownloadLink>
          ) : null}
          {!decodeFailed && read.kind === "failed" && read.retryable ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                setFailedUrl(undefined);
                setAttempt((value) => value + 1);
                retry();
              }}
            >
              Try again
            </Button>
          ) : null}
        </ImageUnavailable>
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
        presentation={presentation}
        reserved
        src={original ? originalUrl : url}
        underlay={original ? previewUrl : underlay}
        onReady={onReady}
        data-image-src={props.src}
        loading="eager"
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
