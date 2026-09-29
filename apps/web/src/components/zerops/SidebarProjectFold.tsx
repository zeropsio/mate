/**
 * A project's rows as they unfold under its heading and fold back into it.
 *
 * The heading never moves (M9, T3): everything a project keeps — its rows and
 * the room after them (`projectRoom`) — is below it, so opening it only ever
 * pushes what is below. Folded, a project keeps a few px of room under its
 * heading (`SidebarProjectFoldedRoom`); opening grows the fold from that room
 * to its height as it fades in, over 220 ms on the menu's strong ease-out;
 * folding shrinks it back to that room in 160 ms on an ease-in-out, and only
 * then is it gone — so the room under the heading never jumps. A press in
 * the middle turns it round from wherever it stands. With reduced motion it
 * only fades in, and folds at once.
 *
 * A paint that nobody asked for — a reload, a project already open — moves
 * nothing: only a `motion` the heading's press set animates.
 */
import { useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { projectRoom } from "./SidebarProjects.logic";

/** Why a fold is moving: the heading was pressed to open it, or to fold it. */
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

/** The room below the rows, as the class that keeps it. */
const ROOM_CLASS: Record<number, string> = { 0: "pb-0", 16: "pb-4", 36: "pb-9" };

/** The room under a folded heading, as the class that keeps it; none at the list's end. */
const FOLDED_ROOM_CLASS: Record<number, string | undefined> = { 0: undefined, 12: "h-3" };

export function SidebarProjectFold({
  open,
  motion,
  last,
  onSettled,
  children,
}: {
  readonly open: boolean;
  /** What the heading's press set moving; `undefined` for a still paint. */
  readonly motion: ProjectFoldMotion | undefined;
  /** The list's last project, which keeps less room below it. */
  readonly last: boolean;
  /** The movement ended: folded shut, or all the way open. */
  readonly onSettled: () => void;
  readonly children: ReactNode;
}) {
  const fold = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const drawn = useRef(false);
  // The latest press's, read when the movement ends.
  const settled = useEffectEvent(onSettled);
  useLayoutEffect(() => {
    const firstPaint = !drawn.current;
    drawn.current = true;
    if (motion === undefined) return;
    const element = fold.current;
    const settle = () => {
      running.current = null;
      settled();
    };
    // Nothing to move where there is nothing drawn (a test's renderer).
    if (element === null || typeof element.animate !== "function") {
      settle();
      return;
    }
    // What a folded project keeps under its heading: where an unfold starts
    // and a fold ends, so the room there never jumps.
    const rest = projectRoom({ open: false, last });
    // Where it stands now, mid-movement included; a fold just drawn to open
    // starts from the room the folded heading kept.
    const from = firstPaint && open ? rest : element.getBoundingClientRect().height;
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
            { height: `${String(rest)}px`, opacity: 0 },
          ],
          FOLD,
        );
    running.current = animation;
    animation.onfinish = () => {
      if (running.current !== animation) return;
      if (open) element.style.overflow = "";
      settle();
    };
  }, [open, motion, last]);
  return (
    <div data-zerops-surface="sidebar-project-rows" ref={fold}>
      {/* The heading's 6 px before the first row, with the rows' own 10 px
          and the heading's 4 around its words: its title 20 px from its
          first Mate's name, as from the next heading while it is folded. */}
      <div className={cn("flex flex-col pt-1.5", ROOM_CLASS[projectRoom({ open: true, last })])}>
        {children}
      </div>
    </div>
  );
}

/**
 * What a folded project keeps under its heading once its rows have folded
 * away (`projectRoom`): the few px that set folded names apart, which an
 * unfold grows from. Nothing at the list's end.
 */
export function SidebarProjectFoldedRoom({ last }: { readonly last: boolean }) {
  const room = FOLDED_ROOM_CLASS[projectRoom({ open: false, last })];
  return room === undefined ? null : (
    <div
      aria-hidden="true"
      className={cn(room, "shrink-0")}
      data-zerops-surface="sidebar-project-room"
    />
  );
}
