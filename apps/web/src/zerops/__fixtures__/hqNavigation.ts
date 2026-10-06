/**
 * HQ's navigation as the mounted account's store would hold it, for tests of the surfaces that read
 * it: a store seeded the way HQ's scope stream fills it, mounted as the account's reads.
 */
import {
  accountReadsAtom,
  makeAccountStore,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import { seedHqNavigation, type SeededHq } from "@t3tools/client-runtime/data/fixtures";
import type { AtomRegistry } from "effect/unstable/reactivity";

/**
 * Mounts a store holding `seed` for `orgId` in `registry` — or seeds `into`, a store a test
 * mounted already (`mountRoster`); seed it again to move HQ's word.
 */
export function mountHqNavigation(
  registry: AtomRegistry.AtomRegistry,
  orgId: string,
  seed: SeededHq = {},
  into?: AccountStore,
): { readonly store: AccountStore; readonly seed: (next: SeededHq) => void } {
  const store = into ?? makeAccountStore(registry);
  seedHqNavigation(store, orgId, seed);
  if (into === undefined)
    registry.set(accountReadsAtom, {
      data: store.data,
      orgId,
      demandDetail: () => () => {},
      renewHeld: () => {},
    });
  return { store, seed: (next) => seedHqNavigation(store, orgId, next) };
}
