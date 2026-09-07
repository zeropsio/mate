/** One invalidation signal for the shared, account-owned inventory. */

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
