import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { onAccountLifetimeClose } from "../zerops/accountLifetime";
import { createElement } from "react";

export let appAtomRegistry = AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: React.PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}

export function resetAppAtomRegistry() {
  appAtomRegistry.dispose();
  appAtomRegistry = AtomRegistry.make();
}

export const resetAppAtomRegistryForTests = resetAppAtomRegistry;
onAccountLifetimeClose(resetAppAtomRegistry);
