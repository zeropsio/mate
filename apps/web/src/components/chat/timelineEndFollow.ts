/**
 * The conversation following its end (pass 39, run 9: a settled turn's answer
 * moved the page 992 px in one frame, a card's growth 155). While it follows,
 * the list stands at its end: growth that comes a few pixels a frame — a card
 * easing taller — is followed in the frame it comes, and a longer step — a
 * row arriving whole, an answer landing — glides there on the run card's
 * curve, retargeted each frame as the end moves on. A person's move away
 * (`follows()` false) stops it where it stands.
 */
import { FOLLOW_TAU_MS, approach } from "./runMotion.logic";

/** A step of the end this long or longer glides; a shorter one is already a glide's step. */
export const GLIDE_FROM_PX = 40;

export interface EndFollow {
  /** Something may have moved the end: the list stands at it, or glides there. */
  readonly follow: () => void;
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
  // Where it last put the list's end: standing there still, it was at its
  // end, and the end moving on since glides; anywhere else it is placed.
  let placed: number | null = null;
  const endOf = (element: HTMLElement) => Math.max(0, element.scrollHeight - element.clientHeight);
  const step = (now: number) => {
    frame = 0;
    const element = viewport();
    if (element === null || !follows()) {
      last = 0;
      return;
    }
    // Moved since by something else: it glides on from there.
    if (Math.abs(element.scrollTop - at) > 2) at = element.scrollTop;
    const end = endOf(element);
    at = approach(at, end, last === 0 ? 1000 / 60 : now - last, FOLLOW_TAU_MS);
    last = now;
    element.scrollTop = at;
    placed = element.scrollTop;
    if (at !== end) frame = requestAnimationFrame(step);
    else last = 0;
  };
  return {
    follow: () => {
      const element = viewport();
      if (element === null || !follows() || frame !== 0) return;
      const end = endOf(element);
      const gap = end - element.scrollTop;
      if (Math.abs(gap) < 0.5) {
        placed = element.scrollTop;
        return;
      }
      const atEnd = placed !== null && Math.abs(element.scrollTop - placed) <= 2;
      if (gap < GLIDE_FROM_PX || !atEnd || reducedMotion()) {
        element.scrollTop = end;
        placed = element.scrollTop;
        return;
      }
      at = element.scrollTop;
      frame = requestAnimationFrame(step);
    },
    stop: () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    },
  };
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
