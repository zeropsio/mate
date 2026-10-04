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
 * a frame's share of what is left is less — no frame moves anything 40 px.
 */
export const MAX_SPEED_PX_PER_MS = 2.1;

/** Closer than this to its target, a move stands at it. */
export const SETTLED_PX = 0.5;

/**
 * Where a move stands `dtMs` after `current`, on its way to `target`: the
 * share `1 - e^(-dt/tau)` of what is left, at most `MAX_SPEED_PX_PER_MS`.
 */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return current;
  const share = (target - current) * (1 - Math.exp(-dtMs / tauMs));
  const most = MAX_SPEED_PX_PER_MS * dtMs;
  const next = current + Math.max(-most, Math.min(most, share));
  return Math.abs(target - next) < SETTLED_PX ? target : next;
}
