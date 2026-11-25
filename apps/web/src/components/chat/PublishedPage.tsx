import { useAtomValue } from "@effect/atom-react";
import { mateEngineHostAtom } from "@t3tools/client-runtime/data";
import type { CallResultPage, EnvironmentId, PageHeight, ThreadId } from "@t3tools/contracts";
import { Maximize2Icon } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useMateImage } from "~/assets/MateImages";
import { useTheme } from "~/hooks/useTheme";
import { watchIntersections } from "~/lib/restingIntersections";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Failure } from "../ui/failure";
import { Skeleton } from "../ui/skeleton";
import { keepFrameOnMove } from "./keepFrameOnMove";
import { useTimelineRowSettling } from "./timelineRowReads";
import {
  knownPageHeights,
  pageHeightToRecord,
  PAGE_FIT_START,
  PAGE_PROBE,
  PAGE_THEME_VARS,
  linkToOpen,
  pageDocument,
  pageFirstDrawHeight,
  pageFitHeard,
  pageFitReaches,
  pageFitStand,
  pageScreenHeight,
  readPageMessage,
  screenMessage,
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
 * would: a browser's limit, not this frame's. Without an observer (a server render), it always is;
 * null until the observer first says.
 */
function useNearView(ref: React.RefObject<HTMLElement | null>): boolean | null {
  const [near, setNear] = useState<boolean | null>(() =>
    typeof IntersectionObserver === "undefined" ? true : null,
  );
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = watchIntersections(
      // A busy page gets several reports in one call, oldest first: the last says where it is now.
      (entries) => setNear(entries.at(-1)?.isIntersecting === true),
      { root: scrollParentOf(element), rootMargin: "100% 0px" },
    );
    if (observer === undefined) return;
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

interface PublishedPageFrameProps {
  readonly title: string;
  /** The page's HTML; null while it is read. */
  readonly html: string | null;
  readonly theme: PageTheme;
  /** The heights the page was laid out at, by width: where it stands before it says its own. */
  readonly heights?: ReadonlyArray<PageHeight>;
  /** The page settled at a height at its frame's width: once per frame. */
  readonly onMeasured?: (width: number, height: number) => void;
  /** It could not be read. */
  readonly failed?: boolean;
  /** Drawn full size: the frame takes its box's height, not the page's. */
  readonly full?: boolean;
}

/**
 * The page in its frames: two deep, sandboxed with scripts alone, its navigation refused before
 * it leaves (`@t3tools/client-runtime/zerops/publishedPage`). The page stands at its full height,
 * like the answer it is, however tall, following it up and down — but a page its viewport sizes
 * stands a screen tall and scrolls inside (`pageFitHeard`). From its first paint the
 * frame stands at the height recorded at the nearest width, so a page measured once never moves;
 * only its very first landing starts from a modest box and glides, once, to the page's height. The
 * page settled, the frame reports its height at its width (`onMeasured`) for later views. When the
 * page's own frame loads again — a navigation the wrapper refused — the wrapper says
 * the page left, and it is taken down and never heard from again; the person may show it again.
 *
 * This frame loads again too, whenever the conversation moves it (React reordering its rows, the
 * list recycling one): a frame taken out of the document and put back loads its document anew —
 * except where the browser moves it whole (`keepFrameOnMove`). It always holds the wrapper and
 * nothing else — the sandbox lets no page navigate it — so its own loads are never counted:
 * counting them closed every page that landed as its run settled.
 */
export function PublishedPageFrame(props: PublishedPageFrameProps) {
  const { title, html, theme, heights = [], onMeasured, failed = false, full = false } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const near = useNearView(boxRef);
  useEffect(() => (boxRef.current === null ? undefined : keepFrameOnMove(boxRef.current)), []);
  const [fit, setFit] = useState(PAGE_FIT_START);
  // The frame's width, read before its first paint: which recorded height it stands at; and a
  // screen of the conversation it stands in, for a page its viewport sizes.
  const [width, setWidth] = useState<number | null>(null);
  const [screen, setScreen] = useState(() =>
    pageScreenHeight(typeof window === "undefined" ? 0 : window.innerHeight),
  );
  /** The screen read before the frame first shows: the one the page opens with. */
  const [openedScreen, setOpenedScreen] = useState<number | null>(null);
  // Where it stands at a width before it has heard its page: the height recorded nearest it.
  /** Mounted into a conversation already shown, or outside one: what it does is watched. */
  const [live, setLive] = useState(false);
  const standsAt = useEffectEvent((at: number, tall: number) =>
    full ? null : pageFitStand({ fit: PAGE_FIT_START, heights, width: at, screen: tall }),
  );
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) return;
    const view = scrollParentOf(box);
    const read = () => {
      const at = Math.round(box.getBoundingClientRect().width);
      const tall = pageScreenHeight(view?.clientHeight ?? window.innerHeight);
      setWidth(at);
      setScreen(tall);
      setOpenedScreen((held) => held ?? tall);
      return [at, tall] as const;
    };
    // The list measures a row in the commit that mounts it, before the width read here draws the
    // frame again: it stands at its width's height in that commit already. Drawn first at the
    // height last recorded, at another width, the list kept that one, and the rows under a page
    // stood over it until it measured again (2,786 px, then a glide of 1.9 s, the owner 2026-11-11).
    const stands = standsAt(...read());
    if (stands !== null) box.style.height = `${stands}px`;
    setLive(box.closest("[data-timeline-thread]")?.hasAttribute("data-timeline-placing") !== true);
    // The conversation's view as well: a window made only shorter is a new screen at the same width.
    const observer = new ResizeObserver(read);
    observer.observe(box);
    if (view !== null) observer.observe(view);
    return () => observer.disconnect();
  }, []);
  // The page's height once it holds still after it loads is what a later view stands at: once per
  // frame and width, never what the person's clicks in it made of it later.
  const reportedAt = useRef<number | null>(null);
  const measured = useEffectEvent((at: number, tall: number) => {
    if (reportedAt.current === at) return;
    reportedAt.current = at;
    onMeasured?.(at, tall);
  });
  const settled = fit.asking !== null ? null : fit.sizedBy === "viewport" ? screen : fit.content;
  useEffect(() => {
    if (full || settled === null || width === null) return;
    const holds = setTimeout(() => measured(width, settled), PAGE_SETTLE_MS);
    return () => clearTimeout(holds);
  }, [full, settled, width]);
  const [left, setLeft] = useState(false);
  /** Each showing of the page is a frame of its own. */
  const [showing, setShowing] = useState(0);
  // The page is written once, in the colours and the screen it opened with; later ones reach it as
  // a message. Shown full size, its viewport units read its own frame.
  const [opened] = useState(theme);
  const document_ = useMemo(
    () =>
      html === null || (!full && openedScreen === null)
        ? null
        : pageDocument(html, opened, { screen: full ? null : openedScreen }),
    [html, opened, full, openedScreen],
  );

  const height = full
    ? null
    : width === null
      ? pageFirstDrawHeight(heights)
      : pageFitStand({ fit, heights, width, screen });
  // The page spoke: its frame's height is decided for now, its own or the one recorded for it,
  // which it keeps until the page has loaded (`pageFitHeard`).
  const [spoke, setSpoke] = useState(false);
  const heard = useEffectEvent(
    (said: { height: number; viewport: number | null; loaded: boolean }) => {
      setSpoke(true);
      if (height !== null) setFit((held) => pageFitHeard(held, said, height, heights.length > 0));
    },
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
        heard(message);
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
  // The screen now, where it is not the one the page opened with: told as it changes, and again as
  // the frame loads, since a frame that loads again holds the screen it opened with.
  const newScreen = full || screen === openedScreen ? null : screen;
  const tellScreen = () => {
    if (newScreen !== null)
      frameRef.current?.contentWindow?.postMessage(screenMessage(newScreen), "*");
  };
  useEffect(tellScreen, [newScreen]);

  // It glides only once it stood at a height of the page's own saying, or on its very first
  // landing, from its first box: the page's first word against a height recorded at another width
  // is placed, never eased into (a reload moved the conversation 20 px after it showed).
  const said = fit.content !== null || fit.sizedBy === "viewport";
  // Its first landing is one a person watches: the page arriving in a conversation that stands.
  // Mounted while its conversation is still being placed (a reload, an open), nothing was seen
  // of its first box, and its height is placed.
  const landing = heights.length === 0 && live;
  const [glides, setGlides] = useState(false);
  useEffect(() => {
    if (height === null || glides || !(said || landing)) return;
    const frame = requestAnimationFrame(() => setGlides(true));
    return () => cancelAnimationFrame(frame);
  }, [height, glides, said, landing]);
  const shown = document_ !== null && !left && near === true;
  // A page about to say its height keeps its conversation out of sight while it is placed, so the
  // frame stands at the page's own height in the first frame shown: briefly, since a page speaks
  // a few frames after its frame mounts. Whatever was recorded for it, at this width or another:
  // a page its viewport sizes was recorded a screen tall, and a screen is this window's.
  useTimelineRowSettling(!full && document_ !== null && !left && !said && !spoke && near !== false);
  return (
    <div
      ref={boxRef}
      // The page is the answer: it stands at its full height on the conversation's own ground, with
      // no card around it. Before a client ever measured it, a modest first box it glides from.
      className="h-60 overflow-hidden rounded-card data-glide:transition-[height] data-glide:duration-260 data-glide:ease-out-strong data-full:h-[min(80svh,900px)] data-full:transition-none motion-reduce:transition-none"
      data-full={full ? "" : undefined}
      data-glide={glides ? "" : undefined}
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
          className="block size-full border-0"
          srcDoc={document_}
          onLoad={tellScreen}
          // Asked whether it grows with its viewport, the page is laid out past the frame's edge.
          style={
            !pageFitReaches(fit) || height === null ? undefined : { height: height + PAGE_PROBE }
          }
        />
      ) : left ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-caption text-muted-foreground">
          <p>The page tried to open something else, so it was closed.</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setShowing((count) => count + 1);
              setLeft(false);
            }}
          >
            Show the page again
          </Button>
        </div>
      ) : failed ? (
        <div className="p-3">
          <Failure cause="The page could not be read from the Mate." />
        </div>
      ) : document_ === null ? (
        <Skeleton className="size-full" shape="card" />
      ) : null}
    </div>
  );
}

