/**
 * The overview's cards have had their first fill in this document (`CardRow`): the page's fill,
 * which its filters come in with, so the page's words and its cards stand in one frame. After
 * that the filters wait for nothing: a later visit's cards answer for themselves.
 */
import { useSyncExternalStore } from "react";

let filled = false;
const listeners = new Set<() => void>();

/** A row's first fill has begun: told in the same pass as the row's own cards. */
export function cardRowFilled(): void {
  if (filled) return;
  filled = true;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useCardRowFirstFilled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => filled,
    // Drawn with no page to load (a server's markup, a test's): nothing holds.
    () => true,
  );
}

/** A row's own word that its first fill has begun, read as the document's is: in one pass. */
export function makeRowFill(): {
  readonly filled: () => boolean;
  readonly fill: () => void;
  readonly subscribe: (listener: () => void) => () => void;
} {
  let own = false;
  const heard = new Set<() => void>();
  return {
    filled: () => own,
    fill: () => {
      if (own) return;
      own = true;
      cardRowFilled();
      for (const listener of heard) listener();
    },
    subscribe: (listener) => {
      heard.add(listener);
      return () => heard.delete(listener);
    },
  };
}

/** A new document's fill, for a test that loads twice. */
export function resetCardRowFill(): void {
  filled = false;
}
