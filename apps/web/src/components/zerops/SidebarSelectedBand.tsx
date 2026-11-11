/**
 * The menu's one selected band (pass 16, M11, T2): a single surface in the
 * list, the row's own inset and corners, standing over the open Mate's unit —
 * its row and its crew's line, one thing in the menu (`MateUnit`), never the
 * changes under it. Opening another Mate slides it there, its four edges
 * together from the box it left to the box it arrives at, so the eye follows
 * the selection instead of one row going dark and another lighting up. Units
 * paint no background of their own for being open.
 *
 * A row under its project stands further in and is narrower, and rows differ
 * in height, so a slide changes the band's size as well as its place. Its
 * size is never animated: that runs with the page's own drawing, which the
 * page a press opens holds for a while, and the band's place — a transform,
 * which does not wait — went ahead of it, the band's right edge standing out
 * of the menu's inset until the size caught up (the owner, 2026-11-10: "the
 * bg is sticking out on the right and then abruptly going to its position").
 * It is four nested layers instead, each holding one corner of the box
 * (`bandLayers`), and a slide shifts them: transforms only, corners true.
 * Another Mate opened on the way leaves from where the band shows then. One
 * left out of the list's view is not flown in from there: the band is placed.
 *
 * It is placed after every draw, once the page is laid out and before paint,
 * and again whenever the list changes size — a row growing a line, a crew's line arriving, a project
 * unfolding above it — so it never lags a frame behind its unit
 * (`bandPlacement`). While its project folds it shrinks with the fold, and it
 * is gone once the unit is. The first paint places it where it belongs,
 * without moving; so does a unit coming back into view. With reduced motion
 * it is placed, never slid.
 */
import { MOTION } from "@t3tools/shared/brand";
import { useLayoutEffect, useRef } from "react";

import { carryChiefTo } from "./chief/chiefLitTravel";

import { shownBandBox } from "./selectedBandBox";
import {
  bandLayers,
  bandMove,
  bandPlacement,
  bandRoom,
  bandShows,
  type BandBox,
  type BandPlacement,
} from "./SidebarSelectedBand.logic";

/** The slide's own length: the app's slow step, on its strong ease-out. */
const SLIDE_MS = MOTION.duration.slow;

/** The mounted band's own move to a unit, for a press that lights a Mate before the menu draws. */
let pressTo: ((projectId: string) => void) | null = null;

/**
 * Slides the band to a pressed Mate's unit in the press's own frame (the owner, 2026-10-12: the
 * band "should extremely smoothly immediately move to the new item"): the menu's draw of the press
 * came 70–90 ms after the click. That draw finds the band on its way there and leaves it going.
 */
export function slideSelectedBandTo(projectId: string): void {
  // The pressed row lights at once, over its own hover, while the band slides in under it.
  const unit =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>(`[data-zerops-mate-unit="${CSS.escape(projectId)}"]`);
  if (unit !== null) {
    // From the Chief, its lit ground travels down to the pressed row (`chiefLitTravel`).
    carryChiefTo(unit);
    unit.dataset["bandArriving"] = "";
    setTimeout(() => {
      delete unit.dataset["bandArriving"];
    }, 600);
  }
  pressTo?.(projectId);
}

const boxOf = (element: Element): BandBox => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
};

/** The box the list shows through — its nearest ancestor that scrolls — or none where none does. */
function viewOf(list: Element): BandBox | null {
  for (let node = list.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return boxOf(node);
  }
  return null;
}

/** The band's four layers, outermost first (`bandLayers`). */
function layersOf(band: HTMLElement): ReadonlyArray<HTMLElement> {
  const layers: HTMLElement[] = [];
  for (
    let node = band.firstElementChild;
    node instanceof HTMLElement;
    node = node.firstElementChild
  )
    layers.push(node);
  return layers;
}

const shift = ({ x, y }: { readonly x: number; readonly y: number }): string =>
  `translate(${String(x)}px, ${String(y)}px)`;

const sameBox = (a: BandPlacement, b: BandPlacement): boolean =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

/**
 * Drawn inside the list it stands in — its parent, which its units are
 * measured from. Its own element is the one surely there when it places
 * itself: a parent's ref is attached only after its children's effects run.
 */
