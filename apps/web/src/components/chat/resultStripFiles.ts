/**
 * The files each turn's result strip draws, as the result itself placed them (`stripShowsFiles`
 * of its standing pictures): what an opened card leaves to the result rather than drawing again
 * in its steps. The result stands in a row of its own, so it hands the set over here, by its
 * turn's key, and the card reads its own turn's.
 */
import { useCallback, useSyncExternalStore } from "react";

/** How many turns' sets are kept; the least recently drawn go first. */
const KEPT_TURNS = 256;

const drawn = new Map<string, ReadonlySet<string>>();
const listeners = new Map<string, Set<() => void>>();

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((path) => b.has(path));

/** What `turnKey`'s strip draws now; its card's steps leave these to it. */
export function publishStripFiles(turnKey: string, files: ReadonlySet<string>): void {
  const before = drawn.get(turnKey);
  if (before !== undefined && same(before, files)) return;
  drawn.delete(turnKey);
  drawn.set(turnKey, files);
  for (const key of [...drawn.keys()].slice(0, Math.max(0, drawn.size - KEPT_TURNS))) {
    drawn.delete(key);
  }
  for (const listener of listeners.get(turnKey) ?? []) listener();
}

/** The files `turnKey`'s strip draws, `guess` until its result has said. */
export function useStripFiles(
  turnKey: string | null,
  guess: ReadonlySet<string>,
): ReadonlySet<string> {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (turnKey === null) return () => undefined;
      const own = listeners.get(turnKey) ?? new Set();
      own.add(listener);
      listeners.set(turnKey, own);
      return () => {
        own.delete(listener);
        if (own.size === 0) listeners.delete(turnKey);
      };
    },
    [turnKey],
  );
  const read = () => (turnKey === null ? guess : (drawn.get(turnKey) ?? guess));
  return useSyncExternalStore(subscribe, read, read);
}
