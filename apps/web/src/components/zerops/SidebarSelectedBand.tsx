/**
 * The menu's one selected band (pass 16, M11, T2): a single surface in the
 * list, the row's own inset and corners, standing over the open Mate's unit —
 * its row and its crew's line, one thing in the menu (`MateUnit`), never the
 * changes under it. Opening another Mate slides it there on a spring over
 * 300 ms — transform and height, never `top` — so the eye follows the
 * selection instead of one row going dark and another lighting up. Units
 * paint no background of their own for being open.
 *
 * It is placed after every draw, once the page is laid out and before paint,
 * and again whenever the list changes size — a row growing a line, a crew's line arriving, a project
 * unfolding above it — so it never lags a frame behind its unit
 * (`bandPlacement`). While its project folds it shrinks with the fold, and it
 * is gone once the unit is. The first paint places it where it belongs,
 * without moving; so does a unit coming back into view. With reduced motion
 * it is placed, never slid.
 */
import { useLayoutEffect, useRef } from "react";

import {
  bandMove,
  bandPlacement,
  type BandBox,
  type BandPlacement,
} from "./SidebarSelectedBand.logic";

/** The slide's own length, which `.menu-band[data-sliding]` runs for. */
const SLIDE_MS = 300;

const boxOf = (element: Element): BandBox => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
};

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
      const placement = bandPlacement({
        list: boxOf(root),
        unit: unit === null ? null : boxOf(unit),
        clip: fold === null ? null : boxOf(fold),
      });
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const move = bandMove(last.current, open, placement, reduced);
      last.current = { key: open, placement };
      if (move === "hide" || placement === null) {
        element.removeAttribute("data-on");
        element.removeAttribute("data-sliding");
        return;
      }
      // A draw in the middle of a slide — the conversation opening, the row
      // marked read — turns it toward where the unit now is, still sliding.
      const now = performance.now();
      if (move === "slide") slidingUntil.current = now + SLIDE_MS;
      if (now < slidingUntil.current) element.setAttribute("data-sliding", "");
      else element.removeAttribute("data-sliding");
      element.style.transform = `translate(${String(placement.left)}px, ${String(placement.top)}px)`;
      element.style.width = `${String(placement.width)}px`;
      element.style.height = `${String(placement.height)}px`;
      element.setAttribute("data-on", "");
    };
  });

  // After every draw of the menu, before it paints, and whenever the list
  // changes size without a draw of its own: a crew's line arriving, a
  // project's fold opening, a font settling. Both are heard from the list's
  // ResizeObserver, which the browser calls once it has laid the page out and
  // before it paints, so reading the boxes costs no layout of its own: read
  // in the draw's layout effect, they forced the style and layout of the whole
  // page (~2,000 elements) on every click of a menu row, before the rest of
  // the draw had even been written. Observing the list anew asks for one
  // call after this draw's layout, as observing it does the first time.
  const observer = useRef<ResizeObserver | null>(null);
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

  return (
    <span
      aria-hidden="true"
      className="menu-band"
      data-zerops-surface="sidebar-selected-band"
      ref={band}
    />
  );
}
