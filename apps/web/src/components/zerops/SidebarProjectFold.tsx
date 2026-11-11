/**
 * A group's Mates as they unfold under its row and fold back into it.
 *
 * The group's row never moves (M9, T3): its Mates are below it, so opening it only ever pushes
 * what is below. Opening grows the fold from nothing to its height as it fades in, over 220 ms on
 * the menu's strong ease-out; folding shrinks it back in 160 ms on an ease-in-out, and only then
 * is it gone. A press in the middle turns it round from wherever it stands. With reduced motion
 * it only fades in, and folds at once.
 *
 * Once it has opened, the group's owner is told (`onOpened`) so it can bring the Mates into view.
 *
 * A paint that nobody asked for — a reload, a group already open — moves nothing: only a
 * `motion` the row's press set animates.
 */
import { useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react";

/** Why a fold is moving: the group's row was pressed to open it, or to fold it. */
export type ProjectFoldMotion = "opening" | "closing";

const UNFOLD: KeyframeAnimationOptions = {
  duration: 220,
  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
};
const FOLD: KeyframeAnimationOptions = {
  duration: 160,
  easing: "cubic-bezier(0.4, 0, 0.6, 1)",
  fill: "forwards",
};

export function SidebarProjectFold({
  open,
  motion,
  onSettled,
  onOpened,
  children,
}: {
  readonly open: boolean;
  /** What the row's press set moving; `undefined` for a still paint. */
  readonly motion: ProjectFoldMotion | undefined;
  /** The movement ended: folded shut, or all the way open. */
  readonly onSettled: () => void;
  /** An opening press's fold stands all the way open: its drawn rows. */
  readonly onOpened: (rows: HTMLElement) => void;
  readonly children: ReactNode;
}) {
  const fold = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const drawn = useRef(false);
  // The latest press's, read when the movement ends.
  const settled = useEffectEvent(onSettled);
  const opened = useEffectEvent(onOpened);
  useLayoutEffect(() => {
    const firstPaint = !drawn.current;
    drawn.current = true;
    if (motion === undefined) return;
    const element = fold.current;
    const settle = () => {
      running.current = null;
      if (open && element !== null) opened(element);
      settled();
    };
    // Nothing to move where there is nothing drawn (a test's renderer).
    if (element === null || typeof element.animate !== "function") {
      settle();
      return;
    }
    // Where it stands now, mid-movement included; a fold just drawn to open starts from nothing.
    const from = firstPaint && open ? 0 : element.getBoundingClientRect().height;
    // Cancelling rejects its finished promise; nothing waits on it.
    running.current?.finished.catch(() => undefined);
    running.current?.cancel();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!open && reduced) {
      settle();
      return;
    }
    element.style.overflow = "hidden";
    const animation = open
      ? element.animate(
          reduced
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { height: `${String(from)}px`, opacity: 0 },
                { height: `${String(element.getBoundingClientRect().height)}px`, opacity: 1 },
              ],
          UNFOLD,
        )
      : element.animate(
          [
            { height: `${String(from)}px`, opacity: 1 },
            { height: "0px", opacity: 0 },
          ],
          FOLD,
        );
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      if (open) element.style.overflow = "";
      settle();
    };
  }, [open, motion]);
  return (
    <div data-zerops-surface="sidebar-project-rows" ref={fold}>
      {/* The list's own 6 px between rows, before the first of its Mates too. */}
      <div className="flex flex-col gap-1.5 pt-1.5" data-zerops-kids="">
        {children}
      </div>
    </div>
  );
}
