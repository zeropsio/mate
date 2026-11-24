import { useEffect, useRef, type ReactNode } from "react";

import type { KitGround, KitView, KitZoom } from "../kitAppearance";

const GROUND_CLASS: Readonly<Record<KitGround, string>> = {
  page: "bg-background text-foreground",
  card: "bg-card text-card-foreground",
  menu: "bg-sidebar text-sidebar-foreground",
};

/** Every box in the canvas drawn with a hairline, to read its layout. */
const OUTLINE_CLASS = "**:outline **:-outline-offset-1 **:outline-primary/40";

/** What a frame of the "both" view hears from its page: the playground's arguments as they change. */
export interface KitPaneMessage {
  readonly type: "kit-args";
  readonly args: string | undefined;
}

/** What a frame says once it listens for its arguments. */
export const KIT_PANE_READY = { type: "kit-pane-ready" } as const;

export const isKitPaneReady = (data: unknown): boolean =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === "kit-pane-ready";

export const isKitPaneMessage = (data: unknown): data is KitPaneMessage =>
  typeof data === "object" && data !== null && (data as { type?: unknown }).type === "kit-args";

/**
 * The canvas a component, its variants or the census stand on: its ground, its outline, and its
 * width and zoom, inside a scrolling stage. Both appearances are two frames of the page itself,
 * each painting one, since an appearance belongs to a whole document.
 */
export function KitStage({
  view,
  viewport,
  ground,
  zoom,
  outline,
  paneHref,
  paneMessage,
  label,
  children,
}: {
  readonly view: KitView;
  readonly viewport: number | undefined;
  readonly ground: KitGround;
  readonly zoom: KitZoom;
  readonly outline: boolean;
  /** The canvas alone in one appearance, without its arguments: what each frame loads. */
  readonly paneHref: (appearance: "light" | "dark") => string;
  /** Sent to the frames as it changes, so typing into a control reloads neither. */
  readonly paneMessage?: KitPaneMessage;
  readonly label: string;
  readonly children: ReactNode;
}) {
  if (view === "both") {
    return (
      <BothFrames
        label={label}
        paneHref={paneHref}
        paneMessage={paneMessage}
        viewport={viewport}
        zoom={zoom}
      />
    );
  }
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-muted/40 p-4" data-kit-stage="">
      <KitCanvas ground={ground} outline={outline} viewport={viewport} zoom={zoom} fill>
        {children}
      </KitCanvas>
    </div>
  );
}

/** The canvas itself: its ground and outline at its width, zoomed. */
export function KitCanvas({
  ground,
  outline,
  viewport,
  zoom,
  fill = false,
  children,
}: {
  readonly ground: KitGround;
  readonly outline: boolean;
  readonly viewport: number | undefined;
  readonly zoom: KitZoom;
  /** Inside a stage it is a card at least as tall as the stage; alone it is the whole window. */
  readonly fill?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={`${GROUND_CLASS[ground]} ${outline ? OUTLINE_CLASS : ""} ${fill ? "mx-auto min-h-full overflow-clip rounded-card border" : "min-h-svh"} relative flex flex-col`}
      data-kit-canvas=""
      style={{
        zoom: zoom / 100,
        ...(viewport === undefined ? {} : { width: viewport }),
      }}
    >
      {children}
    </div>
  );
}

function BothFrames({
  viewport,
  zoom,
  paneHref,
  paneMessage,
  label,
}: {
  readonly viewport: number | undefined;
  readonly zoom: KitZoom;
  readonly paneHref: (appearance: "light" | "dark") => string;
  readonly paneMessage: KitPaneMessage | undefined;
  readonly label: string;
}) {
  const frames = useRef<Array<HTMLIFrameElement | null>>([]);
  // A frame's address leaves the arguments out: they reach it as messages, on load and on change.
  const latest = useRef(paneMessage);

  // A frame's page says when it listens; it hears the arguments as they stand then.
  useEffect(() => {
    const onReady = (event: MessageEvent) => {
      if (event.origin !== location.origin || !isKitPaneReady(event.data)) return;
      const frame = frames.current.find((candidate) => candidate?.contentWindow === event.source);
      if (latest.current === undefined || frame?.contentWindow == null) return;
      frame.contentWindow.postMessage(latest.current, location.origin);
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, []);

  useEffect(() => {
    latest.current = paneMessage;
    if (paneMessage === undefined) return;
    for (const frame of frames.current) {
      frame?.contentWindow?.postMessage(paneMessage, location.origin);
    }
  }, [paneMessage]);

  const width = viewport === undefined ? undefined : (viewport * zoom) / 100;
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-auto bg-muted/40 p-4"
      data-kit-stage=""
    >
      {(["light", "dark"] as const).map((appearance, index) => (
        // oxlint-disable-next-line react/iframe-missing-sandbox -- the frame is this page itself
        <iframe
          className={`h-full shrink-0 rounded-card border ${width === undefined ? "min-w-0 flex-1" : ""}`}
          key={appearance}
          ref={(frame) => {
            frames.current[index] = frame;
          }}
          src={paneHref(appearance)}
          style={width === undefined ? undefined : { width }}
          title={`${label}, ${appearance}`}
        />
      ))}
    </div>
  );
}
