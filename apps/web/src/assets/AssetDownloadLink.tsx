import { parseMateImageSource } from "@t3tools/client-runtime/data";
import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { useMateImage } from "./MateImages";

export function AssetDownloadLink({
  source,
  ...props
}: Omit<ComponentPropsWithoutRef<"a">, "href"> & { readonly source: string }) {
  const reference = parseMateImageSource(source);
  const [requested, setRequested] = useState(false);
  const [pending, setPending] = useState(false);
  const destination = useRef<Window | null>(null);
  const original = useMateImage(
    requested && reference !== null ? { ...reference, rendition: "original" } : null,
  );
  useEffect(() => {
    if (!pending || original.read.kind !== "ready" || !original.url) return;
    if (props.target === "_blank" && !props.download) {
      if (destination.current && !destination.current.closed)
        if (original.read.blob.type === "image/svg+xml") {
          const image = destination.current.document.createElement("img");
          image.src = original.url;
          image.alt = typeof props.children === "string" ? props.children : "Image";
          destination.current.document.body.replaceChildren(image);
        } else destination.current.location.href = original.url;
      destination.current = null;
    } else {
      const link = document.createElement("a");
      link.href = original.url;
      link.download = typeof props.download === "string" ? props.download : "image";
      link.click();
    }
    setPending(false);
  }, [original.read.kind, original.url, pending, props.download, props.target]);
  return (
    <>
      <a
        {...props}
        href={reference === null ? source : original.url}
        onClick={(event) => {
          props.onClick?.(event);
          if (reference === null || event.defaultPrevented) return;
          event.preventDefault();
          if (props.target === "_blank" && !props.download) {
            destination.current = window.open("about:blank", "_blank");
            if (destination.current) destination.current.opener = null;
          }
          setRequested(true);
          setPending(true);
          original.retry();
        }}
      />
      {requested && original.read.kind === "failed" ? (
        <small role="status">{original.read.reason}</small>
      ) : requested && original.read.kind !== "ready" ? (
        <small role="status">Loading original</small>
      ) : null}
    </>
  );
}
