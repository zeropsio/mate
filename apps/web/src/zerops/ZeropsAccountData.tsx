import { useMateFeeds } from "./useMateFeeds";
/**
 * The signed-in account's data layer: one store per account (its atom registry), and the active
 * organization's Zerops navigation observed for as long as it is shown, with the details screens
 * hold. Components read the store through projections only.
 */
import { MateImages } from "../assets/MateImagesProvider";
import { RegistryContext } from "@effect/atom-react";
import {
  makeAccountStore,
  closeSharedMateSetupDemand,
  mateConversationStoreAtom,
  creationPressStoreAtom,
  makeVaultReveal,
  makeZeropsWire,
  observeAccount,
  repairZeropsSession,
  accountReadsAtom,
} from "@t3tools/client-runtime/data";
import { useContext, useEffect, useMemo, type ReactNode } from "react";

import { MateBrowserFrames } from "./browserStreamLinks";
import { useAccountWorkspace } from "./accountWorkspace";
import { useAccountDatabase } from "./accountDatabase";
import { useAccountBuildLogs } from "./accountBuildLogs";
import { onAccountLifetimeClose } from "./accountLifetime";
import { accountOperations, AccountOperationsContext } from "./accountOperations";
import { useMateResultsSeen, useOpenMatesAttention } from "./mateAttentionLinks";
import { useZeropsSession } from "./ZeropsSessionProvider";

import { AccountDataContext, AccountStoreContext } from "./accountData";
export * from "./accountData";

export function ZeropsAccountData({ children }: { readonly children: ReactNode }) {
  const { client, status, activeOrganization } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const store = useMemo(() => makeAccountStore(registry), [registry]);
  useEffect(() => {
    registry.set(mateConversationStoreAtom, store);
    registry.set(creationPressStoreAtom, store);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      closeSharedMateSetupDemand(store);
      if (registry.get(mateConversationStoreAtom) === store)
        registry.set(mateConversationStoreAtom, null);
      if (registry.get(creationPressStoreAtom) === store)
        registry.set(creationPressStoreAtom, null);
    };
    const stop = onAccountLifetimeClose(close);
    return () => {
      stop();
      close();
    };
  }, [registry, store]);
  useMateFeeds(store);
  const observation = useMemo(
    () =>
      observeAccount({
        store,
        wire: makeZeropsWire({ client }),
        repairSession: repairZeropsSession(client),
      }),
    [client, store],
  );
  const logs = useAccountBuildLogs(client, store);
  const reveal = useMemo(() => makeVaultReveal(client), [client]);
  const database = useAccountDatabase(store);
  useAccountWorkspace(store);
  const orgId = status === "signed-in" ? (activeOrganization?.id ?? null) : null;
  // The account's lifetime closes (sign-out, another account) before React unmounts this, and
  // disposes the registry right after: the account's data ends first, so what the unmounting
  // screens still release publishes nothing.
  useEffect(() => onAccountLifetimeClose(observation.close), [observation]);
  useEffect(() => {
    observation.show(orgId);
  }, [observation, orgId]);
  useEffect(() => () => observation.stop(), [observation]);
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const resume = () => {
      if (document.visibilityState === "visible" && navigator.onLine) observation.resume();
    };
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("resume", resume);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("resume", resume);
    };
  }, [observation]);
  const value = useMemo(
    () => ({
      data: store.data,
      database,
      viewer: activeOrganization ?? undefined,
      orgId,
      demandDetail: observation.demandDetail,
      renewHeld: observation.renewHeld,
      readDetail: observation.readDetail,
      revalidate: observation.revalidate,
      retryDetail: observation.retryDetail,
      retry: observation.retry,
      showHq: observation.showHq,
      moveOffers: observation.moveOffers,
      handoverCandidates: observation.handoverCandidates,
      logs,
      reveal,
      compare: observation.compare,
    }),
    [activeOrganization, database, logs, observation, orgId, reveal, store],
  );
  // Each open Mate's attention straight from it, and what the person saw of its results to HQ.
  useOpenMatesAttention(store);
  useMateResultsSeen(store, orgId, observation.seen);
  // The operations are built here, over the store this mount owns: no screen reaches its writer.
  const operations = useMemo(
    () =>
      accountOperations(
        store,
        registry,
        client,
        observation.demandDetail,
        observation.revalidate,
        observation.readDetail,
      ),
    [client, observation, registry, store],
  );
  // The account's reads move to each new value as it comes, never unset between: a moment without
  // them would read every organization's listing as gone. They go only with this mount.
  useEffect(() => {
    if (!observation.closed()) registry.set(accountReadsAtom, value);
  }, [observation, registry, value]);
  useEffect(
    () => () => {
      if (!observation.closed()) registry.set(accountReadsAtom, null);
    },
    [observation, registry],
  );
  return (
    <AccountStoreContext value={store}>
      <MateImages store={store}>
        <AccountDataContext value={value}>
          <MateBrowserFrames store={store}>
            <AccountOperationsContext value={operations}>{children}</AccountOperationsContext>
          </MateBrowserFrames>
        </AccountDataContext>
      </MateImages>
    </AccountStoreContext>
  );
}
