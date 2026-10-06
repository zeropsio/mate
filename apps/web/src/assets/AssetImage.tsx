import type { ComponentPropsWithoutRef } from "react";

import { useNearViewport } from "../hooks/useNearViewport";

/** Keep hidden history and the browser's broad native preload margin from reading asset bytes. */
export function AssetImage({ src, ...props }: ComponentPropsWithoutRef<"img">) {
  const { ref, near } = useNearViewport<HTMLImageElement>();
  return (
    <img
      {...props}
      ref={ref}
      src={near ? src : undefined}
      data-image-src={src}
      loading="lazy"
      decoding="async"
    />
  );
}
