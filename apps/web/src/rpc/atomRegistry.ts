import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { onAccountLifetimeClose } from "../zerops/accountLifetime";
import { createElement } from "react";

export let appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: React.PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}

/** Account teardowns still running, which the closing account's registry outlives. */
let teardowns: Array<Promise<unknown>> = [];

/**
 * Keeps the closing account's registry until `teardown` settles: an account runtime shutting down
 * still publishes its last state (a grant closing) after the account's lifetime closed.
 */
export function holdRegistryUntil(teardown: Promise<unknown>): void {
  teardowns.push(teardown);
}

/**
 * The next account gets a fresh registry at once; the closing one's goes once every teardown that
 * held it has settled — one ordered account teardown, nothing written into a disposed registry.
 */
export function resetAppAtomRegistry() {
  const closing = appAtomRegistry;
  const held = teardowns;
  teardowns = [];
  appAtomRegistry = AtomRegistry.make();
  if (held.length === 0) closing.dispose();
  else void Promise.allSettled(held).then(() => closing.dispose());
}

export const resetAppAtomRegistryForTests = resetAppAtomRegistry;
onAccountLifetimeClose(resetAppAtomRegistry);
