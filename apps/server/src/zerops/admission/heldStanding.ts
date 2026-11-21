/**
 * What decides a starter's signer standing while HQ is silent: the last standing heard for them,
 * for a bounded while (`ZeropsSignerStanding`'s `LAST_STANDING_HOLDS`). Pure, so the hold is
 * judged on literals.
 *
 * @module heldStanding
 */
import type { SignerStanding, SignerStandings } from "../ZeropsSignerStanding.ts";

/** A standing HQ spoke for a person and when this server heard it. */
export interface HeardStanding {
  readonly standing: SignerStanding;
  readonly heardAtMs: number;
}

/**
 * The kept standings after one answer heard at `heardAtMs`: each standing it spoke replaces the
 * kept one unless that was heard later (two asks at once: the later heard wins). A person the
 * answer does not speak for — `unknown`, or a verdict this server does not know — keeps theirs.
 */
export function keepHeard(
  kept: ReadonlyMap<string, HeardStanding>,
  spoken: SignerStandings,
  heardAtMs: number,
): ReadonlyMap<string, HeardStanding> {
  const next = new Map(kept);
  for (const [userId, standing] of Object.entries(spoken)) {
    if ((kept.get(userId)?.heardAtMs ?? -Infinity) <= heardAtMs) {
      next.set(userId, { standing, heardAtMs });
    }
  }
  return next;
}

/**
 * A person's standing now: what HQ just spoke for them, else the kept one while it is at most
 * `holdsMs` old, else `undefined` (nobody can say).
 */
export function standingNow(
  spoken: SignerStanding | undefined,
  kept: HeardStanding | undefined,
  nowMs: number,
  holdsMs: number,
): SignerStanding | undefined {
  if (spoken !== undefined) return spoken;
  return kept !== undefined && nowMs - kept.heardAtMs <= holdsMs ? kept.standing : undefined;
}
