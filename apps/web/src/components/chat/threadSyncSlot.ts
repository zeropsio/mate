/**
 * Where the thread's sync indicator paints: a fixed-size slot the chat header
 * keeps at its trailing end, so a conversation catching up with its server
 * never moves the timeline or the composer. The header registers the element;
 * `ThreadSyncStatusPill`, rendered by the chat view where upstream stacked a
 * drawer above the composer, portals its spinner into it.
 */
import { useSyncExternalStore } from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function registerThreadSyncSlot(element: HTMLElement | null): void {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThreadSyncSlot(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => slot,
    () => null,
  );
}
