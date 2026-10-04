/**
 * Boxes in a run's card whose height eases to what they hold (pass 39): the
 * history's scroll as lines join it, the live slot as its rows come and go, a
 * bubble or a card of calls as what it holds grows. What a box holds is laid
 * out at once; the box shows the height it showed before and eases from
 * there on `approach`'s curve, retargeted from wherever it stands when what
 * it holds changes again. Inside the box nothing moves: what grew is
 * uncovered at its foot, and what stands under the box rides its edge,
 * because the layout carries it.
 *
 * A change is heard as the page's code makes it, before the browser lays the
 * page out (a MutationObserver), so the box takes its old height before any
 * frame — or the conversation's list, which measures its rows — sees the new
 * one. The innermost box that changed eases; one holding it keeps the height
 * that box shows, and follows it as laid out, so two eases never stack.
 *
 * Boxes ease only while `eases()` says so — a live run watched as it goes; a
 * first paint, a resync, a settled run or reduced motion take their height
 * at once.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";

import { PERSON_INPUT_MS, ROOM_TAU_MS, approach } from "./runMotion.logic";

export interface Rooms {
  /**
   * How much taller the root will stand once it has eased than what it holds
   * will have grown by then: what a scroll at its foot will not need to scroll.
   */
  readonly pending: () => number;
  /**
   * Hears what changed since, now: called in a layout effect, a box takes its
   * old height before the conversation's list measures the rows in the same
   * commit.
   */
  readonly flush: () => void;
  /**
   * `element` — a box under the root, drawn this commit — eases from `height`
   * to its own: a line landing from the live slot grows from the height it
   * showed there.
   */
  readonly easeFrom: (element: HTMLElement, height: number) => void;
  /** Whether a box eases this moment. */
  readonly easing: () => boolean;
  /** Stops easing: every box takes its own height. */
  readonly stop: () => void;
}

/** Said on a box while it holds a height of its own: what it holds is read without it. */
const EASING = "data-room-easing";

/**
 * Where each run's scroll that follows its foot last stood, as its own code
 * put it or read it (`noteScrollTop`). A change laid out before a box takes
 * its old height — a row leaving the slot frees room the card gives the
 * history at once — makes the browser clamp the scroll down, and it keeps
 * that clamp: once the boxes hold their heights, it is put back.
 */
const scrollTops = new WeakMap<Element, number>();

/** A run's scroll stands at `scroll.scrollTop` by its own code's doing or the person's. */
export function noteScrollTop(scroll: HTMLElement): void {
  scrollTops.set(scroll, scroll.scrollTop);
}

/** Puts back the following scrolls of the card around `element` the browser clamped down. */
function unclamp(element: HTMLElement): void {
  // A move the person just made is theirs to keep.
  if (personActedWithin(PERSON_INPUT_MS)) return;
  const card = element.closest("[data-run-chat]") ?? element;
  for (const scroll of card.querySelectorAll<HTMLElement>("[data-run-scroll][data-follows]")) {
    const top = scrollTops.get(scroll);
    if (top !== undefined && scroll.scrollTop < top - 0.5) scroll.scrollTop = top;
  }
}

/** Said on the root of a set of rooms: what holds it leaves what changes inside to it. */
const ROOM_ROOT = "data-room-root";

/** Hides what a growing box does not show yet, below its edge only: rings and marks beside it stay. */
const CLIP_BELOW = "inset(-48px -96px -2px -96px)";

/** Rooms that never ease: drawn outside a page (a test's renderer). */
const STILL: Rooms = {
  pending: () => 0,
  easeFrom: () => undefined,
  flush: () => undefined,
  easing: () => false,
  stop: () => undefined,
};

interface Box {
  readonly element: HTMLElement;
  readonly clips: boolean;
  /** The height it shows while it eases; null: its own. */
  shown: number | null;
  target: number;
  /** Its height as last laid out at rest: where an ease starts. */
  rested: number;
}

