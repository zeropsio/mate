import { useState, type ComponentPropsWithoutRef } from "react";

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
export function AssetImage({
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
