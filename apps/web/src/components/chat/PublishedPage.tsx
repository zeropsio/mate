import type { CallResultPage, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Maximize2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Whether the element is near the view: a page's frame runs only there, so pages far off-screen —
 * a spinning one among them — never hold the conversation. Without an observer (a server render),
 * it always is.
 */
function useNearView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: "100% 0px" },
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
  /** Its height as zcp's browser laid it out when it was published. */
  readonly recordedHeight?: number;
  /** It could not be read. */
  readonly failed?: boolean;
  /** Drawn full size: the frame takes its box's height, not the page's. */
  readonly full?: boolean;
}

/**
 * The page in its frame: sandboxed with scripts alone, behind a policy that lets it request
 * nothing (`publishedPage.logic.ts`). The frame stands at the page's recorded height from its
 * first paint — at the shared cap while that is unknown — and follows the height the page says,
 * at most the cap: a taller page scrolls inside it. A page that navigates its own frame — a
 * redirect, a script, a link it kept from the conversation — is taken down at once and never
 * heard from again: what loads there is not the page the Mate published. The person may show the
 * published page again.
 */
export function PublishedPageFrame(props: PublishedPageFrameProps) {
  const { title, html, theme, recordedHeight, failed = false, full = false } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const near = useNearView(boxRef);
  const [content, setContent] = useState<number | null>(null);
  const [left, setLeft] = useState(false);
  /** Each showing of the page is a frame of its own: its loads are counted from none. */
  const [showing, setShowing] = useState(0);
  const loads = useRef(0);
  // Each frame element counts its own loads: one mounted again as it nears the view starts at none.
  const attach = useCallback((frame: HTMLIFrameElement | null) => {
    frameRef.current = frame;
    loads.current = 0;
  }, []);
  // The page is written once, in the colours it opened with; later colours reach it as a message.
  const [opened] = useState(theme);
  const document_ = useMemo(
    () => (html === null ? null : pageDocument(html, opened)),
    [html, opened],
  );

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow || loads.current > 1) return;
      const message = readPageMessage(event.data);
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
    frameRef.current?.contentWindow?.postMessage(
      { mate: "page-theme", rule: themeRule(theme) },
      "*",
    );
  }, [theme, opened]);

  const height = full ? null : pageFrameHeight(content, recordedHeight);
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
          ref={attach}
          title={title}
          sandbox="allow-scripts"
          allow=""
          referrerPolicy="no-referrer"
          srcDoc={document_}
          onLoad={() => {
            // Its own document loads once; any load after it is somewhere else.
            loads.current += 1;
            if (loads.current > 1) setLeft(true);
          }}
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
      <PublishedPageFrame
        title={page.title}
        html={html}
        theme={theme}
        failed={failed}
        {...(page.height === undefined ? {} : { recordedHeight: page.height })}
      />
      <Dialog open={full} onOpenChange={setFull}>
        <DialogPopup className="max-w-6xl">
          <div className="published-page-full-head">
            <DialogTitle>{page.title}</DialogTitle>
          </div>
          {full ? <PublishedPageFrame title={page.title} html={html} theme={theme} full /> : null}
        </DialogPopup>
      </Dialog>
    </figure>
  );
}
