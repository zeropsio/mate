/**
 * The conversation following its end (pass 39, run 9: a settled turn's answer
 * moved the page 992 px in one frame, a card's growth 155). While it follows,
 * growth that comes a few pixels a frame — a card easing taller — is followed
 * in the frame it comes, and a longer step — a row arriving whole, an answer
 * landing — glides there on the run card's curve, retargeted each frame as
 * the end moves on, however far the end runs ahead of the view.
 *
 * Whether it follows is one judgement, ChatView's (`nextTimelineFollow`, read
 * through `follows()`): the follower keeps none of its own, so follow coming
 * back on — the person's return to the end band, the way back to the end, a
 * send — always finds it armed, and follow turning off — the person leaving,
 * a jump far up — always stops it where it stands.
 */
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";

/** Said on the conversation's scroll while it glides to its end: a run's fold waits for it. */
export const GLIDING_ATTRIBUTE = "data-timeline-gliding";

/** A step of the end this long or longer glides; a shorter one is already a glide's step. */
export const GLIDE_FROM_PX = 40;

/** Where the page itself last put each scroll: a scroll heard there is the page's. */
const ownTops = new WeakMap<object, number>();

/** The page puts `element`'s top at `top`: a scroll heard there is not the person's. */
export function scrollOwn(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  ownTops.set(element, element.scrollTop);
}

/**
 * Whether `element`'s scroll, heard now, is the page's own move (`scrollOwn`):
 * once only — a later scroll to the same top is someone else's.
 */
export function takeOwnScroll(element: HTMLElement): boolean {
  const own = ownTops.get(element);
  ownTops.delete(element);
  return own !== undefined && Math.abs(element.scrollTop - own) <= 1;
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
    ownTops.set(element, element.scrollTop);
  } as HTMLElement["scrollTo"];
  element.scrollBy = function (...args: Parameters<HTMLElement["scrollBy"]>) {
    scrollBy.apply(element, args as never);
    ownTops.set(element, element.scrollTop);
  } as HTMLElement["scrollBy"];
  return () => {
    element.scrollTo = scrollTo;
    element.scrollBy = scrollBy;
  };
}

export interface EndFollow {
  /** Something may have moved the end: the list stands at it, or glides there. */
  readonly follow: () => void;
  /** A measurement may have clamped the native viewport before the next layout. */
  readonly observe: () => void;
  readonly stop: () => void;
}

export function createEndFollow({
  viewport,
  follows,
}: {
  readonly viewport: () => HTMLElement | null;
  /** Whether the conversation follows its end: ChatView's one judgement of it. */
  readonly follows: () => boolean;
}): EndFollow {
  let frame = 0;
  let last = 0;
  // Where the glide stands: the browser rounds what it is given.
  let at = 0;
  // The viewport whose position `at` describes, including after a glide stops.
  let observedViewport: HTMLElement | null = null;
  // The list it glides, and said so on: a kept list swapped in since is not it.
  let gliding: HTMLElement | null = null;
  const endOf = (element: HTMLElement) => Math.max(0, element.scrollHeight - element.clientHeight);
  const stopGlide = () => {
    cancelAnimationFrame(frame);
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
    // Moved since by something else: it glides on from there.
    if (Math.abs(element.scrollTop - at) > 2) at = element.scrollTop;
    const end = endOf(element);
    at = approach(at, end, last === 0 ? 1000 / 60 : now - last, FOLLOW_TAU_MS);
    last = now;
    scrollOwn(element, at);
    if (at !== end) frame = requestAnimationFrame(step);
    else stopGlide();
  };
  const observe = (element: HTMLElement) => {
    const end = endOf(element);
    // A measured range below our last position clamps the browser at its
    // new end. Attribute that observed correction before later measurements
    // grow the range and before its coalesced scroll event arrives. Dimensions
    // round to integers while scrollTop stays fractional, so allow 1 px.
    if (element === observedViewport && at > end && Math.abs(end - element.scrollTop) <= 1) {
      ownTops.set(element, element.scrollTop);
    }
    observedViewport = element;
    at = element.scrollTop;
  };
  return {
    observe: () => {
      const element = viewport();
      if (element !== null && follows()) observe(element);
    },
    follow: () => {
      const element = viewport();
      if (element === null || !follows()) return;
      const end = endOf(element);
      const gap = end - element.scrollTop;
      observe(element);
      if (frame !== 0 || Math.abs(gap) < 0.5) return;
      // Out of sight, nobody watches it glide: it stands there at once.
      if (gap < GLIDE_FROM_PX || reducedMotion() || outOfSight()) {
        scrollOwn(element, end);
        at = element.scrollTop;
        return;
      }
      gliding = element;
      // Said on it while it glides: a run's fold waits for it (`foldWork`).
      said(element, true);
      frame = requestAnimationFrame(step);
    },
    stop: stopGlide,
  };
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

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
