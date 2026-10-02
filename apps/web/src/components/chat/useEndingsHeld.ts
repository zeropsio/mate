/**
 * The band, holding its endings (pass 35): a bar the person watched run —
 * a stand-up's builds, a background task — shows how it ended for
 * `BAND_ENDING_MS` before its room eases shut. The band sits at the edge of
 * the eye, so an ending there must be noticed before it leaves. Only what was
 * drawn running here ends here: a conversation opened onto a finished run
 * holds nothing.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import {
  BAND_ENDING_MS,
  bandKeys,
  endedSince,
  withEndingsHeld,
  type DockModel,
} from "./conversationDock.logic";

export function useEndingsHeld(dock: DockModel | null): DockModel | null {
  const [seen, setSeen] = useState<{
    readonly dock: DockModel | null;
    readonly running: ReadonlySet<string>;
    readonly held: ReadonlySet<string>;
  }>(() => ({ dock, running: bandKeys(dock), held: new Set() }));
  // A new dock: what it no longer runs, and the band drew running, is held.
  if (seen.dock !== dock) {
    const ended = endedSince(seen.running, dock);
    setSeen({
      dock,
      running: bandKeys(dock),
      held: ended.length === 0 ? seen.held : new Set([...seen.held, ...ended]),
    });
  }
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const key of seen.held) {
      if (timers.current.has(key)) continue;
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          setSeen((current) => {
            const held = new Set(current.held);
            held.delete(key);
            return { ...current, held };
          });
        }, BAND_ENDING_MS),
      );
    }
  }, [seen.held]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return useMemo(() => withEndingsHeld(dock, seen.held), [dock, seen.held]);
}
