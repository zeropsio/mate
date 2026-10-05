/**
 * The account's operations: one coordinator per account store and session client, with Zerops
 * wired as the owner of its kinds. A verb submits an intent here and reads where it stands through
 * the operation's progress projection; it never calls the platform itself.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  makeOperations,
  makeZeropsExecutor,
  operationEnd,
  operationProgress,
  type AccountStore,
  type DetailDemand,
  type OperationEnd,
  type OperationProgress,
  type Operations,
} from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { useContext, useMemo } from "react";

import { randomUUID } from "~/lib/utils";

import { accountThrowawayDebt } from "./throwawayDebt";
import { useAccountData } from "./ZeropsAccountData";
import { useZeropsSession } from "./ZeropsSessionProvider";

type SessionClient = ReturnType<typeof useZeropsSession>["client"];

export interface AccountOperations {
  /** Records and sends one intent; resolves with where it stands once its owner has answered. */
  readonly submit: (intent: Parameters<Operations["submit"]>[0]) => Promise<{
    readonly requestId: string;
    readonly progress: OperationProgress;
    /** What the owner said of how it ended, once it has; `null` before. */
    readonly evidence: string | null;
  }>;
  /** Resolves once the operation is final for now, or can no longer be followed (`operationEnd`). */
  readonly untilEnd: (requestId: string, orgId: string) => Promise<NonNullable<OperationEnd>>;
}

const coordinators = new WeakMap<AccountStore, WeakMap<SessionClient, AccountOperations>>();

function accountOperations(
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  client: SessionClient,
  demandDetail: (demand: DetailDemand) => () => void,
): AccountOperations {
  let byClient = coordinators.get(store);
  if (byClient === undefined) {
    byClient = new WeakMap();
    coordinators.set(store, byClient);
  }
  const held = byClient.get(client);
  if (held !== undefined) return held;
  const operations = makeOperations({
    store,
    executors: {
      zerops: makeZeropsExecutor({
        client,
        store,
        registry,
        demandDetail,
        debtOf: () => accountThrowawayDebt(client),
        nowMs: () => Date.now(),
      }),
    },
    makeId: randomUUID,
  });
  const untilEnd = (requestId: string, orgId: string) =>
    new Promise<NonNullable<OperationEnd>>((resolve) => {
      const atom = store.data.project(operationEnd, { requestId, orgId });
      let cancel: () => void = () => {};
      cancel = registry.subscribe(
        atom,
        (end) => {
          if (end === null) return;
          resolve(end);
          cancel();
        },
        { immediate: true },
      );
    });
  const made: AccountOperations = {
    untilEnd,
    submit: async (intent) => {
      const requestId = await Effect.runPromise(operations.submit(intent));
      const outcome = store.state().operations.get(requestId)?.receipt?.outcome;
      return {
        requestId,
        progress: registry.get(store.data.project(operationProgress, requestId)),
        evidence: outcome === undefined || outcome.kind === "pending" ? null : outcome.evidence,
      };
    },
  };
  byClient.set(client, made);
  return made;
}

export function useAccountOperations(): AccountOperations {
  const { store, demandDetail } = useAccountData();
  const registry = useContext(RegistryContext);
  const { client } = useZeropsSession();
  return useMemo(
    () => accountOperations(store, registry, client, demandDetail),
    [client, demandDetail, registry, store],
  );
}
