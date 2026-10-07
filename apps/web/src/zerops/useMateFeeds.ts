import { whenShown } from "./whenShown";
/** Owns demanded Mate source adapters for this account only. */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  makeMateFeeds,
  sharedMateSetupDemand,
  mateFeedServices,
  makeMateActions,
  mateActionsAtom,
  makeMateFeedWire,
  mateFeedReadsAtom,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useEffect } from "react";
import { randomUUID } from "~/lib/utils";
import { connectionAtomRuntime } from "../connection/runtime";
import { onAccountLifetimeClose } from "./accountLifetime";
const registryAtom = connectionAtomRuntime.atom(mateFeedServices);
export function useMateFeeds(store: AccountStore) {
  const atomRegistry = useContext(RegistryContext);
  const connection = Option.getOrUndefined(AsyncResult.value(useAtomValue(registryAtom)));
  useEffect(() => {
    if (connection === undefined) return;
    const { registry, httpClient } = connection;
    const host = makeMateFeeds({ store, wire: makeMateFeedWire(registry, httpClient) });
    const reads = { data: store.data, ...host };
    const actions = makeMateActions({
      store,
      registry,
      setup: sharedMateSetupDemand(store, whenShown),
      makeId: randomUUID,
      revalidate: (action, environmentId) => {
        if (action === "agentAuthCheck")
          host.retry({ family: "mateAgentAuth", environmentId, input: {} });
        if (action === "crewFilesPut")
          host.revalidate({ family: "mateCrewFiles", environmentId, input: {} });
      },
    });
    atomRegistry.set(mateActionsAtom, actions);
    atomRegistry.set(mateFeedReadsAtom, reads);
    const unsubscribe = onAccountLifetimeClose(() => {
      actions.close();
      host.close();
    });
    return () => {
      unsubscribe();
      if (atomRegistry.get(mateFeedReadsAtom) === reads) atomRegistry.set(mateFeedReadsAtom, null);
      actions.close();
      if (atomRegistry.get(mateActionsAtom) === actions) atomRegistry.set(mateActionsAtom, null);
      host.close();
    };
  }, [atomRegistry, connection, store]);
}
