import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { environmentThreadDetails } from "../state/threads";
/** Surface binding for the account's turn receipts; no second copy of sent words. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { makeSendTurnReceipts } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useContext, useMemo } from "react";
import { useAccountStoreForAdapters } from "./ZeropsAccountData";
import { onAccountLifetimeClose } from "./accountLifetime";
export type { SentAsk } from "@t3tools/client-runtime/data";

const holders = new WeakMap<object, ReturnType<typeof makeSendTurnReceipts>>();
const active = new Set<ReturnType<typeof makeSendTurnReceipts>>();
onAccountLifetimeClose(() => {
  for (const holder of active) holder.close();
  active.clear();
});
const NONE = Atom.make<import("@t3tools/client-runtime/data").SentAsk | undefined>(undefined);
export function useSendTurnReceipts() {
  const store = useAccountStoreForAdapters();
  const registry = useContext(RegistryContext);
  return useMemo(() => {
    if (store === null) return null;
    let holder = holders.get(store);
    if (holder === undefined) {
      holder = makeSendTurnReceipts(store, registry);
      holders.set(store, holder);
      active.add(holder);
    }
    return holder;
  }, [registry, store]);
}
export function usePendingSentAsk(environmentId: string | undefined) {
  const holder = useSendTurnReceipts();
  const atom = useMemo(
    () => (holder === null || environmentId === undefined ? NONE : holder.atom(environmentId)),
    [environmentId, holder],
  );
  return useAtomValue(atom);
}
