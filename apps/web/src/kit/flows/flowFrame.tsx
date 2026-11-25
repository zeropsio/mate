import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";

/** How long a page may take to draw before its frame shows anyway, as far as it got. */
const PAINT_PATIENCE_MS = 5000;
const PAINT_POLL_MS = 40;

/**
 * Calls `painted` once the frame's harness has drawn: its `#design` host holds something and two of
 * the page's own frames have passed. A harness module loads after the page's `load`, so `load`
 * alone would show a blank page.
 */
function watchPaint(frame: HTMLIFrameElement, painted: () => void): () => void {
  let stopped = false;
  let timer = 0;
  const started = performance.now();
  const check = () => {
    if (stopped) return;
    const view = frame.contentWindow;
    const drawn = (frame.contentDocument?.getElementById("design")?.childElementCount ?? 0) > 0;
    if ((drawn && view !== null) || performance.now() - started > PAINT_PATIENCE_MS) {
      const nextFrame = (step: () => void) =>
        view === null ? window.requestAnimationFrame(step) : view.requestAnimationFrame(step);
      nextFrame(() =>
        nextFrame(() => {
          if (!stopped) painted();
        }),
      );
      return;
    }
    timer = window.setTimeout(check, PAINT_POLL_MS);
  };
  check();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

/** When the last Tab was pressed in the kit: focus that lands in a frame right after is the person's. */
let lastTabAt = Number.NEGATIVE_INFINITY;
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Tab") lastTabAt = performance.now();
    },
    true,
  );
}
const TAB_LANDS_MS = 200;

/**
 * A harness that focuses a field as it opens, or clicks its way into a state, takes the keyboard
 * from the kit, and ← → would move the caret instead of the state. Until the person reaches into
 * the page (a press inside it, or a Tab into it), focus the page takes goes back to the kit.
 */
function keepKeysUnlessReached(frame: HTMLIFrameElement): () => void {
  const view = frame.contentWindow;
  if (view === null) return () => {};
  let reached = false;
  const reach = () => {
    reached = true;
  };
  const taken = () => {
    if (reached || performance.now() - lastTabAt < TAB_LANDS_MS) {
      reached = true;
      return;
    }
    queueMicrotask(() => {
      if (document.activeElement === frame) frame.blur();
    });
  };
  view.addEventListener("pointerdown", reach, true);
  view.addEventListener("focus", taken);
  if (document.activeElement === frame) taken();
  return () => {
    view.removeEventListener("pointerdown", reach, true);
    view.removeEventListener("focus", taken);
  };
}

/** One page in a frame that reports when it has drawn. */
export function PaintedFrame({
  src,
  title,
  width,
  height,
  hidden,
  onPainted,
}: {
  readonly src: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  /** Still drawing behind the shown frame: invisible, out of the tab order, untouchable. */
  readonly hidden: boolean;
  readonly onPainted: (src: string) => void;
}) {
  const report = useRef(onPainted);
  useLayoutEffect(() => {
    report.current = onPainted;
  });
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  return (
    // oxlint-disable-next-line react/iframe-missing-sandbox -- the flow is this build's own page
    <iframe
      aria-hidden={hidden || undefined}
      className={
        hidden
          ? "pointer-events-none absolute inset-0 border-0 opacity-0"
          : "absolute inset-0 border-0"
      }
      onLoad={(event) => {
        const frame = event.currentTarget;
        stop.current();
        const stopPaint = watchPaint(frame, () => report.current(src));
        const stopFocus = keepKeysUnlessReached(frame);
        stop.current = () => {
          stopPaint();
          stopFocus();
        };
      }}
      src={src}
      style={{ width, height }}
      tabIndex={hidden ? -1 : undefined}
      title={title}
    />
  );
}

/**
 * A page in a frame `width` × `height` px, drawn at `zoom`. A new `src` loads behind the one shown,
 * which stays until the new page has drawn: switching states never flashes a blank frame or moves
 * the canvas.
 */
export function FlowFrame({
  src,
  title,
  width,
  height,
  zoom,
}: {
  readonly src: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const loading = shown !== src;
  // The shown page first, the one loading after it: dropping the shown one never moves the other,
  // and a moved frame would load again.
  const sources = shown === null || shown === src ? [src] : [shown, src];

  return (
    <div
      className="relative overflow-hidden rounded-card border bg-card shadow-xs/5"
      style={{ width: Math.round(width * zoom), height: Math.round(height * zoom) }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height, transform: `scale(${zoom})` }}
      >
        {sources.map((source) => (
          <PaintedFrame
            height={height}
            hidden={source !== shown}
            key={source}
            onPainted={setShown}
            src={source}
            title={title}
            width={width}
          />
        ))}
      </div>
      {loading ? (
        <div className="pointer-events-none absolute end-3 top-3">
          <Badge tone="neutral">
            <Spinner size="xs" />
            Drawing
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

/** At most this many grid frames load at once: each is a whole page starting up. */
const LOADING_AT_ONCE = 3;
let loadingNow = 0;
const queued: Array<() => void> = [];

const nextTurn = () => {
  while (loadingNow < LOADING_AT_ONCE && queued.length > 0) {
    loadingNow += 1;
    queued.shift()?.();
  }
};

/**
 * Whether a grid frame may load now: it waits its turn behind the frames already loading from
 * the moment it mounts. `done` gives the turn back once it has drawn; unmounting gives it back too.
 */
export function useLoadTurn(): { readonly granted: boolean; readonly done: () => void } {
  const [granted, setGranted] = useState(false);
  const release = useRef<() => void>(() => {});

  useEffect(() => {
    let held = false;
    let returned = false;
    const start = () => {
      held = true;
      setGranted(true);
    };
    release.current = () => {
      if (returned) return;
      returned = true;
      if (held) {
        loadingNow -= 1;
        nextTurn();
      } else {
        const at = queued.indexOf(start);
        if (at !== -1) queued.splice(at, 1);
      }
    };
    queued.push(start);
    nextTurn();
    return () => release.current();
  }, []);

  return { granted, done: () => release.current() };
}
