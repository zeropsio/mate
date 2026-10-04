/**
 * The pace a run's lines enter at (pass 39, the owner: "the agressive plop
 * that's sometimes too much too fast to process"). The server sends a burst —
 * a turn starting, helpers reporting back, a settle — and three to six rows
 * landed in one frame. Here they enter one after another, in order, each with
 * its own entrance: a gap of `PACE_GAP_MS` after the last, shorter as the
 * backlog grows (never under `PACE_MIN_GAP_MS`), so a burst drains in about a
 * second and the card is never far behind the Mate.
 *
 * - What stood at the first draw is there at once.
 * - A line landing from the live slot enters at once: it was on screen
 *   already, and moves; what follows it waits its gap.
 * - Everything enters at once when the run is over or the thread catches up
 *   (`flush`): nothing is held back once the run is idle.
 * - What leaves before it entered is forgotten.
 *
 * Pure: the caller offers the keys present at a time and draws what
 * `paceHolds` leaves out; `paceDue` says when it next changes on its own.
 */

/** The gap between two entrances when only a few wait. */
export const PACE_GAP_MS = 150;

/** The shortest gap: never three entrances within 100 ms. */
export const PACE_MIN_GAP_MS = 60;

/** The gap shrinks so that what waits enters within about this long. */
const PACE_DRAIN_MS = 540;

export interface Pace {
  /** Keys that entered. */
  readonly shown: ReadonlySet<string>;
  /** Keys waiting to enter, in order. */
  readonly waiting: ReadonlyArray<string>;
  /** When the last entrance began, and the gap it set for the next. */
  readonly lastAt: number | null;
  readonly gap: number;
}

/** The gap before the next entrance with `backlog` waiting. */
export function paceGap(backlog: number): number {
  return Math.max(PACE_MIN_GAP_MS, Math.min(PACE_GAP_MS, PACE_DRAIN_MS / Math.max(1, backlog)));
}

/** The pace as first drawn: what stands is there. */
export function paceStart(keys: ReadonlyArray<string>): Pace {
  return { shown: new Set(keys), waiting: [], lastAt: null, gap: PACE_GAP_MS };
}

/** When the next one waiting enters, or null. */
export function paceDue(pace: Pace): number | null {
  if (pace.waiting.length === 0) return null;
  return pace.lastAt === null ? Number.NEGATIVE_INFINITY : pace.lastAt + pace.gap;
}

/**
 * The keys present at `at`, in order: new ones wait their turn, a landing one
 * enters at once, one gone is forgotten; then the next enters if due. An offer
 * that changes nothing returns the pace it was given.
 */
export function paceOffer(
  pace: Pace,
  offer: {
    readonly keys: ReadonlyArray<string>;
    readonly at: number;
    readonly landing: ReadonlySet<string>;
    readonly flush: boolean;
  },
): Pace {
  const present = new Set(offer.keys);
  if (offer.flush) {
    const fresh = offer.keys.filter((key) => !pace.shown.has(key));
    if (fresh.length === 0 && pace.waiting.length === 0) return pace;
    return { ...pace, shown: new Set([...pace.shown, ...fresh]), waiting: [] };
  }
  let shown = pace.shown;
  let lastAt = pace.lastAt;
  let gap = pace.gap;
  const landed = offer.keys.filter((key) => offer.landing.has(key) && !shown.has(key));
  if (landed.length > 0) {
    shown = new Set([...shown, ...landed]);
    lastAt = offer.at;
  }
  const queued = new Set(pace.waiting);
  const waiting = [
    ...pace.waiting.filter((key) => present.has(key) && !shown.has(key)),
    ...offer.keys.filter((key) => !shown.has(key) && !queued.has(key)),
  ];
  if (landed.length > 0) gap = paceGap(waiting.length);
  const same =
    shown === pace.shown &&
    waiting.length === pace.waiting.length &&
    waiting.every((key, index) => pace.waiting[index] === key);
  return enter(same ? pace : { shown, waiting, lastAt, gap }, offer.at);
}

/** Lets the next one in if it is due. */
function enter(pace: Pace, at: number): Pace {
  const due = paceDue(pace);
  if (due === null || at < due) return pace;
  const [next, ...rest] = pace.waiting;
  return {
    shown: new Set([...pace.shown, next!]),
    waiting: rest,
    lastAt: at,
    gap: paceGap(rest.length),
  };
}

/** The keys among `keys` that do not show yet: what waits, and what the pace has not heard of. */
export function paceHolds(pace: Pace, keys: ReadonlyArray<string>): ReadonlySet<string> {
  return new Set(keys.filter((key) => !pace.shown.has(key)));
}
