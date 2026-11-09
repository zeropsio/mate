/**
 * The creations of production services this tab runs, by the ask that started each: the card
 * reads its operation by it (`serviceCreation`), so it says how far the create is while the person
 * scrolls away and back. Memory only: after a reload a card reads HQ's plan and decision record.
 */
import { serviceCreation, type ServiceCreation } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { useProjection } from "./accountData";
import { onAccountLifetimeClose } from "./accountLifetime";

let runs: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

const changed = (next: ReadonlyMap<string, string>) => {
  runs = next;
  for (const listener of listeners) listener();
};

/** Records that the ask `askId` runs the operation `requestId` here. */
export function beginServiceCreation(askId: string, requestId: string): void {
  changed(new Map([...runs, [askId, requestId]]));
}

onAccountLifetimeClose(() => changed(new Map()));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => runs;

const NOT_RUN = Atom.make<ServiceCreation>({
  progress: { stage: "unknown" },
  acceptedAtMs: undefined,
});

/** Where the create the ask `askId` runs in this tab stands; unknown where it runs none. */
export function useServiceCreation(askId: string): ServiceCreation {
  const requestId = useSyncExternalStore(subscribe, snapshot, snapshot).get(askId);
  return useProjection(serviceCreation, requestId ?? null, NOT_RUN);
}
