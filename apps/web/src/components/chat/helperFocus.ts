/**
 * Which helper the person asked to see, per conversation: a helper's row in
 * the run card opens the helpers panel on that helper's own card. A press is
 * a new ask each time (`at`), so pressing the same helper again brings its
 * card back into view.
 */
import { useSyncExternalStore } from "react";

export interface HelperFocus {
  readonly threadKey: string;
  readonly helperId: string;
  readonly at: number;
}

let focus: HelperFocus | null = null;
let asks = 0;
const listeners = new Set<() => void>();

export function showHelper(threadKey: string, helperId: string): void {
  asks += 1;
  focus = { threadKey, helperId, at: asks };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The last helper asked for in this conversation; null when none was. */
export function useHelperFocus(threadKey: string | null): HelperFocus | null {
  const current = useSyncExternalStore(
    subscribe,
    () => focus,
    () => null,
  );
  return current !== null && current.threadKey === threadKey ? current : null;
}
