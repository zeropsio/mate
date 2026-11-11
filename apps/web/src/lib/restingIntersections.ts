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
 * What an observer would report changes only when something scrolls, the window resizes, the
 * person presses something, or the page's nodes change. So this one observes for a moment after
 * each of those and lets go again. Observed anew, the browser reports where every target stands,
 * so a callback hears the same target again with nothing changed: it must not mind. One made
 * here is told a frame later than a plain observer, never less.
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

function rest() {
  timer = undefined;
  const left = awakeUntil - performance.now();
  // A frame held up reports late: wait for the report rather than let go unheard. A page in the
  // background reports nothing at all, and coming back stirs it.
  const unheard =
    document.visibilityState === "visible" &&
    [...watchers].some((watcher) => watcher.unheard && watcher.targets.size > 0);
  if (left > 0 || unheard) {
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

const LISTENED = ["scroll", "resize", "pointerdown", "keydown", "visibilitychange"] as const;

function listen() {
  for (const type of LISTENED) {
    // Captured, so a scroll inside any panel counts, not only the window's.
    window.addEventListener(type, stir, { passive: true, capture: true });
  }
  if (typeof MutationObserver === "function" && document.body !== null) {
    // Nodes added or taken away move what stands after them, with no scroll and no resize.
    nodes = new MutationObserver(stir);
    nodes.observe(document.body, { childList: true, subtree: true });
  }
}

function unlisten() {
  for (const type of LISTENED) window.removeEventListener(type, stir, { capture: true });
  nodes?.disconnect();
  nodes = undefined;
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
      release();
    },
    disconnect() {
      if (watcher.targets.size === 0) return;
      watcher.targets.clear();
      watcher.observer.disconnect();
      release();
    },
  };
}
