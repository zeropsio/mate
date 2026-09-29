/**
 * The conversation pane across switches between Mates (T1): one layer per
 * conversation, and over it, while the next one is placed, a still picture of
 * what the pane showed last. The conversation inside a layer says what it
 * shows (`useTimelineSwitch`): its rows standing where they stay — the
 * picture then fades over 150 ms, or goes in that frame under reduced motion
 * — or, on its way, its Mate at work, which is held the same way while the
 * rows that replace it are placed. A conversation slow to come gives way
 * after a while to its own pane.
 */
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { captureFreezeFrame, type FreezeFrame } from "./freezeFrame";
import {
  initialTimelineSwitch,
  showsTimelineLayer,
  stepTimelineSwitch,
  type TimelineSwitchEvent,
} from "./timelineSwitch.logic";

/** How a conversation tells the pane what it shows; each layer gives its own. */
export interface TimelineSwitchLayer {
  /** Its rows stand on screen where they stay. */
  readonly painted: () => void;
  /** On its way, its Mate at work shows on its pane. */
  readonly waiting: () => void;
  /** That pane is going for the rows: called while it still stands on the page. */
  readonly placing: () => void;
}

export const TimelineSwitchContext = createContext<TimelineSwitchLayer | null>(null);

/** What the conversation tells the pane; null outside a switch. */
export function useTimelineSwitch(): TimelineSwitchLayer | null {
  return use(TimelineSwitchContext);
}

/**
 * How long a conversation slow to come keeps the one left on screen. Its own
 * pane shows its Mate at work from 400 ms, so the picture gives way to it
 * while it is still arriving.
 */
const HOLD_AT_MOST_MS = 600;
const CROSSFADE = { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)" } as const;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TimelineSwitch({
  switchKey,
  children,
}: {
  readonly switchKey: string;
  readonly children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(initialTimelineSwitch(switchKey));
  const pictureRef = useRef<{ readonly key: string; readonly frame: FreezeFrame } | null>(null);
  const fadeRef = useRef<Animation | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const [holding, setHolding] = useState(false);

  const step = useCallback(function step(event: TimelineSwitchEvent) {
    const before = stateRef.current;
    let { state, effect } = stepTimelineSwitch(before, event, {
      reducedMotion: prefersReducedMotion(),
    });
    const host = hostRef.current;
    if (effect === "capture") {
      const picture = pictureRef.current;
      pictureRef.current = null;
      fadeRef.current?.cancel();
      fadeRef.current = null;
      if (host !== null && picture !== null && picture.key === before.key) {
        picture.frame.mount(host);
      } else {
        state = { ...state, freeze: null };
      }
    } else if (effect === "fade" && host !== null) {
      const fade = host.animate([{ opacity: 1 }, { opacity: 0 }], {
        ...CROSSFADE,
        fill: "forwards",
      });
      fadeRef.current = fade;
      fade.finished.then(
        () => {
          if (fadeRef.current === fade) step({ type: "faded" });
        },
        () => undefined,
      );
    } else if (effect === "remove") {
      fadeRef.current?.cancel();
      fadeRef.current = null;
      host?.replaceChildren();
    }
    stateRef.current = state;
    // Each picture held gets its own while; a picture giving way or gone
    // waits for nothing.
    if (holdRef.current !== null && (effect !== "none" || event.type === "switch")) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
    const held = event.type === "switch" || event.type === "placing";
    if (held && state.freeze !== null && !state.freeze.fading) {
      const key = state.key;
      holdRef.current = setTimeout(() => {
        holdRef.current = null;
        step({ type: "held-too-long", key });
      }, HOLD_AT_MOST_MS);
    }
    setHolding(state.freeze !== null);
  }, []);

  // A layer going takes a picture of itself while it still stands on the
  // page — only one the pane shows, and only when the person switches: the
  // pane closing takes nothing.
  const leave = useCallback((key: string, node: HTMLElement) => {
    const state = stateRef.current;
    if (closingRef.current || state.key !== key || !showsTimelineLayer(state)) return;
    pictureRef.current = { key, frame: captureFreezeFrame(node) };
  }, []);
  const painted = useCallback((key: string) => step({ type: "painted", key }), [step]);
  const waiting = useCallback((key: string) => step({ type: "waiting", key }), [step]);
  // Its Mate at work going for the rows is pictured the same way, unless a
  // picture is on its way up already (the layer going too).
  const placing = useCallback(
    (key: string, node: HTMLElement) => {
      const state = stateRef.current;
      if (closingRef.current || pictureRef.current !== null || state.key !== key) return;
      if (!state.waiting || state.freeze !== null) return;
      pictureRef.current = { key, frame: captureFreezeFrame(node) };
      step({ type: "placing", key });
    },
    [step],
  );

  useLayoutEffect(() => {
    if (stateRef.current.key !== switchKey) step({ type: "switch", to: switchKey });
  }, [step, switchKey]);

  useLayoutEffect(() => {
    closingRef.current = false;
    return () => {
      closingRef.current = true;
      if (holdRef.current !== null) clearTimeout(holdRef.current);
      holdRef.current = null;
      fadeRef.current?.cancel();
      fadeRef.current = null;
    };
  }, []);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-timeline-switch={holding ? "holding" : undefined}
    >
      <TimelineLayer
        key={switchKey}
        layerKey={switchKey}
        onLeave={leave}
        onPainted={painted}
        onPlacing={placing}
        onWaiting={waiting}
      >
        {children}
      </TimelineLayer>
      <div
        ref={hostRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-50 flex flex-col bg-background empty:hidden"
        data-timeline-freeze=""
        inert
      />
    </div>
  );
}

function TimelineLayer({
  layerKey,
  onLeave,
  onPainted,
  onPlacing,
  onWaiting,
  children,
}: {
  readonly layerKey: string;
  readonly onLeave: (key: string, node: HTMLElement) => void;
  readonly onPainted: (key: string) => void;
  readonly onPlacing: (key: string, node: HTMLElement) => void;
  readonly onWaiting: (key: string) => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Runs as the layer goes, before its conversation leaves the page.
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node !== null) onLeave(layerKey, node);
    };
  }, [layerKey, onLeave]);
  const layer = useMemo<TimelineSwitchLayer>(
    () => ({
      painted: () => onPainted(layerKey),
      waiting: () => onWaiting(layerKey),
      placing: () => {
        if (ref.current !== null) onPlacing(layerKey, ref.current);
      },
    }),
    [layerKey, onPainted, onPlacing, onWaiting],
  );
  return (
    <div ref={ref} className="relative flex min-h-0 flex-1 flex-col">
      <TimelineSwitchContext value={layer}>{children}</TimelineSwitchContext>
    </div>
  );
}
