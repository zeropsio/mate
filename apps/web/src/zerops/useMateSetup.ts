/** Setup demand shared by surfaces; source values and refusal live only in the account layer. */
import { useAtomValue } from "@effect/atom-react";
import {
  makeMateSetupDemand,
  mateSetupOwner,
  setupProgress,
  NO_SETUP_PROGRESS,
  type SetupProgress,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo } from "react";
import { useAccountDataOptional, useAccountStoreForAdapters } from "./ZeropsAccountData";
import { onAccountLifetimeClose } from "./accountLifetime";
import { whenShown } from "./whenShown";

export { mateSetupSettled } from "@t3tools/client-runtime/data";
export type MateSetupObserved = SetupProgress;
const NOTHING = Atom.make(NO_SETUP_PROGRESS);
const managers = new WeakMap<object, ReturnType<typeof makeMateSetupDemand>>();
const active = new Set<ReturnType<typeof makeMateSetupDemand>>();
onAccountLifetimeClose(() => {
  for (const manager of active) manager.close();
  active.clear();
});

/** Revalidation after this account's own action or explicit Try again. */
export function refreshMateSetup(origin: string): void {
  for (const manager of active) manager.refresh(origin);
}

export function useMateSetup(origin: string | undefined, epoch?: string): MateSetupObserved {
  const store = useAccountStoreForAdapters();
  const orgId = useAccountDataOptional()?.orgId;
  const manager = useMemo(() => {
    if (store === null) return null;
    let held = managers.get(store);
    if (held === undefined) {
      held = makeMateSetupDemand(store, whenShown);
      managers.set(store, held);
      active.add(held);
    }
    return held;
  }, [store]);
  const atom = useMemo(
    () =>
      store === null || origin === undefined || orgId == null
        ? NOTHING
        : store.data.project(setupProgress, mateSetupOwner(orgId, origin)),
    [orgId, origin, store],
  );
  useEffect(() => {
    if (manager === null || origin === undefined || orgId == null) return;
    return manager.demand(orgId, origin, epoch);
  }, [epoch, manager, orgId, origin]);
  return useAtomValue(atom);
}
