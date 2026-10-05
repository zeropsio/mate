/**
 * A height eased by hand inside the conversation's list.
 *
 * The list positions its rows and re-pins its scroll a frame after a row's
 * height changes, so a height animated per frame inside a row makes what the
 * list moves ride a frame late — ±45 px on a real run's fold (2026-09-29).
 * Stepped by hand instead: each step is taken once the list has moved its
 * rows for the last one (a ResizeObserver made after the list's own hears the
 * change after the list does), and the rows the list is about to move are
 * carried by that step, for the frame until it moves them — never to an
 * absolute place, which fought the list's re-pin once other rows arrived.
 */

import { LONG_GONE_MS } from "./runMotion.logic";

/**
 * The longest step a timed ease counts: two frames at 60 Hz, so a step that
 * waits a frame on the list's hearing keeps its pace.
 */
export const LATE_STEP_MS = 34;

/**
 * How far along a timed ease of `duration` stands after a frame `dtMs` past
 * its last: a late frame counts no more than a late step — a stall slows the
 * ease and nothing drops (run 12: a 195 ms stall dropped the helpers' card
 * 41 px in one frame) — but a frame long gone, a tab out of sight coming
 * back, finds it at its end.
 */
export function easedClock(elapsed: number, dtMs: number, duration: number): number {
  if (dtMs <= 0) return elapsed;
  if (dtMs >= LONG_GONE_MS) return duration;
  return Math.min(duration, elapsed + Math.min(dtMs, LATE_STEP_MS));
}

/** A CSS cubic-bezier timing function, by bisection. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (p1: number, p2: number, t: number) =>
    3 * p1 * (1 - t) * (1 - t) * t + 3 * p2 * (1 - t) * t * t + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    let t = x;
    for (let round = 0; round < 30; round += 1) {
      const reached = at(x1, x2, t);
      if (Math.abs(reached - x) < 1e-6) break;
      if (reached < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return at(y1, y2, t);
  };
}

/** The drawer's curve (`--ease-drawer`), gentler at the start than the strong ease-out. */
export const drawerEase = cubicBezier(0.32, 0.72, 0, 1);

/**
 * A row the list will move by a step: down (1) — above what shrinks, in a
 * list that follows its end and re-pins to it — or up (-1) — under it, in a
 * list that keeps its place; or a row that stands still (0) — under what
 * shrinks in a list that follows its end — which the list's re-pin drops for
 * a frame when it takes a step at once.
 */
export interface CarriedRow {
  readonly row: HTMLElement;
  readonly direction: 1 | -1 | 0;
}

/**
 * Frames the list takes to lay out what came with a change of its rows (the
 * answer and the result a settle brings): it lays those out at once, and
 * would a step taken meanwhile too.
 */
export const LIST_LAYS_OUT_FRAMES = 3;

/** Less than a layout unit: nothing for the list to hear. */
const NOTHING = 1 / 64;

/**
 * Eases `element`'s height from `from` to `to` over `duration` on `ease`, a
 * step a frame, after `wait` frames. With rows to carry, each step waits for
 * the list to have moved the rows for the last one, and carries them by its
 * own; without, it steps every frame. The list takes a step at once instead
 * while a change of its rows locks it (up to 300 ms after one): what it moved
 * by the step as it heard it comes off the carry, and a row that stands still
 * is held where it stood, for the frame until the list places it (a room
 * closing as a finished deploy's bar left under a streaming run, 2026-09-30:
 * carried on top, the card's edge dropped 10 px for a frame). `each` hears
 * every step (how far along the ease, and the height), `done` the last.
 * Returns what stops it; the element keeps the height it stood at, and the
 * rows lose their carry.
 */
export function stepHeight({
  element,
  from,
  to,
  duration,
  ease,
  wait = 0,
  carried = null,
  each,
  done,
}: {
  readonly element: HTMLElement;
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly ease: (t: number) => number;
  /** Frames before the first step. */
  readonly wait?: number;
  readonly carried?: ReadonlyArray<CarriedRow> | null;
  readonly each?: (eased: number, height: number) => void;
  readonly done: () => void;
}): () => void {
  let last: number | null = null;
  let elapsed = 0;
  let frame = 0;
  let height = from;
  let over = false;
  let settling = wait;
  // What the last step took, and where each carried row stood once carried.
  let lastTaken = 0;
  let stood: ReadonlyArray<number> = [];
  const carry = (taken: number) => {
    for (const { row, direction } of carried ?? []) {
      const shift = direction * taken;
      row.style.translate = Math.abs(shift) >= NOTHING ? `0 ${shift}px` : "";
    }
  };
  const stop = () => {
    over = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    carry(0);
  };
  const step = (now: number) => {
    frame = 0;
    if (over) return;
    if (settling > 0) {
      settling -= 1;
      frame = requestAnimationFrame(step);
      return;
    }
    if (last !== null) elapsed = easedClock(elapsed, now - last, duration);
    last = now;
    const t = duration > 0 ? Math.min(1, elapsed / duration) : 1;
    const eased = ease(t);
    const next = from + (to - from) * eased;
    // What this step takes, which the list will move its rows for a frame
    // from now: the carried rows go that far until it does.
    const taken = height - next;
    height = next;
    element.style.height = `${next}px`;
    each?.(eased, next);
    carry(taken);
    lastTaken = taken;
    stood = (carried ?? []).map(({ row }) => row.getBoundingClientRect().top);
    if (t < 1 || Math.abs(taken) >= NOTHING) {
      // The next step waits on the list's hearing this one (`observer`); a
      // step too small to change the height has nothing to wait on.
      if (observer === null || Math.abs(taken) < NOTHING) frame = requestAnimationFrame(step);
      return;
    }
    stop();
    done();
  };
  // What the list moved at once for the last step, as it heard it: off the
  // carry, and a row that stands still held where it stood.
  const takeBack = () => {
    if (Math.abs(lastTaken) < NOTHING) return;
    (carried ?? []).forEach(({ row, direction }, index) => {
      const drift = row.getBoundingClientRect().top - stood[index]!;
      if (Math.abs(Math.abs(drift) - Math.abs(lastTaken)) >= 1) return;
      const left = direction * lastTaken - drift;
      row.style.translate = Math.abs(left) >= NOTHING ? `0 ${left}px` : "";
    });
    lastTaken = 0;
  };
  // Made after the list's own, it hears the element after the list does: the
  // step it asks for runs once the list has moved the rows for the last one.
  const observer =
    carried === null
      ? null
      : new ResizeObserver(() => {
          if (over) return;
          takeBack();
          if (frame === 0) frame = requestAnimationFrame(step);
        });
  observer?.observe(element);
  element.style.height = `${from}px`;
  frame = requestAnimationFrame(step);
  return stop;
}
