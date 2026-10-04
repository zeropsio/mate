/**
 * The live slot as it shows (`liveSlot.logic`): what is live enters, what
 * ended stands its minimum and plops, a burst rides along — on one timer, the
 * way `useCalmLine` paces the now line. `onChange` hears a change before it
 * is drawn, while the slot still shows what is leaving it: where a row stood
 * is where its plop starts.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  slotDue,
  slotOffer,
  slotResync,
  slotSettle,
  slotStart,
  type LiveSlot,
} from "./liveSlot.logic";

export function useLiveSlot({
  live,
  record,
  final,
  syncing = false,
  quietFrom,
  onChange,
}: {
  readonly live: ReadonlyArray<string>;
  readonly record: ReadonlyArray<string>;
  /** The run is over: everything is history at once. */
  readonly final: boolean;
  /**
   * The thread catches up after a reload or a reconnect: what it brings is
   * history at once, never an arrival that stands or plops (`slotResync`).
   */
  readonly syncing?: boolean;
  /** When the quiet began, from the data (`SlotOffer.quietFrom`). */
  readonly quietFrom?: number;
  /**
   * Hears a change before it is drawn. `redrawn`: heard right after a draw of
   * the card, which may have moved things already — where they stood is what
   * was painted before it.
   */
  readonly onChange?: (from: LiveSlot, to: LiveSlot, redrawn: boolean) => void;
}): LiveSlot {
  const [slot, setSlot] = useState(() =>
    slotStart({ live, record, at: Date.now(), ...(quietFrom === undefined ? {} : { quietFrom }) }),
  );
  const slotRef = useRef(slot);
  // What the slot's own clock offers with: the draw's `onChange`, kept as
  // drawn. Never through an effect event: in a production build one called
  // from a layout effect ran the draw before's offer, and a change arriving in
  // the last draw was never heard (the timeline's pace, 2026-10-04).
  const onChangeRef = useRef(onChange);
  const move = (
    next: LiveSlot,
    redrawn: boolean,
    heard: ((from: LiveSlot, to: LiveSlot, redrawn: boolean) => void) | undefined,
  ) => {
    const from = slotRef.current;
    if (next === from) return;
    heard?.(from, next, redrawn);
    slotRef.current = next;
    setSlot(next);
  };
  // Offered on every draw, with what this draw holds: an offer that changes
  // nothing returns the slot it was given.
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    if (syncing && !final) {
      // Nobody watched it: no landing to draw.
      const next = slotResync(slotRef.current, {
        live,
        record,
        at: Date.now(),
        ...(quietFrom === undefined ? {} : { quietFrom }),
      });
      if (next === slotRef.current) return;
      slotRef.current = next;
      // oxlint-disable-next-line react/set-state-in-effect -- the slot is a clock synced to what is drawn
      setSlot(next);
      return;
    }
    move(slotOffer(slotRef.current, { live, record, at: Date.now(), final }), true, onChange);
  });
  const due = slotDue(slot);
  useEffect(() => {
    if (due === null) return;
    // What stood its minimum plops, heard as it is drawn next.
    const settle = () => {
      const from = slotRef.current;
      const next = slotSettle(from, Date.now());
      if (next === from) return;
      onChangeRef.current?.(from, next, false);
      slotRef.current = next;
      setSlot(next);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Woken before it is due — a timer firing early, a wall clock stepped
    // back — it waits out the rest rather than sticking.
    const arm = () => {
      timer = setTimeout(
        () => {
          if (Date.now() < due) arm();
          else settle();
        },
        Math.max(0, due - Date.now()),
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, [due]);
  return slot;
}
