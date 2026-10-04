/**
 * The pace a run's lines enter at, as drawn (`runPace.logic`): offered on
 * every draw, on its own clock between. Returns the keys to leave out this
 * draw — what waits its turn, and what arrived since the pace last heard, so
 * nothing shows a frame early.
 */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { paceDue, paceHolds, paceOffer, paceStart, type Pace } from "./runPace.logic";

const NOTHING_LANDS: ReadonlySet<string> = new Set();

export function usePace({
  keys,
  landing = NOTHING_LANDS,
  flush,
}: {
  /** The keys present, in order. */
  readonly keys: ReadonlyArray<string>;
  /** The keys landing from the live slot this draw: they enter at once. */
  readonly landing?: ReadonlySet<string>;
  /** Everything enters at once: the run is over, or the thread catches up. */
  readonly flush: boolean;
}): ReadonlySet<string> {
  const [pace, setPace] = useState<Pace>(() => paceStart(keys));
  const paceRef = useRef(pace);
  const offer = useEffectEvent(() => {
    const next = paceOffer(paceRef.current, { keys, at: Date.now(), landing, flush });
    if (next === paceRef.current) return;
    paceRef.current = next;
    setPace(next);
  });
  // Offered on every draw, before it paints: one that changes nothing keeps the pace.
  useLayoutEffect(() => offer());
  const due = paceDue(pace);
  useEffect(() => {
    if (due === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Woken early, it waits out the rest rather than sticking.
    const arm = () => {
      timer = setTimeout(
        () => {
          if (Date.now() < due) arm();
          else offer();
        },
        Math.max(0, due - Date.now()),
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, [due]);
  if (flush) return NOTHING_LANDS;
  // A line landing from the slot is drawn in the draw it lands in: its plop
  // starts from where it stood.
  const holds = paceHolds(pace, keys);
  return landing.size === 0 ? holds : new Set([...holds].filter((key) => !landing.has(key)));
}
