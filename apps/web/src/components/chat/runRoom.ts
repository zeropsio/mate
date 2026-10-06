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

import {
  type EaseBudget,
  PERSON_INPUT_MS,
  ROOM_TAU_MS,
  approach,
  spendStep,
} from "./runMotion.logic";

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
 * Where each run's scroll last stood, as its own code put it or read it
 * (`noteScrollTop`). A change laid out before a box takes its old height —
 * a row leaving the slot frees room the card gives the history at once —
 * makes the browser clamp the scroll down, and it keeps that clamp: once the
 * boxes hold their heights, it is put back (`clamps`).
 */
const scrollTops = new Map<HTMLElement, number>();

/** A run's scroll stands at `scroll.scrollTop` by its own code's doing or the person's. */
export function noteScrollTop(scroll: HTMLElement): void {
  scrollTops.set(scroll, scroll.scrollTop);
}

/** A run's scroll leaves the page: nothing keeps it. */
export function forgetScrollTop(scroll: HTMLElement): void {
  scrollTops.delete(scroll);
  clamps.delete(scroll);
}

/**
 * The scrolls a draw clamped, by the top it clamped each to: heard as the
 * draw's change is, before any box takes its old height back. Only those are
 * put back (`unclamp`): a move of the page's with no input — a find in page,
 * Tab into the card, a screen reader — leaves its scroll above its furthest
 * top, never at it, and stands (the p43 final check: a word arriving in the
 * same task as a find undid it).
 */
const clamps = new Map<HTMLElement, number>();

/**
 * Notes the scrolls in `card` that a draw clamped — standing at their
 * furthest top, below where they last stood — and returns where each stands,
 * so what the boxes clamp as they take their old heights back is noted too
 * (`clampedSince`).
 */
function markClamps(card: Element): ReadonlyArray<readonly [HTMLElement, number]> {
  return scrollsIn(card).map((scroll) => {
    const top = scroll.scrollTop;
    const furthest = scroll.scrollHeight - scroll.clientHeight;
    if (top < scrollTops.get(scroll)! - 0.5 && Math.abs(top - furthest) <= 1)
      clamps.set(scroll, top);
    return [scroll, top] as const;
  });
}

/** Notes the scrolls the boxes' own holding moved down since `stood`: their own clamp, in this one turn. */
function clampedSince(stood: ReadonlyArray<readonly [HTMLElement, number]>): void {
  for (const [scroll, top] of stood) {
    const now = scroll.scrollTop;
    if (now < top - 0.5 && now < scrollTops.get(scroll)! - 0.5) clamps.set(scroll, now);
  }
}

/**
 * Puts back the following scrolls of the card around `element` that a draw
 * clamped down, still where the clamp left them: read from the few scrolls
 * noted, never by walking the card, which a long run fills with thousands of
 * rows.
 */
export function unclamp(element: HTMLElement): void {
  // Drawn outside a page (a test's stand-in), nothing laid it out.
  if (typeof element.closest !== "function") return;
  const card = cardOf(element);
  for (const scroll of scrollsIn(card)) {
    const clamped = clamps.get(scroll);
    if (clamped === undefined) continue;
    clamps.delete(scroll);
    // A move the person just made in the card is theirs to keep; typing in
    // the composer is no move of it.
    if (personActedWithin(PERSON_INPUT_MS, card)) continue;
    if (!scroll.hasAttribute("data-follows") || Math.abs(scroll.scrollTop - clamped) > 0.5)
      continue;
    scroll.scrollTop = scrollTops.get(scroll)!;
  }
}

/** The run's card around `element`, or itself outside one. */
function cardOf(element: HTMLElement): Element {
  return element.closest("[data-run-chat]") ?? element;
}

/** The noted scrolls in `card`; one gone from the page is forgotten. */
function scrollsIn(card: Element): HTMLElement[] {
  const scrolls: HTMLElement[] = [];
  for (const scroll of scrollTops.keys()) {
    if (!scroll.isConnected) {
      scrollTops.delete(scroll);
      clamps.delete(scroll);
    } else if (card.contains(scroll)) scrolls.push(scroll);
  }
  return scrolls;
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
  /**
   * Changed while nobody could see it (`away`), unread: what it showed then
   * is unknown, so the next change heard in sight takes its height at once.
   */
  stale: boolean;
}

