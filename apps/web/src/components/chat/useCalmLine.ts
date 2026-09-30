/**
 * A line as it shows, calm (`nowLineCalm.logic`): what the run does now once
 * the line before it has stood its dwell, the latest of a burst only, and the
 * run's end (`final`) at once.
 */
import { useEffect, useLayoutEffect, useState } from "react";

import { calmLineDue, calmLineOffer, calmLineSettle, calmLineStart } from "./nowLineCalm.logic";

export function useCalmLine<T>(latest: T, key: string, final: boolean): T {
  const [calm, setCalm] = useState(() => calmLineStart(latest, key, Date.now()));
  useLayoutEffect(() => {
    setCalm((current) => calmLineOffer(current, latest, key, Date.now(), final));
  }, [latest, key, final]);
  const due = calmLineDue(calm);
  useEffect(() => {
    if (due === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Woken before the dwell has ended — a timer firing early, a wall clock
    // stepped back — it waits out the rest rather than sticking.
    const arm = () => {
      timer = setTimeout(
        () => {
          const at = Date.now();
          if (at < due) arm();
          else setCalm((current) => calmLineSettle(current, at));
        },
        Math.max(0, due - Date.now()),
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, [due]);
  // The words shown are drawn from the latest line: a thought's newest words,
  // a step's details.
  return calm.key === key ? latest : calm.shown;
}
