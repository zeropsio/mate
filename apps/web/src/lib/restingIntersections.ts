/**
 * An IntersectionObserver that lets go of its targets while the page stands still.
 *
 * For as long as any IntersectionObserver observes anything, Chrome asks the main thread for a
 * frame on every tick of every animation, the composited ones included: it cannot know where a
 * target stands without one. A page with one observer left watching pays a style pass and a
 * commit sixty times a second for a shimmer the compositor could have run alone (2026-11-11, the
 * overview at rest: 45 style passes a second and 7 % of the main thread with its observers, 4 and
 * 0.5 % with none; any site with an observer measures the same).
 *
 * What an observer would report changes only when something moves a target or what clips it. So
 * this one observes while that may be happening and for a moment after, and lets go again:
 *
 * - a scroll anywhere, the window resizing, a key, the page coming back to the front;
 * - a pointer held down, for as long as it is held — a drag only writes a width, frame after
 *   frame, with no event of its own;
 * - a transition or an animation ending, wherever it ran: what an input started may land long
 *   after the input;
 * - nodes added or removed anywhere in the page, and a new target;
 * - a box changing size: a target's own, any box that clips it, and what a scroller holds. One
 *   ResizeObserver watches those; unlike an IntersectionObserver it asks for no frame (a blank
 *   page with one animation: 0 style passes a second beside a ResizeObserver, 60 beside an
 *   IntersectionObserver).
 *
 * What still passes unseen: a target moved by a change that resizes none of those boxes and
 * touches no node — an attribute or a style written by a timer outside any scroller. The next
 * of the signs above tells it.
 *
 * Observed anew, the browser reports where every target stands, so a callback hears the same
 * target again with nothing changed: it must not mind. One made here is told a frame later than
 * a plain observer, never less.
 *
 * Without IntersectionObserver (a test's page, a server render) `watchIntersections` returns
 * `undefined`: the caller decides what an unwatched target counts as.
 */

/** How long after the last sign of movement the observers keep watching. */
const AWAKE_MS = 400;

export interface RestingIntersections {
  readonly observe: (target: Element) => void;
  readonly unobserve: (target: Element) => void;
  readonly disconnect: () => void;
}

interface Watcher {
  readonly observer: IntersectionObserver;
  readonly targets: Set<Element>;
  /** Observed anew and not yet told where its targets stand. */
  unheard: boolean;
}

const watchers = new Set<Watcher>();
let awake = false;
let awakeUntil = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let nodes: MutationObserver | undefined;
/** A pointer is down: whatever it drags moves with no other sign. */
let held = false;
/** The boxes whose size says a target may have moved; `boxed` remembers whose were looked up. */
let sizes: ResizeObserver | undefined;
let boxed = new WeakSet<Element>();

function rest() {
  timer = undefined;
  const left = awakeUntil - performance.now();
  // A frame held up reports late: wait for the report rather than let go unheard. A page in the
  // background reports nothing at all, and coming back stirs it; a target off the page is never
  // reported, so it holds nothing up.
  const unheard =
    document.visibilityState === "visible" &&
    [...watchers].some(
      (watcher) => watcher.unheard && [...watcher.targets].some((target) => target.isConnected),
    );
  if (left > 0 || unheard || held) {
    timer = setTimeout(rest, Math.max(left, AWAKE_MS));
    return;
  }
  awake = false;
  for (const watcher of watchers) watcher.observer.disconnect();
}

/** Something may have moved: every observer watches its targets again for a moment. */
function stir() {
  awakeUntil = performance.now() + AWAKE_MS;
  if (awake) return;
  awake = true;
  for (const watcher of watchers) {
    watcher.unheard = watcher.targets.size > 0;
    for (const target of watcher.targets) watcher.observer.observe(target);
  }
  timer ??= setTimeout(rest, AWAKE_MS);
}

/**
 * Watches the sizes that can move `target`: its own, every box above it that clips, and what a
 * scroller among them holds (its content growing moves what stands in it). Called where the
 * browser reports the target, the page laid out, so reading a box's overflow costs no style
 * pass; a box looked up once is not looked up again.
 */
function watchBoxes(target: Element) {
  if (sizes === undefined || boxed.has(target)) return;
  boxed.add(target);
  sizes.observe(target);
  for (let box = target.parentElement; box !== null && !boxed.has(box); box = box.parentElement) {
    boxed.add(box);
    const { overflowX, overflowY } = getComputedStyle(box);
    if (overflowX === "visible" && overflowY === "visible") continue;
    sizes.observe(box);
    const scrolls = /auto|scroll/.test(overflowX) || /auto|scroll/.test(overflowY);
    // A list's rows are not its content's size; its one or two wrappers are.
    if (scrolls && box.children.length <= 4) {
      for (const child of box.children) sizes.observe(child);
    }
  }
}

/** A pointer went down: the observers watch until it lifts. */
function press() {
  if (!held) window.addEventListener("pointermove", holding, { passive: true, capture: true });
  held = true;
  stir();
}

function lift() {
  if (!held) return;
  held = false;
  window.removeEventListener("pointermove", holding, { capture: true });
  stir();
}

