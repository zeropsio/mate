import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Spinner } from "~/components/ui/spinner";

import { flowSrc, type FlowTheme, type KitFlow, type KitFlowState } from "../kitFlows";
import { watchCrossings } from "~/lib/restingIntersections";

import { allowCanvasScroll } from "./heldScroll";
import { PaintedFrame, useLoadTurn } from "./flowFrame";

/** A thumbnail's window: the reference window's shape on a desktop width, a phone's below. */
const thumbHeightOf = (viewport: number) =>
  Math.round(viewport < 768 ? (viewport * 844) / 390 : (viewport * 1000) / 1786);

/** The width an element has, kept as it resizes; the observer reports it as it starts. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Tells each thumbnail when it comes near the screen and when it leaves. */
type WatchNear = (element: Element, near: (isNear: boolean) => void) => () => void;

/**
 * One watcher for the whole grid, on the canvas that scrolls it: half a screen ahead and
 * behind, so scrolling finds pages drawn and far ones let go. It watches only while the page moves.
 */
function useWatchNear(root: HTMLElement | null): WatchNear | null {
  const [watch, setWatch] = useState<WatchNear | null>(null);
  useEffect(() => {
    if (root === null) return;
    const listeners = new Map<Element, (isNear: boolean) => void>();
    const crossings = watchCrossings(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: "50% 0px" },
    );
    setWatch(() => (element: Element, near: (isNear: boolean) => void) => {
      listeners.set(element, near);
      if (crossings === undefined) near(true);
      else crossings.observe(element);
      return () => {
        listeners.delete(element);
        crossings?.unobserve(element);
      };
    });
    return () => crossings?.disconnect();
  }, [root]);
  return watch;
}

/** One appearance of a state, scaled to its slot; its page loads only while near the screen. */
function ThumbPreview({
  src,
  title,
  viewport,
  near,
}: {
  readonly src: string;
  readonly title: string;
  readonly viewport: number;
  readonly near: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = thumbHeightOf(viewport);
  const scale = width / viewport;

  return (
    <div
      aria-hidden
      className="pointer-events-none relative min-w-0 flex-1 overflow-hidden bg-background"
      inert
      ref={ref}
      style={{ height: Math.round(height * scale) }}
    >
      {near && width > 0 ? (
        <ThumbLive height={height} scale={scale} src={src} title={title} viewport={viewport} />
      ) : null}
    </div>
  );
}

/** The page itself, mounted while near: it waits its turn to load, then shows once drawn. */
function ThumbLive({
  src,
  title,
  viewport,
  height,
  scale,
}: {
  readonly src: string;
  readonly title: string;
  readonly viewport: number;
  readonly height: number;
  readonly scale: number;
}) {
  const turn = useLoadTurn();
  const [painted, setPainted] = useState(false);
  return (
    <>
      {turn.granted ? (
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: viewport, height, transform: `scale(${scale})` }}
        >
          <PaintedFrame
            height={height}
            hidden={!painted}
            onPainted={() => {
              setPainted(true);
              turn.done();
            }}
            src={src}
            title={title}
            width={viewport}
          />
        </div>
      ) : null}
      {painted ? null : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" tone="muted" />
        </div>
      )}
    </>
  );
}

function FlowThumb({
  flow,
  state,
  themes,
  viewport,
  shown,
  watchNear,
  onOpen,
}: {
  readonly flow: KitFlow;
  readonly state: KitFlowState;
  readonly themes: readonly FlowTheme[];
  readonly viewport: number;
  readonly shown: boolean;
  readonly watchNear: WatchNear | null;
  readonly onOpen: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null || watchNear === null) return;
    return watchNear(element, setNear);
  }, [watchNear]);

  useEffect(() => {
    if (!shown) return;
    allowCanvasScroll();
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [shown]);

  return (
    <div className="min-w-0" ref={ref}>
      {/* The whole card opens the state for a pointer; its name is the press for the keyboard. */}
      <Card onClick={onOpen} variant="flat">
        <div className="flex gap-px overflow-hidden rounded-t-card border-b bg-border">
          {themes.map((theme) => (
            <ThumbPreview
              key={theme}
              near={near}
              src={flowSrc(flow, state, theme, { framed: true })}
              title={`${flow.title}, ${state.label}, ${theme}`}
              viewport={viewport}
            />
          ))}
        </div>
        <div className="flex min-w-0 items-center gap-2 p-1.5">
          <div className="min-w-0 flex-1">
            <Button aria-current={shown || undefined} size="sm" variant="ghost">
              <span className="truncate">{state.label}</span>
            </Button>
          </div>
          {shown ? <Badge tone="info">Shown</Badge> : null}
          <code className="min-w-0 max-w-[50%] truncate pe-1.5 font-mono text-caption text-muted-foreground">
            {state.search === "" ? "default" : state.search}
          </code>
        </div>
      </Card>
    </div>
  );
}

/** Every state of a flow at once, each a live page drawn small, loaded as it nears the screen. */
export function FlowGrid({
  flow,
  states,
  themes,
  viewport,
  shown,
  root,
  onOpen,
}: {
  readonly flow: KitFlow;
  readonly states: readonly KitFlowState[];
  readonly themes: readonly FlowTheme[];
  readonly viewport: number;
  readonly shown: string;
  /** The scrolling canvas the thumbnails sit in. */
  readonly root: HTMLElement | null;
  readonly onOpen: (state: string) => void;
}) {
  const watchNear = useWatchNear(root);
  return (
    <div
      className={
        themes.length > 1
          ? "grid grid-cols-[repeat(auto-fill,minmax(30rem,1fr))] gap-6 p-6"
          : "grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-6 p-6"
      }
    >
      {states.map((state) => (
        <FlowThumb
          flow={flow}
          key={state.id}
          onOpen={() => onOpen(state.id)}
          shown={state.id === shown}
          state={state}
          themes={themes}
          viewport={viewport}
          watchNear={watchNear}
        />
      ))}
    </div>
  );
}
