/**
 * The conversation following its end. While it follows, growth of what is already there — a
 * picture laying out, text reflowing at a new width, an estimate replaced by a row's real height,
 * the viewport changing size — is carried in the frame the end takes it: the view stays at the end
 * and nothing the person sees moves. Chased instead, a late picture or the first opening of the
 * right panel crawled thousands of pixels for seconds (the owner, 2026-11-19). Only an arrival —
 * new content at the end — glides, and a glide is bounded in time, not capped in speed: it ends
 * within its window however far it goes, and a way longer than the view starts a view short of
 * the end.
 *
 * Whether it follows is one judgement, ChatView's (`nextTimelineFollow`, read
 * through `follows()`): the follower keeps none of its own, so follow coming
 * back on — the person's return to the end band, the way back to the end, a
 * send — always finds it armed, and follow turning off — the person leaving,
 * a jump far up — always stops it where it stands.
 */
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { travelProgress } from "./runMotion.logic";

/** Said on the conversation's scroll while it glides to its end: a run's fold waits for it. */
export const GLIDING_ATTRIBUTE = "data-timeline-gliding";

/** A step of the end this long or longer glides; a shorter one is already a glide's step. */
export const GLIDE_FROM_PX = 40;

/** How long a glide over `way` px takes: a few lines in 200 ms, anything longer in 260. */
export function glideWindowMs(way: number): number {
  return way <= 60 ? 200 : 260;
}

/**
 * Where a glide stands at `now`, from `at` with `way` px left to the end, `since` being its last
 * frame: what is left eases out (`travelProgress`, a cubic ease-out) to stand at the end when its
 * window closes, however late the frames come. Growth carried mid-glide moves `at` and the end
 * together, so it never moves the glide's way.
 */
export function glideTo({
  at,
  way,
  start,
  windowMs,
  since,
  now,
}: {
  readonly at: number;
  readonly way: number;
  readonly start: number;
  readonly windowMs: number;
  readonly since: number;
  readonly now: number;
}): number {
  const before = travelProgress((since - start) / windowMs, 3);
  const after = travelProgress((now - start) / windowMs, 3);
  if (after >= 1 || before >= 1) return at + way;
  return at + (way * (after - before)) / (1 - before);
}

/** Who of the page made a scroll: the page's own code (`scrollOwn`), or the list (`ownListScrolls`). */
export type OwnScroll = "page" | "list";

/** Where the page itself last put each scroll, and who put it there: a scroll heard there is the page's. */
const ownTops = new WeakMap<object, { readonly top: number; readonly by: OwnScroll }>();

/** The page puts `element`'s top at `top`: a scroll heard there is not the person's. */
export function scrollOwn(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  ownTops.set(element, { top: element.scrollTop, by: "page" });
}

/**
 * Who of the page made `element`'s scroll heard now (`scrollOwn`, `ownListScrolls`), or
 * `undefined` for someone else's: once only — a later scroll to the same top is someone else's.
 */
export function takeOwnScroll(element: HTMLElement): OwnScroll | undefined {
  const own = ownTops.get(element);
  ownTops.delete(element);
  return own !== undefined && Math.abs(element.scrollTop - own.top) <= 1 ? own.by : undefined;
}

/**
 * The scrolls `element`'s list makes itself — its initial scroll to the end, re-applied as rows
 * measure, a correction while content is remeasured, keeping a row in place — are the page's own
 * moves too, never the person's: each is told as `scrollOwn`'s. Returns the undo.
 */
export function ownListScrolls(element: HTMLElement): () => void {
  const scrollTo = element.scrollTo;
  const scrollBy = element.scrollBy;
  element.scrollTo = function (...args: Parameters<HTMLElement["scrollTo"]>) {
    scrollTo.apply(element, args as never);
    ownTops.set(element, { top: element.scrollTop, by: "list" });
  } as HTMLElement["scrollTo"];
  element.scrollBy = function (...args: Parameters<HTMLElement["scrollBy"]>) {
    scrollBy.apply(element, args as never);
    ownTops.set(element, { top: element.scrollTop, by: "list" });
  } as HTMLElement["scrollBy"];
  return () => {
    element.scrollTo = scrollTo;
    element.scrollBy = scrollBy;
  };
}