export function easeRooms({
  root,
  selector,
  eases,
  rootClips = false,
  attributes = [],
  budget = null,
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
  /** The speed a frame gives the eases of its card together (`spendStep`). */
  readonly budget?: EaseBudget | null;
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
    // Read before any height is let go: the reading lays the card out
    // without them for a moment, and the browser clamps its scrolls to that.
    const tops = scrollsIn(cardOf(box.element)).map(
      (scroll) => [scroll, scroll.scrollTop] as const,
    );
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
    // Each scroll is put back where it stood: the clamp was this reading's
    // own layout, never the person's move (the p43 verification: a keydown
    // in the composer left the clamp, read next as a move of theirs, and the
    // history stopped following). Not while the person moves it — a write
    // cuts a smooth scroll of theirs short (PageUp, a wheel's tick), and the
    // clamp is then read with their move.
    const card = cardOf(box.element);
    for (const [scroll, top] of tops) {
      if (scroll.scrollTop !== top && !personActedWithin(PERSON_INPUT_MS, card)) {
        scroll.scrollTop = top;
      }
    }
    return height;
  };
  const release = (box: Box) => {
    show(box, null);
    box.rested = heightOf(box.element);
  };
  /**
   * Nobody sees the card: a tab out of sight, or a conversation's list kept
   * out of sight (`KeptTimelines`), which may not even be laid out. Its boxes
   * read nothing — a reading there lays out a list nobody shows — and let go
   * of any height they held.
   */
  const away = () => outOfSight() || root.closest("[data-kept-timeline]") !== null;
  const letGo = (box: Box) => {
    if (box.shown !== null) show(box, null);
    box.stale = true;
  };
  const step = (now: number) => {
    frame = 0;
    if (away()) {
      for (const box of boxes.values()) if (box.shown !== null) letGo(box);
      last = 0;
      return;
    }
    const dt = last === 0 ? 1000 / 60 : now - last;
    last = now;
    let easing = false;
    for (const box of boxes.values()) {
      if (box.shown === null) continue;
      // What it holds may have moved on since (a box inside it easing, a
      // height animated in it): it eases to that.
      box.target = natural(box);
      const eased = approach(box.shown, box.target, dt, ROOM_TAU_MS);
      // What is left of the frame's speed, shared with the card's other eases.
      const taken =
        budget === null ? eased - box.shown : spendStep(budget, now, dt, eased - box.shown);
      const next = taken === box.target - box.shown ? box.target : box.shown + taken;
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
    if (box.stale) {
      // What it showed while nobody saw it is not known: it is simply there.
      box.stale = false;
      if (box.shown !== null) release(box);
      else box.rested = natural(box);
      return;
    }
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
    boxes.set(element, {
      element,
      clips,
      shown: null,
      target: 0,
      rested: heightOf(element),
      stale: false,
    });
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
    if (touched.size > 0 && away()) {
      for (const box of touched) letGo(box);
      return;
    }
    // The innermost first: one holding it then hears it at the height it shows.
    const order = [...touched].sort((a, b) => depthOf(b.element) - depthOf(a.element));
    // What the draw clamped, read before any box takes its old height back,
    // and what the boxes clamp taking it back while another set's do not yet
    // hold theirs (the history's lines held before the slot's room).
    const stood = order.length > 0 ? markClamps(cardOf(root)) : [];
    for (const box of order) heard(box);
    clampedSince(stood);
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

/** Where the person last gave the page an input that can scroll. */
let lastInputTarget: EventTarget | null = null;

/** When the person last gave the page an input that can scroll; heard from the first room on. */
let lastInputAt = Number.NEGATIVE_INFINITY;
let inputHeard = false;

function personActedWithin(ms: number, card: Element): boolean {
  if (!inputHeard && typeof document !== "undefined") {
    inputHeard = true;
    const heard = (event: Event) => {
      lastInputAt = performance.now();
      lastInputTarget = event.target;
    };
    for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) {
      document.addEventListener(type, heard, { capture: true, passive: true });
    }
  }
  return (
    performance.now() - lastInputAt <= ms &&
    lastInputTarget instanceof Node &&
    card.contains(lastInputTarget)
  );
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
