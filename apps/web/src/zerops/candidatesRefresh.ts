/**
 * One "reload the account" signal shared by every `useZeropsCandidates`
 * mount.
 *
 * The hook keeps its own fetch per mount — the sidebar has one, the projects
 * screen another — and a refresh that only bumped its own counter would leave
 * the other showing the account as it was. Creating an environment on the
 * projects screen must put it in the left menu without a reload, so the
 * counter lives here, outside any one mount.
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

/** Every mounted candidates hook reloads. */
export function refreshZeropsCandidates(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function useZeropsCandidatesVersion(): number {
  return useSyncExternalStore(subscribe, read, read);
}