export interface EndFollow {
  /**
   * Follow the end. `grew` is growth of what was already there: carried in the frame the end takes
   * it, never glided. Whatever way to the end is left is an arrival's, and glides.
   */
  readonly follow: (grew?: number) => void;
  /** It glides to its end now: a row that came at the end still grows as part of its arrival. */
  readonly gliding: () => boolean;
  /** A measurement may have clamped the native viewport before the next layout. */
  readonly observe: () => void;
  /**
   * The composer's inset changed by `grew` px: its line keeps its place at once; the end moving
   * further — a message arriving with it — glides there.
   */
  readonly place: (grew?: number) => void;
  /**
   * Where the list stands now is its end, until the end grows: an answer held where its words
   * were read never glides on to the few pixels of its foot under it.
   */
  readonly keep: () => void;
  /**
   * The list moved the view itself — its initial scroll re-applied as rows measure: it stands at
   * the end again at once, before the frame paints. Glided back, a long history showed the
   * conversation mid-way for a second (1,471 px, still 5 px off the end after 60 frames).
   * Mid-glide the glide goes on from where the list put it.
   */
  readonly undo: () => void;
  readonly stop: () => void;
}

export function createEndFollow({
  viewport,
  follows,
  room = () => 0,
  unseen = () => false,
  placeEnd,
}: {
  readonly viewport: () => HTMLElement | null;
  /** Whether the conversation follows its end: ChatView's one judgement of it. */
  readonly follows: () => boolean;
  /**
   * Room under the end the person may scroll into and the follower never goes into, nor out of:
   * what an answered ask over the composer covered, while the view eases out of it.
   */
  readonly room?: () => number;
  /**
   * Its conversation is not shown yet (placed out of sight): nobody watches it glide, so it stands
   * at the end at once, and the conversation is shown standing still.
   */
  readonly unseen?: () => boolean;
  /** The list commits this measured alignment after pending virtualizer layout. */
  readonly placeEnd: () => void;
}): EndFollow {
  const unwatched = () => outOfSight() || unseen();
  const page = typeof document === "undefined" ? undefined : document;
  let frame = 0;
  let last = 0;
  // The glide's window: when it started, how long it takes, and what was left after its last frame.
  let glideWindow = { start: 0, ms: 0, left: 0 };
  // Growth told before the list grew the end by it: carried once the end takes it, this frame or
  // the next. Never glided, and never kept past that frame (`settleOwed`).
  let owed = 0;
  let owedFrame = 0;
  // Where the glide stands: the browser rounds what it is given.
  let at = 0;
  // The viewport whose position `at` describes, including after a glide stops.
  let observedViewport: HTMLElement | null = null;
  // The list it glides, and said so on: a kept list swapped in since is not it.
  let gliding: HTMLElement | null = null;
  // What `keep` holds back from the end, and the height it holds while the end has not grown.
  let kept: {
    readonly element: HTMLElement;
    readonly short: number;
    readonly height: number;
  } | null = null;
  const endOf = (element: HTMLElement) => {
    const end = Math.max(0, element.scrollHeight - element.clientHeight - room());
    if (kept !== null && (kept.element !== element || element.scrollHeight > kept.height + 0.5)) {
      kept = null;
    }
    return kept === null ? end : Math.max(0, end - kept.short);
  };
  const stopGlide = () => {
    cancelAnimationFrame(frame);
    page?.removeEventListener?.("visibilitychange", visibilityChanged);
    frame = 0;
    last = 0;
    if (gliding !== null) said(gliding, false);
    gliding = null;
  };
  const step = (now: number) => {
    frame = 0;
    const element = viewport();
    if (element === null || element !== gliding || !follows()) {
      stopGlide();
      return;
    }
    // Moved since by something else — growth carried, the list's own scroll: it glides on from there.
    if (Math.abs(element.scrollTop - at) > 2) at = element.scrollTop;
    const end = endOf(element);
    // The person went on into the room under the end: theirs to stand in.
    if (at > end && room() > 0) {
      stopGlide();
      return;
    }
    const since = last === 0 ? now - 1000 / 60 : last;
    if (last === 0) glideWindow = { start: since, ms: glideWindowMs(end - at), left: end - at };
    let way = end - at;
    // More arrived while it glides: its window starts again from here, so it too lands in time.
    if (way - glideWindow.left >= GLIDE_FROM_PX)
      glideWindow = { start: since, ms: glideWindowMs(way), left: way };
    // A way longer than the view starts a view short of the end: no glide is long.
    if (way > element.clientHeight) {
      at = end - element.clientHeight;
      way = element.clientHeight;
    }
    at = unwatched()
      ? end
      : glideTo({ at, way, start: glideWindow.start, windowMs: glideWindow.ms, since, now });
    if (Math.abs(end - at) < 0.5) at = end;
    last = now;
    glideWindow = { ...glideWindow, left: end - at };
    scrollOwn(element, at);
    if (at !== end) frame = requestAnimationFrame(step);
    else stopGlide();
  };
  // Growth told is carried as far as the end has taken it; the rest waits a frame for the list.
  const carryOwed = (element: HTMLElement) => {
    const carried = Math.min(owed, endOf(element) - element.scrollTop);
    if (carried > 0) {
      scrollOwn(element, element.scrollTop + carried);
      at = element.scrollTop;
      owed -= carried;
    }
    if (owed > 0 && owedFrame === 0) owedFrame = requestAnimationFrame(settleOwed);
  };
  const settleOwed = () => {
    owedFrame = 0;
    const element = viewport();
    if (element !== null && follows()) carryOwed(element);
    cancelAnimationFrame(owedFrame);
    owedFrame = 0;
    owed = 0;
  };
  // Finish while unseen, before a returning tab can paint its paused glide.
  const visibilityChanged = () => {
    if (!outOfSight()) return;
    cancelAnimationFrame(frame);
    step(last);
  };
  const observe = (element: HTMLElement) => {
    const end = endOf(element);
    // A measured range below our last position clamps the browser at its
    // new end. Attribute that observed correction before later measurements
    // grow the range and before its coalesced scroll event arrives. Dimensions
    // round to integers while scrollTop stays fractional, so allow 1 px.
    if (element === observedViewport && at > end && Math.abs(end - element.scrollTop) <= 1) {
      ownTops.set(element, { top: element.scrollTop, by: "page" });
    }
    observedViewport = element;
    at = element.scrollTop;
  };
  const follower: EndFollow = {
    place: (grew = 0) => {
      const element = viewport();
      // The composer's inset moved the end: what was kept short of it was kept for the old one.
      kept = null;
      if (element === null || !follows()) return;
      // Mid-glide the glide goes on to the moved end: standing there at once was a step of all
      // that was left (Milo's stress run 4: 77 px in one frame as the composer shrank on a send).
      if (gliding === element) return;
      // The end moved further than the composer did: a message arrived with it, and standing at
      // the end at once moved the conversation by all of it (Milo's stress run 6: a six-line
      // draft's send, 223 px in one frame). The composer's own growth keeps its line in place at
      // once; the rest glides.
      if (endOf(element) - element.scrollTop - Math.max(0, grew) >= GLIDE_FROM_PX) {
        if (grew > 0) {
          scrollOwn(element, element.scrollTop + grew);
          at = element.scrollTop;
        }
        follower.follow();
        return;
      }
      stopGlide();
      placeEnd();
    },
    observe: () => {
      const element = viewport();
      if (element !== null && follows()) observe(element);
    },
    keep: () => {
      const element = viewport();
      kept = null;
      if (element === null) return;
      const short = endOf(element) - element.scrollTop;
      // Only the few pixels of an answer's foot. Farther from the end, something else moved it
      // while the answer was held — the composer's inset growing as the usage limit held a
      // message — and keeping that held the end 202 px away for good.
      if (short > 0.5 && short < GLIDE_FROM_PX) {
        kept = { element, short, height: element.scrollHeight };
      }
    },
    gliding: () => frame !== 0,
    follow: (grew = 0) => {
      const element = viewport();
      if (element === null || !follows()) {
        owed = 0;
        return;
      }
      const end = endOf(element);
      observe(element);
      // What was already there grew: carried whole, however much, in the frame the end takes it.
      if (grew > 0) owed += grew;
      if (owed > 0) carryOwed(element);
      const gap = end - element.scrollTop;
      // Standing in the room under the end is the person's: it is not taken back.
      if (frame !== 0 || Math.abs(gap) < 0.5 || (gap < 0 && room() > 0)) return;
      // Out of sight, nobody watches it glide: it stands there at once.
      if (gap < GLIDE_FROM_PX || prefersReducedMotion() || unwatched()) {
        scrollOwn(element, end);
        at = element.scrollTop;
        return;
      }
      gliding = element;
      // Said on it while it glides: a run's fold waits for it (`foldWork`).
      said(element, true);
      page?.addEventListener?.("visibilitychange", visibilityChanged);
      frame = requestAnimationFrame(step);
    },
    undo: () => {
      const element = viewport();
      if (element === null || !follows() || frame !== 0) return;
      scrollOwn(element, endOf(element));
      at = element.scrollTop;
    },
    stop: () => {
      stopGlide();
      cancelAnimationFrame(owedFrame);
      owedFrame = 0;
      owed = 0;
    },
  };
  return follower;
}

/** Says on the list's scroll whether it glides; a stand-in for one (a test's) says nothing. */
function said(element: HTMLElement, gliding: boolean): void {
  if (typeof element.toggleAttribute === "function") {
    element.toggleAttribute(GLIDING_ATTRIBUTE, gliding);
  }
}

function outOfSight(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