/** How long a page's height holds still before it is the height a later view stands at. */
const PAGE_SETTLE_MS = 600;

/**
 * A page the Mate published, above its answer: its title, the page in place at its full height,
 * and the page full size on request. Its bytes come from the Mate's asset store by the call's
 * reference; the height it settles at is recorded on its call for every later view.
 */
export function PublishedPage(props: {
  readonly page: CallResultPage;
  /** Its call's engine item, where its heights are recorded. */
  readonly itemId: string | null;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { page, itemId, environmentId, threadId } = props;
  const host = useAtomValue(mateEngineHostAtom);
  const heights = useMemo(
    () => (itemId === null ? (page.heights ?? []) : knownPageHeights(itemId, page.heights)),
    [itemId, page.heights],
  );
  const onMeasured = (width: number, content: number) => {
    if (itemId === null || host === null) return;
    const record = pageHeightToRecord({ itemId, heights, width, content });
    if (record === null) return;
    host.pages.recordHeight({
      environmentId,
      conversationId: threadId,
      itemId,
      width: record[0],
      height: record[1],
    });
  };
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
    <figure className="group/page grid min-w-0 gap-1.5" aria-label={page.title}>
      <figcaption className="flex min-w-0 items-center justify-between gap-2 text-caption text-muted-foreground">
        <span className="min-w-0 truncate">{page.title}</span>
        {/* Open full shows where the pointer is on the page, or a key reaches it; always on touch. */}
        <span className="flex opacity-0 transition-opacity duration-150 ease-out-strong group-hover/page:opacity-100 group-focus-within/page:opacity-100 pointer-coarse:opacity-100">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Open ${page.title} full size`}
            disabled={html === null}
            onClick={() => setFull(true)}
          >
            <Maximize2Icon />
          </Button>
        </span>
      </figcaption>
      <PublishedPageFrame
        title={page.title}
        html={html}
        theme={theme}
        heights={heights}
        onMeasured={onMeasured}
        failed={failed}
      />
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
