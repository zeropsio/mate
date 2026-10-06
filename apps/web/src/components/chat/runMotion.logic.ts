/**
 * How a run's card moves (pass 39, the owner: "the non-animated height
 * expansions, the sometimes weirdly acting scroll processes"). One curve for
 * every move the card makes on its own — its room growing or shrinking as
 * lines arrive and leave, its scroll following its foot: each frame takes a
 * share of what is left, so it starts fast and lands soft (a strong ease-out),
 * is retargeted from wherever it stands when something else arrives, and
 * never passes its target.
 */

/** The room's time constant: from a line's arrival to standing still in about 220 ms. */
export const ROOM_TAU_MS = 45;

/** The scroll following its foot glides on the same curve. */
export const FOLLOW_TAU_MS = 45;

/**
 * The fastest a move goes: a long way starts at this speed and eases out once
 * a frame's share of what is left is less — no frame moves anything 40 px,
 * a late frame included.
 */
export const MAX_SPEED_PX_PER_MS = 1.6;

/** The longest frame a move's speed counts: a frame and a fifth at 60 Hz. */
const ON_TIME_FRAME_MS = 20;

/** A frame this late means nobody watched: the move stands at its target. */
export const LONG_GONE_MS = 250;

/** Closer than this to its target, a move stands at it. */
export const SETTLED_PX = 0.5;

/**
 * Where a move stands `dtMs` after `current`, on its way to `target`: the
 * share `1 - e^(-dt/tau)` of what is left, at most `MAX_SPEED_PX_PER_MS`.
 */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return current;
  // A frame long gone — a tab out of sight coming back — finds it there.
  if (dtMs >= LONG_GONE_MS) return target;
  const share = (target - current) * (1 - Math.exp(-dtMs / tauMs));
  // A late frame moves no further than a frame on time would: the move
  // takes longer, and nothing jumps.
  const most = MAX_SPEED_PX_PER_MS * Math.min(dtMs, ON_TIME_FRAME_MS);
  const next = current + Math.max(-most, Math.min(most, share));
  return Math.abs(target - next) < SETTLED_PX ? target : next;
}

/**
 * The speed a frame gives the eases of one card, each way: a landed line's
 * room and the slot squeezing the history each took their own 32 px, and
 * the history moved up to 53 px in one frame (the p43 review), so eases the
 * same way share it. Growing and shrinking each have their own: a landing's
 * history grows by what its slot gives, on one curve each, and the card's
 * height stays (one budget for both grew it 50 px and back, the p43
 * verification). `at` is the frame it was given for.
 */
export interface EaseBudget {
  at: number;
  grow: number;
  shrink: number;
}

/**
 * What of `step` an ease takes in the frame at `now`, `dtMs` after its last:
 * the first ease heard in a frame gives the budget that frame's speed each
 * way, and each takes from what is left its way. A frame long gone stands
 * at its target.
 */
export function spendStep(budget: EaseBudget, now: number, dtMs: number, step: number): number {
  if (dtMs >= LONG_GONE_MS) return step;
  if (budget.at !== now) {
    budget.at = now;
    budget.grow = budget.shrink = MAX_SPEED_PX_PER_MS * Math.min(dtMs, ON_TIME_FRAME_MS);
  }
  if (step >= 0) {
    const taken = Math.min(step, budget.grow);
    budget.grow -= taken;
    return taken;
  }
  const taken = Math.min(-step, budget.shrink);
  budget.shrink -= taken;
  return -taken;
}

/**
 * Where a glide to a run's foot stands a frame `dtMs` on: the foot's own
 * move since its last frame (`lastFoot` to `foot`, a height easing as it
 * glides) is taken at once, and only what was left of the glide's way eases
 * — chasing the moving foot hid up to 0.37 of the growth, about 22 px, for
 * 200 ms (the p43 verification).
 */
export function glideStep({
  at,
  lastFoot,
  foot,
  dtMs,
}: {
  readonly at: number;
  readonly lastFoot: number;
  readonly foot: number;
  readonly dtMs: number;
}): number {
  return approach(at + (foot - lastFoot), foot, dtMs, FOLLOW_TAU_MS);
}

/** How long after the person's input a move of a run's scroll is still theirs. */
export const PERSON_INPUT_MS = 500;

/**
 * Whether a move of a run's scroll is the person's: always, unless its own
 * motion runs (its room easing, its glide) or its box or lines changed size
 * since it was last read, with no input of theirs near — then it is that
 * motion's or that change's, the browser clamping it — but for a move onto the
 * foot they had left: a phone's flick coasting there sends no touch, and it is
 * their way back. (Run 12: a row going in grew the box 4 px and set the top
 * 14 px up, 43 s after any input; read as the person's, the run stopped
 * following its foot for 39 minutes.)
 */
export function movesAsPerson({
  moving,
  resized = false,
  msSinceInput,
  atFoot,
  follows,
}: {
  readonly moving: boolean;
  /** Its box or what it holds changed size since it was last read. */
  readonly resized?: boolean;
  readonly msSinceInput: number;
  readonly atFoot: boolean;
  readonly follows: boolean;
}): boolean {
  if ((!moving && !resized) || msSinceInput <= PERSON_INPUT_MS) return true;
  return atFoot && !follows;
}

/**
 * How a run's scroll keeps to its foot as what it holds or its box changed:
 * it `stays` where it is — scrolled up by the person, or a glide in flight
 * carries it, re-aimed at the foot each frame; it `waits` a frame while the card around it eases taller, which
 * gives it the room it needs; it `puts` itself at its foot in the same frame,
 * so its end never leaves its foot — a height that eases (a line landing, a
 * bubble growing as its words stream) already moves on the room's curve, and
 * gliding after it left the newest line cut for 200 ms (R12-17); it `glides`
 * only after lines that grew at once in a run watched live, nothing easing
 * them (a picture's bytes arriving).
 */
export function keepsFoot({
  follows,
  heldAbove,
  grew,
  below,
  eases,
  roomEases,
  gliding,
}: {
  readonly follows: boolean;
  /** A box holding it eases this moment: its height is that ease's. */
  readonly heldAbove: boolean;
  /** Its lines grew since it last kept to its foot. */
  readonly grew: boolean;
  /** Its foot stands below where it is. */
  readonly below: boolean;
  /** Its room eases as lines join it: a live run, watched. */
  readonly eases: boolean;
  /** A box of its card eases this moment: its own, or the live slot squeezing it. */
  readonly roomEases: boolean;
  /** A glide to its foot is in flight. */
  readonly gliding: boolean;
}): "stays" | "waits" | "puts" | "glides" {
  // A glide in flight re-aims at the foot every frame: a put would jump it there.
  if (!follows || gliding) return "stays";
  if (heldAbove) return "waits";
  if (roomEases) return "puts";
  return grew && below && eases ? "glides" : "puts";
}
