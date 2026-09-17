/**
 * Asks for the account inventory to be read again: a fresh verification
 * round, and every organization's baseline re-read on a fresh receiver while
 * what is held stays up (`ZeropsInventoryProvider`, `runtime.refresh`).
 */

import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): number {
  return version;
}

/** Refresh after a confirmed local platform change or an external event. */
export function refreshZeropsCandidates(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function useZeropsCandidatesVersion(): number {
  return useSyncExternalStore(subscribe, read, read);
}
