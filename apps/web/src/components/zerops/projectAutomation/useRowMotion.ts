import { MOTION } from "@t3tools/shared/brand";
import { useLayoutEffect, useRef, type RefObject } from "react";

import { prefersReducedMotion } from "~/lib/reducedMotion";

/** How long a row whose state changed while the person watched stays lit: longer than the scale, so the eye finds it. */
const FLASH_MS = 600;

/** Where a row or a lane's heading stood after the last paint, in its list's own box. */
interface Stood {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  /** Its columns, for a copy of a row that left to stand in its list's columns. */
  readonly columns: string;
  readonly state: string;
  readonly node: HTMLElement;
}

/**
 * The Board's rows move instead of jumping, while the person watches: after every paint each row
 * (`data-zerops-task`, its state in `data-state`) and each lane's heading (`data-zerops-lane`) is
 * measured in the list's box; one that stood elsewhere slides from there (transform only), a row
 * that arrives fades in rising 4 px, one that leaves fades where it stood, and a row whose state
 * changed is lit once. Nothing moves on the first paint of a read Board (`ready`), nor under
 * reduced motion.
 */
export function useRowMotion(list: RefObject<HTMLElement | null>, ready: boolean): void {
  const stood = useRef<ReadonlyMap<string, Stood>>(new Map());
  const primed = useRef(false);
  useLayoutEffect(() => {
    const host = list.current;
    if (host === null || !ready) {
      stood.current = new Map();
      primed.current = false;
      return;
    }
    const moves = primed.current && !prefersReducedMotion();
    const box = host.getBoundingClientRect();
    const now = new Map<string, Stood>();
    for (const node of host.querySelectorAll<HTMLElement>(
      "[data-zerops-task], [data-zerops-lane]",
    )) {
      const key =
        node.dataset.zeropsTask === undefined
          ? `lane:${node.dataset.zeropsLane ?? ""}`
          : `task:${node.dataset.zeropsTask}`;
      const rect = node.getBoundingClientRect();
      const here: Stood = {
        top: rect.top - box.top,
        left: rect.left - box.left,
        width: rect.width,
        columns:
          node.dataset.zeropsTask === undefined ? "" : getComputedStyle(node).gridTemplateColumns,
        state: node.dataset.state ?? "",
        node,
      };
      now.set(key, here);
      if (!moves) continue;
      const before = stood.current.get(key);
      if (before === undefined) {
        node.animate(
          [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: MOTION.duration.base, easing: MOTION.easing.out },
        );
        continue;
      }
      if (Math.abs(before.top - here.top) >= 1)
        node.animate(
          [{ transform: `translateY(${String(before.top - here.top)}px)` }, { transform: "none" }],
          { duration: MOTION.duration.base, easing: MOTION.easing.out },
        );
      if (before.state !== here.state) flash(node);
    }
    if (moves)
      for (const [key, before] of stood.current) if (!now.has(key)) fadeWhereItStood(host, before);
    stood.current = now;
    primed.current = true;
  });
}

/** Lights a row's press once, in the picked ground, fading out. */
function flash(row: HTMLElement): void {
  const press = row.querySelector<HTMLElement>("[data-press]");
  if (press === null) return;
  const lit = getComputedStyle(press).getPropertyValue("--color-item-picked").trim();
  if (lit === "") return;
  press.animate([{ backgroundColor: lit }, { backgroundColor: "transparent" }], {
    duration: FLASH_MS,
    easing: MOTION.easing.out,
  });
}

/**
 * A row or heading the list no longer draws: a still copy of it stands where it stood and fades
 * out, so its place empties instead of vanishing.
 */
function fadeWhereItStood(host: HTMLElement, before: Stood): void {
  const ghost = before.node.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) return;
  ghost.removeAttribute("data-zerops-task");
  ghost.removeAttribute("data-zerops-lane");
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, {
    position: "absolute",
    top: `${String(before.top)}px`,
    left: `${String(before.left)}px`,
    width: `${String(before.width)}px`,
    ...(before.columns === "" ? {} : { gridTemplateColumns: before.columns }),
    margin: "0",
    pointerEvents: "none",
  });
  host.append(ghost);
  ghost
    .animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: MOTION.duration.quick,
      easing: MOTION.easing.out,
    })
    .addEventListener("finish", () => {
      ghost.remove();
    });
}
