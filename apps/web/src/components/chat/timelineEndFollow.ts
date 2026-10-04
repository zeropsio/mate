/**
 * The conversation following its end (pass 39, run 9: a settled turn's answer
 * moved the page 992 px in one frame, a card's growth 155). While it follows
 * and stands at its end, growth that comes a few pixels a frame — a card
 * easing taller — is followed in the frame it comes, and a longer step — a
 * row arriving whole, an answer landing — glides there on the run card's
 * curve, retargeted each frame as the end moves on, however far the end runs
 * ahead of the view.
 *
 * Whether the list stands at its end is judged here, from where it really
 * stands as each scroll is heard (`heard`), never from the list's own reading
 * of it, which goes stale mid-glide: it stands at its end once a scroll puts it
 * there — its own, the way back to the end, the person's — and leaves it only
 * on a move up of the person's. A person's move away
 * (`follows()` false) stops it where it stands.
 */
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";

/** Said on the conversation's scroll while it glides to its end: a run's fold waits for it. */
export const GLIDING_ATTRIBUTE = "data-timeline-gliding";

/** A step of the end this long or longer glides; a shorter one is already a glide's step. */
export const GLIDE_FROM_PX = 40;

/** This close to its end, the list stands at it. */
const AT_END_PX = 2;

/** Where the page itself last put each scroll: a scroll heard there is the page's. */
const ownTops = new WeakMap<object, number>();

/** The page puts `element`'s top at `top`: a scroll heard there is not the person's. */
export function scrollOwn(element: HTMLElement, top: number): void {
  element.scrollTop = top;
  ownTops.set(element, element.scrollTop);
}

/** Whether `element` stands where the page itself last put it (`scrollOwn`). */
export function isOwnScroll(element: HTMLElement): boolean {
  const own = ownTops.get(element);
  return own !== undefined && Math.abs(element.scrollTop - own) <= 1;
}

export interface EndFollow {
  /** Something may have moved the end: the list stands at it, or glides there. */
  readonly follow: () => void;
  /**
   * The list scrolled — `byPerson`: a person's scroll — and where it stands
   * now says whether it stands at its end: it reaches its end by any move,
   * and leaves it only by a person's move up. The list re-anchoring its rows,
   * the view shrinking under a taller composer, a fold: none of them leave it.
   */
  readonly heard: (byPerson: boolean) => void;
  readonly stop: () => void;
}

export function createEndFollow({
  viewport,
  follows,
}: {
  readonly viewport: () => HTMLElement | null;
  readonly follows: () => boolean;
}): EndFollow {
  let frame = 0;
  let last = 0;
  // Where the glide stands: the browser rounds what it is given.
  let at = 0;
  // Whether the list stands at its end, as last heard; null before anything was.
  let atEnd: boolean | null = null;
  // Where its top stood when last heard: a move up from there leaves the end.
  let lastTop: number | null = null;
  const endOf = (element: HTMLElement) => Math.max(0, element.scrollHeight - element.clientHeight);
  const stopGlide = (element: HTMLElement | null) => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    if (element !== null) said(element, false);
  };
  const step = (now: number) => {
    frame = 0;
    const element = viewport();
    if (element === null || !follows() || atEnd === false) {
      stopGlide(element);
      return;
    }
    // Moved since by something else: it glides on from there.
    if (Math.abs(element.scrollTop - at) > 2) at = element.scrollTop;
    const end = endOf(element);
    at = approach(at, end, last === 0 ? 1000 / 60 : now - last, FOLLOW_TAU_MS);
    last = now;
    scrollOwn(element, at);
    lastTop = element.scrollTop;
    if (at !== end) frame = requestAnimationFrame(step);
    else stopGlide(element);
  };
  return {
    follow: () => {
      const element = viewport();
      if (element === null || !follows() || frame !== 0) return;
      const end = endOf(element);
      const gap = end - element.scrollTop;
      // Never heard yet: a list a glide's step from its end stands at it.
      atEnd ??= gap < GLIDE_FROM_PX;
      if (!atEnd || Math.abs(gap) < 0.5) return;
      // Out of sight, nobody watches it glide: it stands there at once.
      if (gap < GLIDE_FROM_PX || reducedMotion() || outOfSight()) {
        scrollOwn(element, end);
        lastTop = element.scrollTop;
        return;
      }
      at = element.scrollTop;
      // Said on it while it glides: a run's fold waits for it (`foldWork`).
      said(element, true);
      frame = requestAnimationFrame(step);
    },
    heard: (byPerson) => {
      const element = viewport();
      if (element === null) return;
      const top = element.scrollTop;
      const movedUp = lastTop !== null && top < lastTop - 1;
      lastTop = top;
      if (isOwnScroll(element)) return;
      if (endOf(element) - top <= AT_END_PX) {
        atEnd = true;
      } else if (movedUp && byPerson) {
        atEnd = false;
        stopGlide(element);
      }
    },
    stop: () => stopGlide(viewport()),
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
