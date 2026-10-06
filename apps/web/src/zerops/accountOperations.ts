/**
 * The account's operations: one coordinator per account store and session client, with Zerops
 * and the organization's official HQ wired as the owners of their kinds. A verb submits an intent here and reads where it stands through
 * the operation's progress projection; it never calls the platform itself.
 */
import {
  accountReadsAtom,
  makeHqExecutor,
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
import { createContext, useContext } from "react";

import { randomUUID } from "~/lib/utils";

import { hqWritesOf } from "./hqWrites";
import { accountThrowawayDebt } from "./throwawayDebt";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";

type SessionClient = ZeropsSessionValue["client"];

export interface AccountOperations {
  /** Records and sends one intent; resolves with where it stands once its owner has answered. */
  readonly submit: (intent: Parameters<Operations["submit"]>[0]) => Promise<{
    readonly requestId: string;
    readonly progress: OperationProgress;
    /** What the owner said of how it ended, once it has; `null` before. */
    readonly evidence: string | null;
  }>;
  /**
   * Asks the owner again after a lost answer — by its facts where it keeps no ids: never a send.
   * What it cannot tell yet stays uncertain.
   */
  readonly askAgain: (requestId: string) => Promise<void>;
  /** Resolves once the operation is final for now, or can no longer be followed (`operationEnd`). */
  readonly untilEnd: (requestId: string, orgId: string) => Promise<NonNullable<OperationEnd>>;
}

const coordinators = new WeakMap<AccountStore, WeakMap<SessionClient, AccountOperations>>();

export function accountOperations(
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  client: SessionClient,
  demandDetail: (demand: DetailDemand) => () => void,
  revalidate: (demand: DetailDemand) => void,
): AccountOperations {
  let byClient = coordinators.get(store);
  if (byClient === undefined) {
    byClient = new WeakMap();
    coordinators.set(store, byClient);
  }
  const held = byClient.get(client);
  if (held !== undefined) return held;
  // A browser without Web Locks has its project record writes serialized within the page only.
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  const operations = makeOperations({
    store,
    executors: {
      zerops: makeZeropsExecutor({
        client,
        store,
        registry,
        demandDetail,
        revalidate: (orgId, demand) => {
          if (registry.get(accountReadsAtom)?.orgId === orgId) revalidate(demand);
        },
        debtOf: () => accountThrowawayDebt(client),
        nowMs: () => Date.now(),
        ...(locks === undefined ? {} : { locks }),
      }),
      hq: makeHqExecutor({ apiOf: hqWritesOf }),
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
    askAgain: (requestId) => Effect.runPromise(operations.retry(requestId)),
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

/** The mounted account's operations, which its data mount builds over the store it owns. */
export const AccountOperationsContext = createContext<AccountOperations | null>(null);

export function useAccountOperations(): AccountOperations {
  const operations = useContext(AccountOperationsContext);
  if (operations === null)
    throw new Error("useAccountOperations must be used inside ZeropsAccountData.");
  return operations;
}