/** A lift outside the window is never told: the next move with no button down says it. */
function holding(event: PointerEvent) {
  if (event.buttons === 0) lift();
}

/** The window itself lost focus (a field losing it is captured here too, and says nothing). */
function away(event: Event) {
  if (event.target === window) lift();
}

/** Transitions of these move no box: a hover's fade must not wake anything. */
const PAINTS_ONLY =
  /^(?:(?:background-|border-(?:\w+-)*|outline-|text-decoration-|caret-|accent-)?color|background(?:-image|-position)?|box-shadow|text-shadow|opacity|filter|backdrop-filter|fill|stroke|outline-offset)$/;

function ended(event: Event) {
  if (
    (event.type === "transitionend" || event.type === "transitioncancel") &&
    PAINTS_ONLY.test((event as TransitionEvent).propertyName)
  ) {
    return;
  }
  stir();
}

const STIRS = ["scroll", "resize", "keydown", "visibilitychange"] as const;
const LIFTS = ["pointerup", "pointercancel"] as const;
const ENDS = ["transitionend", "transitioncancel", "animationend", "animationcancel"] as const;

function listen() {
  // Captured, so a scroll inside any panel counts, not only the window's.
  const options = { passive: true, capture: true };
  for (const type of STIRS) window.addEventListener(type, stir, options);
  window.addEventListener("pointerdown", press, options);
  for (const type of LIFTS) window.addEventListener(type, lift, options);
  window.addEventListener("blur", away, options);
  for (const type of ENDS) window.addEventListener(type, ended, options);
  if (typeof MutationObserver === "function" && document.body !== null) {
    // Nodes added or taken away move what stands after them, with no scroll and no resize.
    nodes = new MutationObserver(stir);
    nodes.observe(document.body, { childList: true, subtree: true });
  }
  if (typeof ResizeObserver === "function") sizes = new ResizeObserver(stir);
}

function unlisten() {
  const options = { capture: true };
  for (const type of STIRS) window.removeEventListener(type, stir, options);
  window.removeEventListener("pointerdown", press, options);
  for (const type of LIFTS) window.removeEventListener(type, lift, options);
  window.removeEventListener("blur", away, options);
  for (const type of ENDS) window.removeEventListener(type, ended, options);
  window.removeEventListener("pointermove", holding, options);
  held = false;
  nodes?.disconnect();
  nodes = undefined;
  sizes?.disconnect();
  sizes = undefined;
  boxed = new WeakSet();
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  awake = false;
}

function watched(): number {
  let count = 0;
  for (const watcher of watchers) count += watcher.targets.size;
  return count;
}

export function watchIntersections(
  callback: (entries: ReadonlyArray<IntersectionObserverEntry>) => void,
  options?: IntersectionObserverInit,
): RestingIntersections | undefined {
  if (typeof IntersectionObserver !== "function" || typeof window === "undefined") return undefined;
  const watcher: Watcher = {
    observer: new IntersectionObserver((entries) => {
      watcher.unheard = false;
      for (const entry of entries) watchBoxes(entry.target);
      callback(entries);
    }, options),
    targets: new Set(),
    unheard: false,
  };
  const release = () => {
    if (watcher.targets.size > 0) return;
    watchers.delete(watcher);
    if (watched() === 0) unlisten();
  };
  return {
    observe(target) {
      if (watcher.targets.has(target)) return;
      if (watched() === 0) listen();
      watcher.targets.add(target);
      watchers.add(watcher);
      // A target new to the page is one of the page's changes: it is told where it stands.
      if (awake) {
        watcher.unheard = true;
        watcher.observer.observe(target);
      }
      stir();
    },
    unobserve(target) {
      if (!watcher.targets.delete(target)) return;
      watcher.observer.unobserve(target);
      sizes?.unobserve(target);
      boxed.delete(target);
      release();
    },
    disconnect() {
      if (watcher.targets.size === 0) return;
      for (const target of watcher.targets) {
        sizes?.unobserve(target);
        boxed.delete(target);
      }
      watcher.targets.clear();
      watcher.observer.disconnect();
      release();
    },
  };
}

/**
 * `watchIntersections` for a callback that acts on a crossing: told of a target only when it
 * went into view or out of it since it was last told, as a plain observer tells it. A target
 * observed again after being let go is told where it stands once more.
 */
export function watchCrossings(
  callback: (entries: ReadonlyArray<IntersectionObserverEntry>) => void,
  options?: IntersectionObserverInit,
): RestingIntersections | undefined {
  let stood = new WeakMap<Element, boolean>();
  const watching = watchIntersections((entries) => {
    const crossed = entries.filter((entry) => {
      const was = stood.get(entry.target);
      stood.set(entry.target, entry.isIntersecting);
      return was !== entry.isIntersecting;
    });
    if (crossed.length > 0) callback(crossed);
  }, options);
  if (watching === undefined) return undefined;
  return {
    observe: watching.observe,
    unobserve(target) {
      stood.delete(target);
      watching.unobserve(target);
    },
    disconnect() {
      stood = new WeakMap();
      watching.disconnect();
    },
  };
}
