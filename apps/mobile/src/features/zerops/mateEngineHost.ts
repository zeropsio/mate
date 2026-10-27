/**
 * The signed-in account's engine conversations on mobile: one host over the account's store,
 * set where the app's thread readers and commands find it (the app's registry), gone with its
 * account. An engine Mate's conversation is read and written through it; a V1 Mate never touches it.
 */
import type { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  makeMateEngineHost,
  mateEngineHostAtom,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { AtomRegistry } from "effect/reactivity";

export function mountMateEngineHost(options: {
  /** The app's registry: where thread readers and commands look for the host. */
  readonly app: AtomRegistry.AtomRegistry;
  /** The account's registry, which its store publishes into. */
  readonly atoms: AtomRegistry.AtomRegistry;
  readonly store: AccountStore;
  readonly connection: EnvironmentRegistry["Service"];
  readonly makeId: () => string;
}): () => void {
  const host = makeMateEngineHost({
    store: options.store,
    atoms: options.atoms,
    registry: options.connection,
    makeId: options.makeId,
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  options.app.set(mateEngineHostAtom, host);
  return () => {
    if (options.app.get(mateEngineHostAtom) === host) options.app.set(mateEngineHostAtom, null);
    host.close();
  };
}
