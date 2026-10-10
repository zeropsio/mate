import type { CallResultPage, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Maximize2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMateImage } from "~/assets/MateImages";
import { useTheme } from "~/hooks/useTheme";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import {
  PAGE_THEME_VARS,
  linkToOpen,
  pageDocument,
  pageFrameHeight,
  readPageMessage,
  themeMessage,
  type PageTheme,
} from "@t3tools/client-runtime/zerops/publishedPage";

/** The conversation's colours as the app's own tokens hold them now. */
function readTheme(scheme: PageTheme["scheme"]): PageTheme {
  const style = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of PAGE_THEME_VARS) {
    const value = style?.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return { scheme, vars };
}

/**
 * The conversation's colours as a page reads them, read again on any change of the app's theme —
 * light or dark, a palette, a contrast — that the root element's attributes carry.
 */
function usePageTheme(): PageTheme {
  const { resolvedTheme } = useTheme();
  const [theme, setTheme] = useState(() => readTheme(resolvedTheme));
  useEffect(() => {
    const refresh = () =>
      setTheme((held) => {
        const now = readTheme(resolvedTheme);
        return JSON.stringify(now) === JSON.stringify(held) ? held : now;
      });
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, [resolvedTheme]);
  return theme;
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

/** The element's nearest scrolling ancestor: the conversation's list, where it has one. */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return parent;
  }
  return null;
}

/**
 * Whether the element is near the view of the list it scrolls in: a page's frame runs only there,
 * so pages far off-screen — a spinning one among them — never hold the conversation, and the list's
 * own clipping never unmounts one in sight. A page spinning in view holds the browser as any page
 * would: a browser's limit, not this frame's. Without an observer (a server render), it always is.
 */
function useNearView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { root: scrollParentOf(element), rootMargin: "100% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

export interface PublishedPageFrameProps {
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
 * The page in its frames: two deep, sandboxed with scripts alone, its navigation refused before
 * it leaves (`@t3tools/client-runtime/zerops/publishedPage`). The frame stands at the shared cap from its first paint
 * until the page says its height, then eases to it, at most the cap: a taller page scrolls inside
 * it. When the page's own frame loads again — a navigation the wrapper refused — the wrapper says
 * the page left, and it is taken down and never heard from again; the person may show it again.
 *
 * This frame loads again too, whenever the conversation moves it (React reordering its rows, the
 * list recycling one): a frame taken out of the document and put back loads its document anew. It
 * always holds the wrapper and nothing else — the sandbox lets no page navigate it — so its own
 * loads are never counted: counting them closed every page that landed as its run settled.
 */
export function PublishedPageFrame(props: PublishedPageFrameProps) {
  const { title, html, theme, failed = false, full = false } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const near = useNearView(boxRef);
  const [content, setContent] = useState<number | null>(null);
  const [left, setLeft] = useState(false);
  /** Each showing of the page is a frame of its own. */
  const [showing, setShowing] = useState(0);
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
      const message = readPageMessage(event.data, event.origin);
      if (message === null) return;
      if (message.kind === "left") {
        setLeft(true);
        return;
      }
      if (message.kind === "height") {
        setContent(message.height);
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
  }, []);

  useEffect(() => {
    if (theme === opened) return;
    frameRef.current?.contentWindow?.postMessage(themeMessage(theme), "*");
  }, [theme, opened]);

  const height = full ? null : pageFrameHeight(content);
  const shown = document_ !== null && !left && near;
  return (
    <div
      ref={boxRef}
      className="published-page-frame"
      data-full={full ? "" : undefined}
      data-state={left ? "left" : failed ? "failed" : document_ === null ? "reading" : "ready"}
      style={height === null ? undefined : { height }}
    >
      {shown ? (
        <iframe
          key={showing}
          ref={frameRef}
          title={title}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          srcDoc={document_}
        />
      ) : left ? (
        <div className="published-page-left">
          <p>The page tried to open something else, so it was closed.</p>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setShowing((count) => count + 1);
              setLeft(false);
            }}
          >
            Show the page again
          </Button>
        </div>
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
      <PublishedPageFrame title={page.title} html={html} theme={theme} failed={failed} />
      <Dialog open={full} onOpenChange={setFull}>
        <DialogPopup className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{page.title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            {full ? <PublishedPageFrame title={page.title} html={html} theme={theme} full /> : null}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </figure>
  );
}
