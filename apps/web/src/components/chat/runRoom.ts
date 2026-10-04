/**
 * A box in a run's card whose height eases to what its content needs (pass
 * 39): the history's scroll as lines join it, the live slot as its rows come
 * and go, a bubble or a card of calls as what it holds grows. What the content
 * needs is laid out at once; the box shows the height it showed a frame ago
 * and eases from there on `approach`'s curve, retargeted from wherever it
 * stands when the content changes again. Inside the box nothing moves: what
 * grew is uncovered at its foot, and what stands under the box rides its
 * edge, because the layout carries it.
 *
 * The innermost box that changed eases; one holding a box that eases follows
 * it as laid out, so two eases never stack. A box eases only while `eases()`
 * says so — a live run watched as it goes; a first paint, a resync, a settled
 * run or reduced motion take their height at once.
 */
import { ROOM_TAU_MS, approach } from "./runMotion.logic";

export interface Room {
  /** How much taller the box will stand once it has eased: what a scroll at its foot will not need to scroll. */
  readonly pending: () => number;
  /** Stops easing: the box takes its own height. */
  readonly stop: () => void;
}

/** Said on a box while it eases: what holds it follows it as laid out. */
const EASING = "data-room-easing";

/** Hides what a growing box does not show yet, below its edge only: rings and marks beside it stay. */
const CLIP_BELOW = "inset(-48px -96px -2px -96px)";

/** A box that never eases: drawn outside a page (a test's renderer). */
const STILL: Room = { pending: () => 0, stop: () => undefined };

export function easeRoom({
  box,
  content = null,
  eases,
  clips = false,
}: {
  readonly box: HTMLElement;
  /**
   * What the box holds, at its own height: its changes are what the box
   * eases to. Null: the box's own children, each heard as it changes, comes
   * or goes.
   */
  readonly content?: HTMLElement | null;
  readonly eases: () => boolean;
  /** Whether the box hides what it does not show yet; a scroll scrolls it instead. */
  readonly clips?: boolean;
}): Room {
  if (
    typeof ResizeObserver === "undefined" ||
    typeof requestAnimationFrame !== "function" ||
    typeof HTMLElement === "undefined" ||
    !(box instanceof HTMLElement)
  ) {
    return STILL;
  }
  // The height the box shows while it eases (null: its own), and the height it eases to.
  let shown: number | null = null;
  let target = 0;
  // Its height as last laid out at rest: where an ease starts.
  let rested: number | null = null;
  let frame = 0;
  let last = 0;
  const natural = () => {
    if (shown === null) return box.getBoundingClientRect().height;
    box.style.height = "";
    const height = box.getBoundingClientRect().height;
    box.style.height = `${shown}px`;
    return height;
  };
  const release = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    shown = null;
    box.style.height = "";
    if (clips) box.style.clipPath = "";
    box.removeAttribute(EASING);
    rested = box.getBoundingClientRect().height;
  };
  const step = (now: number) => {
    frame = 0;
    if (shown === null) return;
    shown = approach(shown, target, last === 0 ? 1000 / 60 : now - last, ROOM_TAU_MS);
    last = now;
    if (shown === target) {
      release();
      return;
    }
    box.style.height = `${shown}px`;
    frame = requestAnimationFrame(step);
  };
  const heard = () => {
    const height = natural();
    // A box inside it eases, and it follows as laid out.
    const inner = shown === null && box.querySelector(`[${EASING}]`) !== null;
    if (inner || !eases() || prefersReducedMotion()) {
      if (shown !== null) release();
      rested = height;
      return;
    }
    const from = shown ?? rested;
    if (from === null || Math.abs(height - from) < 1) {
      if (shown === null) rested = height;
      return;
    }
    target = height;
    if (shown === null) {
      shown = from;
      last = 0;
      // Before this frame paints: it shows what it showed, and eases from there.
      box.style.height = `${shown}px`;
      if (clips) box.style.clipPath = CLIP_BELOW;
      box.setAttribute(EASING, "");
    }
    if (frame === 0) frame = requestAnimationFrame(step);
  };
  // The box alone changing at rest (the card's shared height giving it more
  // or less room) is where the next ease starts; what it holds changing is one.
  const observer = new ResizeObserver((entries) => {
    if (entries.some((entry) => entry.target !== box)) heard();
    else if (shown === null) rested = box.getBoundingClientRect().height;
  });
  observer.observe(box);
  let children: MutationObserver | null = null;
  if (content !== null) {
    observer.observe(content);
  } else {
    for (const child of box.children) observer.observe(child);
    children = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) observer.observe(node);
        for (const node of record.removedNodes)
          if (node instanceof Element) observer.unobserve(node);
      }
      heard();
    });
    children.observe(box, { childList: true });
  }
  return {
    pending: () => (shown === null ? 0 : target - shown),
    stop: () => {
      observer.disconnect();
      children?.disconnect();
      if (shown !== null) release();
    },
  };
}

/**
 * Every box under `root` matching `selector` eases its height (`easeRoom`),
 * each from when it is first drawn — its first height is simply there — until
 * it leaves the page. Returns what stops them all.
 */
export function easeRoomsUnder({
  root,
  selector,
  eases,
}: {
  readonly root: HTMLElement;
  readonly selector: string;
  readonly eases: () => boolean;
}): () => void {
  if (
    typeof MutationObserver === "undefined" ||
    typeof HTMLElement === "undefined" ||
    !(root instanceof HTMLElement)
  ) {
    return () => undefined;
  }
  const rooms = new Map<HTMLElement, Room>();
  const take = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    const boxes = node.matches(selector) ? [node] : [];
    boxes.push(...node.querySelectorAll<HTMLElement>(selector));
    for (const box of boxes) {
      if (!rooms.has(box)) rooms.set(box, easeRoom({ box, eases, clips: true }));
    }
  };
  const drop = () => {
    for (const [box, room] of rooms) {
      if (box.isConnected) continue;
      room.stop();
      rooms.delete(box);
    }
  };
  take(root);
  const watcher = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) take(node);
      if (record.removedNodes.length > 0) drop();
    }
  });
  watcher.observe(root, { childList: true, subtree: true });
  return () => {
    watcher.disconnect();
    for (const room of rooms.values()) room.stop();
    rooms.clear();
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
