/**
 * The band, holding its endings (pass 35): a bar the person watched run —
 * a stand-up's builds, a background task — shows how it ended for
 * `BAND_ENDING_MS` before its room eases shut. The band sits at the edge of
 * the eye, so an ending there must be noticed before it leaves. Only what was
 * drawn running here ends here: a conversation opened onto a finished run,
 * or caught up by a resync, holds nothing.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  BAND_ENDING_MS,
  bandKeys,
  bandSeenNext,
  type BandSeen,
  withEndingsHeld,
  type DockModel,
} from "./conversationDock.logic";

/** `syncing`: the thread catches up after a reload or a reconnect — what it brings ended unwatched. */
export function useEndingsHeld(dock: DockModel | null, syncing = false): DockModel | null {
  const [seen, setSeen] = useState<BandSeen & { readonly dock: DockModel | null }>(() => ({
    dock,
    running: bandKeys(dock),
    held: new Set(),
    ends: new Map(),
  }));
  // A new dock: what it no longer runs, and the band drew running, is held.
  if (seen.dock !== dock) setSeen({ dock, ...bandSeenNext(seen, dock, syncing) });
  // Each held ending's timer, by its key and which ending it is: one that
  // ends again while held starts its time over.
  const timers = useRef(
    new Map<string, { readonly ending: number; readonly timer: ReturnType<typeof setTimeout> }>(),
  );
  useEffect(() => {
    for (const key of seen.held) {
      const ending = seen.ends.get(key) ?? 0;
      const running = timers.current.get(key);
      if (running?.ending === ending) continue;
      if (running !== undefined) clearTimeout(running.timer);
      timers.current.set(key, {
        ending,
        timer: setTimeout(() => {
          timers.current.delete(key);
          setSeen((current) => {
            const held = new Set(current.held);
            held.delete(key);
            return { ...current, held };
          });
        }, BAND_ENDING_MS),
      });
    }
  }, [seen.held, seen.ends]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const { timer } of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return useMemo(() => withEndingsHeld(dock, seen.held), [dock, seen.held]);
}