export function easeRooms({
  root,
  selector,
  eases,
  rootClips = false,
  attributes = [],
}: {
  /** A box itself, and what holds the others. */
  readonly root: HTMLElement;
  /** The boxes under it that ease too, each from when it is first drawn. */
  readonly selector: string;
  readonly eases: () => boolean;
  /** Whether the root hides what it does not show yet; a scroll scrolls it instead. */
  readonly rootClips?: boolean;
  /** Attributes of what it holds that change its height, besides a class, `hidden` and `open`. */
  readonly attributes?: ReadonlyArray<string>;
}): Rooms {
  if (
    typeof ResizeObserver === "undefined" ||
    typeof MutationObserver === "undefined" ||
    typeof requestAnimationFrame !== "function" ||
    typeof HTMLElement === "undefined" ||
    !(root instanceof HTMLElement)
  ) {
    return STILL;
  }
  const boxes = new Map<Node, Box>();
  let frame = 0;
  let last = 0;
  const heightOf = (element: HTMLElement) => element.getBoundingClientRect().height;
  const show = (box: Box, height: number | null) => {
    box.shown = height;
    box.element.style.height = height === null ? "" : `${height}px`;
    if (box.clips) box.element.style.clipPath = height === null ? "" : CLIP_BELOW;
    box.element.toggleAttribute(EASING, height !== null);
  };
  /**
   * The box's height as laid out with what it holds, the boxes inside it as
   * they show — and the boxes holding it, of any set, let go for the reading,
   * so a height they hold for a moment never squeezes it.
   */
  const natural = (box: Box) => {
    const held: Array<readonly [HTMLElement, string]> = [];
    for (
      let holder = box.element.parentElement?.closest<HTMLElement>(`[${EASING}]`) ?? null;
      holder !== null;
      holder = holder.parentElement?.closest<HTMLElement>(`[${EASING}]`) ?? null
    ) {
      held.push([holder, holder.style.height]);
      holder.style.height = "";
    }
    const own = box.element.style.height;
    box.element.style.height = "";
    const height = heightOf(box.element);
    box.element.style.height = own;
    for (const [holder, height] of held) holder.style.height = height;
    // The reading laid the card out without these heights for a moment.
    unclamp(box.element);
    return height;
  };
  const release = (box: Box) => {
    show(box, null);
    box.rested = heightOf(box.element);
  };
  const step = (now: number) => {
    frame = 0;
    const dt = last === 0 ? 1000 / 60 : now - last;
    last = now;
    let easing = false;
    for (const box of boxes.values()) {
      if (box.shown === null) continue;
      // What it holds may have moved on since (a box inside it easing, a
      // height animated in it): it eases to that.
      box.target = natural(box);
      const next = approach(box.shown, box.target, dt, ROOM_TAU_MS);
      if (next === box.target) {
        release(box);
      } else {
        show(box, next);
        easing = true;
      }
    }
    if (easing) frame = requestAnimationFrame(step);
    else last = 0;
  };
  /** What `box` holds changed: it eases from what it showed to its new height. */
  const heard = (box: Box) => {
    const height = natural(box);
    if (!eases() || prefersReducedMotion() || outOfSight()) {
      if (box.shown !== null) release(box);
      else box.rested = height;
      return;
    }
    const from = box.shown ?? box.rested;
    if (Math.abs(height - from) < 1) {
      if (box.shown === null) box.rested = height;
      return;
    }
    box.target = height;
    // Before anything lays the page out: it shows what it showed.
    if (box.shown === null) show(box, from);
    if (frame === 0) frame = requestAnimationFrame(step);
  };
  // A box at rest laid out anew for a reason no code of the page gave (its
  // shared height, the width, a font) is where its next ease starts.
  const sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const box = boxes.get(entry.target);
      if (box !== undefined && box.shown === null) box.rested = heightOf(box.element);
    }
  });
  const add = (element: HTMLElement, clips: boolean) => {
    if (boxes.has(element)) return;
    boxes.set(element, { element, clips, shown: null, target: 0, rested: heightOf(element) });
    sizes.observe(element);
  };
  add(root, rootClips);
  for (const element of root.querySelectorAll<HTMLElement>(selector)) add(element, true);
  const hear = (records: ReadonlyArray<MutationRecord>) => {
    const touched = new Set<Box>();
    for (const record of records) {
      // What changed inside another set of rooms is theirs: it shows here as
      // their box easing, laid out.
      const at = record.target instanceof Element ? record.target : record.target.parentElement;
      const owner = at?.closest(`[${ROOM_ROOT}]`) ?? null;
      if (owner !== null && owner !== root && root.contains(owner)) continue;
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(selector)) add(node, true);
        for (const element of node.querySelectorAll<HTMLElement>(selector)) add(element, true);
      }
      // Every box holding what changed, up to the root.
      for (let node: Node | null = record.target; node !== null; node = node.parentNode) {
        const box = boxes.get(node);
        if (box !== undefined) touched.add(box);
        if (node === root) break;
      }
    }
    for (const [element, box] of boxes) {
      if (box.element.isConnected) continue;
      sizes.unobserve(box.element);
      boxes.delete(element);
      touched.delete(box);
    }
    // The innermost first: one holding it then hears it at the height it shows.
    const order = [...touched].sort((a, b) => depthOf(b.element) - depthOf(a.element));
    for (const box of order) heard(box);
    // Once every set has heard it (the observers' turn ends first).
    if (order.length > 0) queueMicrotask(() => unclamp(root));
  };
  const changes = new MutationObserver(hear);
  changes.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "open", ...attributes],
  });
  root.setAttribute(ROOM_ROOT, "");
  const rootBox = boxes.get(root)!;
  return {
    pending: () => {
      let pending = rootBox.shown === null ? 0 : rootBox.target - rootBox.shown;
      for (const box of boxes.values()) {
        if (box !== rootBox && box.shown !== null) pending -= box.target - box.shown;
      }
      return pending;
    },
    easeFrom: (element, height) => {
      const records = changes.takeRecords();
      if (records.length > 0) hear(records);
      if (!root.contains(element)) return;
      if (!boxes.has(element)) add(element, true);
      const box = boxes.get(element)!;
      if (box.shown !== null) return;
      box.rested = height;
      heard(box);
    },
    easing: () => frame !== 0,
    flush: () => {
      const records = changes.takeRecords();
      if (records.length > 0) hear(records);
    },
    stop: () => {
      root.removeAttribute(ROOM_ROOT);
      changes.disconnect();
      sizes.disconnect();
      cancelAnimationFrame(frame);
      for (const box of boxes.values()) if (box.shown !== null) show(box, null);
      boxes.clear();
    },
  };
}