export function SidebarSelectedBand({
  current,
}: {
  /** The open Mate's project id; absent, no Mate is open. */
  readonly current: string | null | undefined;
}) {
  const band = useRef<HTMLSpanElement>(null);
  const key = useRef<string | undefined>(undefined);
  const last = useRef<
    { readonly key: string | undefined; readonly placement: BandPlacement | null } | undefined
  >(undefined);
  const slidingUntil = useRef(0);
  /** The slide under way: the boxes it leaves and lands on, its clock's start, its layers' runs. */
  const slide = useRef<{
    readonly from: BandPlacement;
    readonly to: BandPlacement;
    readonly began: CSSNumberish | null;
    readonly runs: ReadonlyArray<Animation>;
  } | null>(null);
  const place = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    place.current = () => {
      const element = band.current;
      const root = element?.parentElement ?? null;
      if (element === null || root === null) return;
      const open = key.current;
      const unit =
        open === undefined
          ? null
          : root.querySelector(`[data-zerops-mate-unit="${CSS.escape(open)}"]`);
      const fold = unit?.closest('[data-zerops-surface="sidebar-project-rows"]') ?? null;
      const list = boxOf(root);
      const placement = bandPlacement({
        list,
        unit: unit === null ? null : boxOf(unit),
        clip: fold === null ? null : boxOf(fold),
      });
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const move = bandMove(last.current, open, placement, reduced);
      last.current = { key: open, placement };
      const stop = () => {
        for (const run of slide.current?.runs ?? []) run.cancel();
        slide.current = null;
      };
      if (move === "hide" || placement === null) {
        stop();
        element.removeAttribute("data-on");
        element.removeAttribute("data-sliding");
        return;
      }
      const now = performance.now();
      const under = now < slidingUntil.current ? slide.current : null;
      // A draw in the middle of a slide — the conversation opening, the row marked read — finds
      // the band on its way and leaves it going.
      if (move === "place" && under !== null && !reduced && sameBox(under.to, placement)) return;
      // Another Mate opened: a slide from where the band shows now — read before anything is
      // written — unless that is out of the list's view, where it is placed. Its unit moved
      // under a slide — a fold opening above it, a line arriving: the slide keeps its clock and
      // the box it left, and lands where the unit now is.
      let from: BandPlacement | null = null;
      let began: CSSNumberish | null = null;
      if (move === "slide") {
        const shown = shownBandBox(element);
        if (bandShows(shown, viewOf(root))) {
          from = {
            top: shown.top - list.top,
            left: shown.left - list.left,
            width: shown.right - shown.left,
            height: shown.bottom - shown.top,
          };
        }
        slidingUntil.current = from === null ? 0 : now + SLIDE_MS;
      } else if (under !== null && !reduced) {
        from = under.from;
        began = under.began;
      }
      stop();
      const layers = layersOf(element);
      const room = from === null ? placement : bandRoom(from, placement);
      const settled = bandLayers(placement, placement, room).map(shift);
      element.style.transform = `translate(${String(placement.left)}px, ${String(placement.top)}px)`;
      element.style.width = `${String(placement.width)}px`;
      element.style.height = `${String(placement.height)}px`;
      const lead = layers[0];
      if (lead !== undefined) {
        lead.style.width = `${String(room.width)}px`;
        lead.style.height = `${String(room.height)}px`;
      }
      layers.forEach((layer, index) => {
        layer.style.transform = settled[index] ?? "";
      });
      if (from !== null && lead !== undefined && typeof lead.animate === "function") {
        const leaving = bandLayers(from, placement, room).map(shift);
        // One clock for the four, started this frame: they move as one, with nothing to wait for.
        const clock = began ?? lead.ownerDocument.timeline.currentTime;
        const runs = layers.map((layer, index) =>
          layer.animate(
            [{ transform: leaving[index] ?? "" }, { transform: settled[index] ?? "" }],
            {
              duration: SLIDE_MS,
              easing: MOTION.easing.out,
            },
          ),
        );
        if (clock !== null) for (const run of runs) run.startTime = clock;
        slide.current = { from, to: placement, began: clock, runs };
      }
      if (now < slidingUntil.current) element.setAttribute("data-sliding", "");
      else element.removeAttribute("data-sliding");
      element.setAttribute("data-on", "");
    };
  });

  const observer = useRef<ResizeObserver | null>(null);
  // The list's observer, made before the first draw is placed: that draw too is heard from it,
  // after the page is laid out. Placed in its own layout effect, the first draw of the menu
  // forced the style and layout of the whole page (20 ms at a load).
  useLayoutEffect(() => {
    const root = band.current?.parentElement ?? null;
    if (root === null || typeof ResizeObserver === "undefined") return;
    const watching = new ResizeObserver(() => {
      place.current();
    });
    observer.current = watching;
    watching.observe(root);
    return () => {
      watching.disconnect();
      observer.current = null;
    };
  }, []);

  // After every draw of the menu, before it paints, and whenever the list
  // changes size without a draw of its own: a crew's line arriving, a
  // project's fold opening, a font settling. Both are heard from the list's
  // ResizeObserver, which the browser calls once it has laid the page out and
  // before it paints, so reading the boxes costs no layout of its own: read
  // in the draw's layout effect, they forced the style and layout of the whole
  // page (~2,000 elements) on every click of a menu row, before the rest of
  // the draw had even been written. Observing the list anew asks for one
  // call after this draw's layout, as observing it does the first time.
  useLayoutEffect(() => {
    key.current = current ?? undefined;
    const root = band.current?.parentElement ?? null;
    if (observer.current === null || root === null) {
      place.current();
      return;
    }
    observer.current.unobserve(root);
    observer.current.observe(root);
  });

  useLayoutEffect(() => {
    const move = (projectId: string) => {
      key.current = projectId;
      place.current();
    };
    pressTo = move;
    return () => {
      if (pressTo === move) pressTo = null;
    };
  }, []);

  return (
    <span
      aria-hidden="true"
      className="menu-band"
      data-zerops-surface="sidebar-selected-band"
      ref={band}
    >
      <span className="menu-band-layer">
        <span className="menu-band-layer">
          <span className="menu-band-layer">
            <span className="menu-band-layer" />
          </span>
        </span>
      </span>
    </span>
  );
}
