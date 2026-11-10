/**
 * How a run's card moves (pass 39, the owner: "the non-animated height
 * expansions, the sometimes weirdly acting scroll processes"). Its room
 * growing or shrinking as lines arrive and leave goes by a travel
 * (`travelTiming`): every box and row one change moves shares its time and
 * its curve. A scroll following its foot goes by `approach`: each frame takes
 * a share of what is left, so it starts fast and lands soft (a strong
 * ease-out), is retargeted from wherever it stands when something else
 * arrives, and never passes its target.
 */

/** A fold's time constant: from its start to standing still in about 220 ms. */
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

/** A height ease by its time finishes after a frame this late (`stepHeight`, `travelElapsed`). */
export const LONG_GONE_MS = 250;

/** Closer than this to its target, a move stands at it. */
export const SETTLED_PX = 0.5;

/**
 * Where a move stands `dtMs` after `current`, on its way to `target`: the
 * share `1 - e^(-dt/tau)` of what is left, at most `MAX_SPEED_PX_PER_MS`.
 */
export function approach(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number,
  outOfSight = false,
): number {
  // Load can delay a visible frame too. Only the page's visibility proves nobody watched.
  if (outOfSight) return target;
  if (dtMs <= 0) return current;
  const share = (target - current) * (1 - Math.exp(-dtMs / tauMs));
  // A late frame moves no further than a frame on time would: the move
  // takes longer, and nothing jumps.
  const most = MAX_SPEED_PX_PER_MS * Math.min(dtMs, ON_TIME_FRAME_MS);
  const next = current + Math.max(-most, Math.min(most, share));
  return Math.abs(target - next) < SETTLED_PX ? target : next;
}

/**
 * The fastest an edge of a run's card travels: 10 px a frame at 60 Hz, 12 on a
 * frame a fifth late — a thought gaining two lines grew its box 40 px in one
 * frame, a command's body 82 (2026-11-10).
 */
export const TRAVEL_MAX_SPEED_PX_PER_MS = 0.6;

/** How long a travel takes, and how steep it starts (`travelProgress`). */
export interface TravelTiming {
  readonly durationMs: number;
  /** Its speed at the start, as a multiple of its mean: 3 a cubic ease-out, 1 a line. */
  readonly steepness: number;
}

/**
 * How a change of a run's card travels, by how far its farthest edge goes:
 * 150 ms for a line, 200 for a few, 260 past that, on an ease-out whose start
 * is held at `TRAVEL_MAX_SPEED_PX_PER_MS` — a long way starts level and eases
 * out, never a leap in its first frame.
 */
export function travelTiming(farthestPx: number): TravelTiming {
  const px = Math.abs(farthestPx);
  const durationMs = px <= 30 ? 150 : px <= 60 ? 200 : 260;
  const steepness =
    px === 0 ? 3 : Math.max(1, Math.min(3, (TRAVEL_MAX_SPEED_PX_PER_MS * durationMs) / px));
  return { durationMs, steepness };
}

/**
 * The share of its way a travel has gone at the share `time` of its duration:
 * level at `steepness` first, then a cubic ease-out to rest. Every box and row
 * a change moves goes by this one share, so what moves together stays
 * together and no edge passes its place or comes back.
 */
export function travelProgress(time: number, steepness: number): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const level = (3 - steepness) / (2 * steepness);
  if (time <= level) return steepness * time;
  return 1 - ((steepness - 1) / 2) * ((1 - time) / (1 - level)) ** 3;
}

/**
 * A travel's time `dtMs` after it stood at `elapsedMs`: a frame that comes
 * late counts as one on time, so the travel takes longer and nothing jumps;
 * one that comes long after (a tab out of sight) ends it — nobody watched.
 */
export function travelElapsed(elapsedMs: number, dtMs: number): number {
  if (dtMs >= LONG_GONE_MS) return Number.POSITIVE_INFINITY;
  return elapsedMs + Math.max(0, Math.min(dtMs, ON_TIME_FRAME_MS));
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

/**
 * Whether a run's scroll glides to its foot or stands there at once: a glide across a screen at
 * most, a longer way at once — at its top speed a glide over a run's whole history took seconds
 * (the owner, 2026-10-12: "and on open it scrolled to the very bottom for ages").
 */
export function glidesTo(way: number, screen: number): boolean {
  return way <= screen;
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
 * carries it, re-aimed at the foot each frame; it `puts` itself at its foot in
 * the same frame, so its end never leaves its foot — a height that travels (a
 * line landing, the slot under it growing, the card around it) moves on the
 * travel's curve, and waiting a frame for it left the newest line cut for
 * that frame, then jumped (2026-11-10: 40 and 82 px); it `glides` only after
 * lines that grew at once in a run watched live, nothing easing them (a
 * picture's bytes arriving).
 */
export function keepsFoot({
  follows,
  grew,
  below,
  eases,
  roomEases,
  gliding,
}: {
  readonly follows: boolean;
  /** Its lines grew since it last kept to its foot. */
  readonly grew: boolean;
  /** Its foot stands below where it is. */
  readonly below: boolean;
  /** Its room eases as lines join it: a live run, watched. */
  readonly eases: boolean;
  /** A box of its card eases this moment: its own, the live slot beside it, the card around it. */
  readonly roomEases: boolean;
  /** A glide to its foot is in flight. */
  readonly gliding: boolean;
}): "stays" | "puts" | "glides" {
  // A glide in flight re-aims at the foot every frame: a put would jump it there.
  if (!follows || gliding) return "stays";
  if (roomEases) return "puts";
  return grew && below && eases ? "glides" : "puts";
}
