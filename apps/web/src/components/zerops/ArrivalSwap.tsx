/**
 * One place that holds one state at a time, and hands over between them in place — the arrival's
 * headline, its sentence and its slot (`MateEmptyStateView`), and the sign-in's cards
 * (`ZeropsAgentSignIn`). What it held leaves as it was last drawn, fading where it stood (140 ms);
 * what it holds now arrives over it (180–200 ms, on the strong ease-out); and its height follows
 * the new state's in 240 ms, so whatever stands under it moves with it instead of jumping. A first
 * paint draws its state at once: only a change of state moves. Words travel 6 px, up out and up
 * in; a slot only fades. Under reduced motion only the fades remain.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";

/** How long a state takes to leave: its fade, and a frame to spare. */
const LEAVE_MS = 180;

/** How long the height takes to follow. */
const FOLLOW_MS = 240;

const EASE_OUT_STRONG = "cubic-bezier(0.23, 1, 0.32, 1)";

interface Layer {
  readonly id: string;
  readonly node: ReactNode;
}

export function ArrivalSwap({
  id,
  children,
  kind = "slot",
  className,
  style,
  domId,
  live,
  ...data
}: {
  /** The state in view: a change of it hands over. */
  readonly id: string;
  readonly children: ReactNode;
  /** Words travel as they fade; a slot only fades. */
  readonly kind?: "words" | "slot";
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Its element's own id, for what it describes: it stands through every hand-over. */
  readonly domId?: string | undefined;
  /** Said to a reader as it changes; what leaves is hidden from it. */
  readonly live?: "polite" | undefined;
} & { readonly [dataAttribute: `data-${string}`]: string | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  // What it drew last, so a state leaving leaves as it was.
  const drawn = useRef<Layer>({ id, node: children });
  const height = useRef<number | null>(null);
  const [shown, setShown] = useState<{
    readonly id: string;
    readonly leaving: ReadonlyArray<Layer>;
    readonly swapped: boolean;
  }>({ id, leaving: [], swapped: false });

  if (shown.id !== id) {
    const last = drawn.current;
    setShown({
      id,
      leaving: [...shown.leaving.filter((layer) => layer.id !== id && layer.id !== last.id), last],
      swapped: true,
    });
  }

  useLayoutEffect(() => {
    drawn.current = { id, node: children };
  });

  // The height follows the state in view, from where it stood.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const to = element.offsetHeight;
    const from = height.current;
    height.current = to;
    if (!shown.swapped || from === null || Math.abs(from - to) < 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: FOLLOW_MS,
      easing: EASE_OUT_STRONG,
    });
  }, [shown.id, shown.swapped]);

  // Growing or shrinking within a state is its own content's, and needs no following.
  useEffect(() => {
    const element = box.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (element.getAnimations().length === 0) height.current = element.offsetHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const leavingCount = shown.leaving.length;
  useEffect(() => {
    if (leavingCount === 0) return;
    const timer = window.setTimeout(() => {
      setShown((current) => ({ ...current, leaving: [] }));
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leavingCount, shown.id]);

  return (
    <div
      aria-live={live}
      className={cn("arrival-swap", className)}
      data-arrival-swap={kind}
      id={domId}
      ref={box}
      style={style}
      {...data}
    >
      {shown.leaving.map((layer) => (
        <div aria-hidden="true" data-swap-layer="leaving" inert key={layer.id}>
          {layer.node}
        </div>
      ))}
      <div data-swap-layer={shown.swapped ? "entering" : "shown"} key={id}>
        {children}
      </div>
    </div>
  );
}
