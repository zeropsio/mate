/**
 * The pace a run's lines enter at, as drawn (`runPace.logic`): offered on
 * every draw, on its own clock between. Returns the keys to leave out this
 * draw — what waits its turn, and what arrived since the pace last heard, so
 * nothing shows a frame early.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  // A tab out of sight, nobody watches: what arrives is simply there.
  const hidden = useOutOfSight();
  const flushing = flush || hidden;
  const [pace, setPace] = useState<Pace>(() => paceStart(keys));
  // What this draw offers, for the pace's own clock between draws. Read in
  // the layout effect as drawn, never through an effect event: in a
  // production build one called from a layout effect ran the draw before's
  // offer, and an answer arriving in a turn's last draw was never let in.
  const offeredRef = useRef({ keys, landing, flush: flushing });
  // Offered on every draw, before it paints: one that changes nothing keeps the pace.
  useLayoutEffect(() => {
    offeredRef.current = { keys, landing, flush: flushing };
    const next = paceOffer(pace, { keys, at: Date.now(), landing, flush: flushing });
    // oxlint-disable-next-line react/set-state-in-effect -- the pace is a clock synced to what is drawn
    if (next !== pace) setPace(next);
  });
  const due = paceDue(pace);
  useEffect(() => {
    if (due === null) return;
    const offer = () =>
      setPace((current) => {
        const { keys, landing, flush } = offeredRef.current;
        return paceOffer(current, { keys, at: Date.now(), landing, flush });
      });
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
  if (flushing) return NOTHING_LANDS;
  // A line landing from the slot is drawn in the draw it lands in: its plop
  // starts from where it stood.
  const holds = paceHolds(pace, keys);
  return landing.size === 0 ? holds : new Set([...holds].filter((key) => !landing.has(key)));
}

/** Whether the page is out of sight (a tab in the background). */
function readOutOfSight(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function useOutOfSight(): boolean {
  const [hidden, setHidden] = useState(readOutOfSight);
  useEffect(() => {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return;
    }
    const heard = () => setHidden(readOutOfSight());
    document.addEventListener("visibilitychange", heard);
    return () => document.removeEventListener("visibilitychange", heard);
  }, []);
  return hidden;
}
