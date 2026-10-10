import type { CallResultPage, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Maximize2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMateImage } from "~/assets/MateImages";
import { useTheme } from "~/hooks/useTheme";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import {
  PAGE_THEME_VARS,
  linkToOpen,
  pageDocument,
  pageFrameHeight,
  readPageMessage,
  themeRule,
  type PageTheme,
} from "./publishedPage.logic";
import { rememberPageHeight, rememberedPageHeight } from "./pageHeights";

/** The conversation's colours as a page reads them, read off the app's own tokens. */
function usePageTheme(): PageTheme {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    const style =
      typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const vars: Record<string, string> = {};
    for (const name of PAGE_THEME_VARS) {
      const value = style?.getPropertyValue(name).trim();
      if (value) vars[name] = value;
    }
    return { scheme: resolvedTheme, vars };
  }, [resolvedTheme]);
}

/** A blob's text, once it is read; null until then. */
function useBlobText(blob: Blob | null): string | null {
  const [read, setRead] = useState<{ blob: Blob; text: string } | null>(null);
  useEffect(() => {
    if (blob === null) return;
    let live = true;
    void blob.text().then((text) => {
      if (live) setRead({ blob, text });
    });
    return () => {
      live = false;
    };
  }, [blob]);
  return read !== null && read.blob === blob ? read.text : null;
}

export interface PublishedPageFrameProps {
  /** The page's asset: what its height is remembered by. */
  readonly id: string;
  readonly title: string;
  /** The page's HTML; null while it is read. */
  readonly html: string | null;
  readonly theme: PageTheme;
  /** It could not be read. */
  readonly failed?: boolean;
  /** Drawn full size: the frame takes its box's height, not the page's. */
  readonly full?: boolean;
}

/**
 * The page in its frame: sandboxed with scripts alone, behind a policy that allows no network
 * (`publishedPage.logic.ts`). The frame stands at the page's remembered height from its first paint
 * — at the shared cap while that is unknown — and follows the height the page says, at most the
 * cap: a taller page scrolls inside it.
 */
export function PublishedPageFrame(props: PublishedPageFrameProps) {
  const { id, title, html, theme, failed = false, full = false } = props;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState(() => rememberedPageHeight(id));
  // The page is written once, in the colours it opened with; later colours reach it as a message.
  const [opened] = useState(theme);
  const document_ = useMemo(
    () => (html === null ? null : pageDocument(html, opened)),
    [html, opened],
  );

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const message = readPageMessage(event.data);
      if (message === null) return;
      if (message.kind === "height") {
        setContent(message.height);
        // Full size, the page lays out wider: its height in the conversation is another.
        if (!full) rememberPageHeight(id, message.height);
        return;
      }
      const url = linkToOpen(message, {
        fromFrame: true,
        focused: document.activeElement === frame,
        activated: navigator.userActivation?.isActive ?? true,
      });
      if (url !== null) window.open(url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [id, full]);

  useEffect(() => {
    if (theme === opened) return;
    frameRef.current?.contentWindow?.postMessage(
      { mate: "page-theme", rule: themeRule(theme) },
      "*",
    );
  }, [theme, opened]);

  const height = full ? null : pageFrameHeight(content);
  return (
    <div
      className="published-page-frame"
      data-full={full ? "" : undefined}
      data-state={failed ? "failed" : document_ === null ? "reading" : "ready"}
      style={height === null ? undefined : { height }}
    >
      {document_ !== null ? (
        <iframe
          ref={frameRef}
          title={title}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          srcDoc={document_}
        />
      ) : failed ? (
        <p className="published-page-failed">The page could not be read from the Mate.</p>
      ) : null}
    </div>
  );
}

/**
 * A page the Mate published, above its answer: its title, the page in place, and the page full
 * size on request. Its bytes come from the Mate's asset store by the call's reference.
 */
export function PublishedPage(props: {
  readonly page: CallResultPage;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { page, environmentId, threadId } = props;
  const reference = useMemo(
    () => ({
      environmentId,
      resource: {
        _tag: "media-file" as const,
        threadId,
        path: `mate-asset:${page.asset.id}`,
      },
    }),
    [environmentId, threadId, page.asset.id],
  );
  const bytes = useMateImage(
    useMemo(() => ({ ...reference, rendition: "original" as const }), [reference]),
    reference,
  );
  const html = useBlobText(bytes.read.kind === "ready" ? bytes.read.blob : null);
  const theme = usePageTheme();
  const [full, setFull] = useState(false);
  const failed = bytes.read.kind === "failed" || (bytes.read.kind === "ready" && !bytes.read.blob);
  return (
    <figure className="published-page" aria-label={page.title}>
      <figcaption className="published-page-head">
        <span className="published-page-title">{page.title}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`Open ${page.title} full size`}
          disabled={html === null}
          onClick={() => setFull(true)}
        >
          <Maximize2Icon />
        </Button>
      </figcaption>
      <PublishedPageFrame
        id={page.asset.id}
        title={page.title}
        html={html}
        theme={theme}
        failed={failed}
      />
      <Dialog open={full} onOpenChange={setFull}>
        <DialogPopup className="max-w-6xl">
          <div className="published-page-full-head">
            <DialogTitle>{page.title}</DialogTitle>
          </div>
          {full ? (
            <PublishedPageFrame
              id={page.asset.id}
              title={page.title}
              html={html}
              theme={theme}
              full
            />
          ) : null}
        </DialogPopup>
      </Dialog>
    </figure>
  );
}