function depthOf(element: Element): number {
  let depth = 0;
  for (let node = element.parentElement; node !== null; node = node.parentElement) depth += 1;
  return depth;
}

/** When the person last gave the page an input that can scroll; heard from the first room on. */
let lastInputAt = Number.NEGATIVE_INFINITY;
let inputHeard = false;

function personActedWithin(ms: number): boolean {
  if (!inputHeard && typeof document !== "undefined") {
    inputHeard = true;
    const heard = () => {
      lastInputAt = performance.now();
    };
    for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) {
      document.addEventListener(type, heard, { capture: true, passive: true });
    }
  }
  return performance.now() - lastInputAt <= ms;
}

/** A tab out of sight: nobody watches a box ease. */
function outOfSight(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A box of its own — a card outside a run's chat, as what runs in the
 * background comes and goes — whose height eases (`easeRooms`) from its
 * first draw on, while `eases`. Returns the ref to put on it.
 */
export function useEasedRoom<T extends HTMLElement>(eases: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const easesRef = useRef(eases);
  const roomsRef = useRef<Rooms | null>(null);
  useLayoutEffect(() => {
    easesRef.current = eases;
  }, [eases]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const rooms = easeRooms({
      root,
      selector: ":not(*)",
      eases: () => easesRef.current,
      rootClips: true,
    });
    roomsRef.current = rooms;
    return () => {
      rooms.stop();
      roomsRef.current = null;
    };
  }, []);
  // Every commit, before the list's row measures it in its own.
  useLayoutEffect(() => roomsRef.current?.flush());
  return ref;
}
