/**
 * The account's operations: one coordinator per account store and session client, with Zerops
 * wired as the owner of its kinds. A verb submits an intent here and reads where it stands through
 * the operation's progress projection; it never calls the platform itself.
 */
import {
  makeOperations,
  makeZeropsExecutor,
  runToEnd,
  type RunToEnd,
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

import { readCarriedCore } from "./accountHq";
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
  /** Resolves once the operation is final for now, or can no longer be followed (`operationEnd`). */
  readonly untilEnd: (requestId: string, orgId: string) => Promise<NonNullable<OperationEnd>>;
  /** Runs one intent to its end: its owner's result, or what stopped it (`runToEnd`). */
  readonly run: RunToEnd;
}

const coordinators = new WeakMap<AccountStore, WeakMap<SessionClient, AccountOperations>>();

export function accountOperations(
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
        debtOf: () => accountThrowawayDebt(client),
        nowMs: () => Date.now(),
        // The Core this build carries, read from its own bundle once HQ's update runs.
        hqCore: readCarriedCore,
        ...(locks === undefined ? {} : { locks }),
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
    run: runToEnd({ operations, store, registry }),
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
