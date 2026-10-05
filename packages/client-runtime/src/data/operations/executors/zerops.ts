/**
 * Zerops as an operation's owner, over the account's REST client: each Zerops kind's executor,
 * picked by the intent's kind. Zerops keeps no request ids, so a lost answer is resolved by the
 * kind's `effectHandles` over the store's facts, never by asking or sending again.
 *
 * @module data/operations/executors/zerops
 */
import type { AtomRegistry } from "effect/unstable/reactivity";

import type { ZeropsApiClient } from "../../../zerops/api.ts";
import type { ThrowawayDebt } from "../../../zerops/doorThrowaway.ts";
import type { DetailDemand } from "../../demand.ts";
import type { AccountStore } from "../../store.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { mateRestartOwner } from "./mateRestart.ts";
import { throwawaySweepExecutor } from "./throwawaySweep.ts";

type ZeropsOperationsClient = Pick<
  ZeropsApiClient,
  | "restartService"
  | "stopService"
  | "startService"
  | "listIntegrationTokens"
  | "deleteIntegrationToken"
>;

export function makeZeropsExecutor(input: {
  readonly client: ZeropsOperationsClient;
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
  /** The account's hold on a detail while an operation needs it observed. */
  readonly demandDetail: (demand: DetailDemand) => () => void;
  readonly debtOf: (clientId: string) => ThrowawayDebt;
  readonly nowMs: () => number;
}): OperationExecutor {
  const { client } = input;
  const restart = mateRestartOwner({
    platform: {
      restartService: (serviceId) => client.restartService(serviceId),
      stopService: (serviceId) => client.stopService(serviceId),
      startService: (serviceId) => client.startService(serviceId),
    },
    store: input.store,
    registry: input.registry,
    holdHistory: (projectId) =>
      input.demandDetail({ family: "process", listing: "history", ownerId: projectId }),
  });
  const sweep = throwawaySweepExecutor({
    platform: {
      listIntegrationTokens: async (clientId) =>
        (await client.listIntegrationTokens(clientId)).map((token) => ({
          id: token.id,
          name: token.name,
          created: token.created,
          createdByUser: token.createdByUser,
        })),
      deleteIntegrationToken: (target) => client.deleteIntegrationToken(target),
    },
    debtOf: input.debtOf,
    nowMs: input.nowMs,
  });
  return {
    submit: (requestId, intent) => {
      switch (intent.kind) {
        case "mate-restart":
          return restart.submit(requestId, intent);
        case "throwaway-sweep":
          return sweep(requestId, intent);
      }
    },
  };
}
