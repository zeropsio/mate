import { captureAccountLifetime } from "./accountLifetime";
import { inventoryCandidates } from "./inventoryContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { beginEnvironmentIdentityExchange, rememberEnvironment } from "./rememberedEnvironments";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  exchangeZeropsContainerIdentity as exchangeZeropsContainerIdentityShared,
  type ZeropsIdentityExchangeResult,
} from "@t3tools/client-runtime/zerops/identityExchange";
import { useCallback } from "react";

import { appBasePath } from "~/basePath";
import { connectZeropsIdentity } from "~/connection/onboarding";
import { useAtomCommand } from "~/state/use-atom-command";

import { promoteCreationHandoff } from "./creationHandoffStorage";
import { rememberZeropsEnvironment } from "./firstPromptStorage";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type { ZeropsIdentityExchangeResult };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  readonly appOrigin: string;
  readonly basePath: string;
  readonly zeropsToken: string | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly zeropsToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}): Promise<ZeropsIdentityExchangeResult> {
  return exchangeZeropsContainerIdentityShared(
    { zeropsToken: input.zeropsToken, connect: input.connect },
    input.containerOrigin,
    { servedApp: { origin: input.appOrigin, basePath: input.basePath } },
  );
}

export function useZeropsIdentityExchange() {
  const { client } = useZeropsSession();
  const inventory = useZeropsInventory();
  const connect = useAtomCommand(connectZeropsIdentity, { reportFailure: false });

  return useCallback(
    async (containerOrigin: string): Promise<ZeropsIdentityExchangeResult> => {
      const alive = captureAccountLifetime();
      const candidate = inventoryCandidates(inventory).find(
        (entry) =>
          entry.containerOrigin &&
          normalizeOrigin(entry.containerOrigin) === normalizeOrigin(containerOrigin),
      );
      if (!alive() || !candidate || inventory.error)
        return {
          _tag: "Failure",
          error: "This environment is not in your verified Zerops projects.",
        };
      const finish = beginEnvironmentIdentityExchange(containerOrigin);
      try {
        const result = await exchangeZeropsContainerIdentity({
          containerOrigin,
          appOrigin: window.location.origin,
          basePath: appBasePath(),
          zeropsToken: client.session?.accessToken ?? null,
          connect: (input) => connect({ ...input, expectedProjectId: candidate.project.id }),
        });
        if (result._tag === "Success" && alive()) {
          rememberEnvironment({ key: candidate.key, environmentId: String(result.environmentId) });
          rememberZeropsEnvironment(String(result.environmentId));
          promoteCreationHandoff(candidate.project.id, String(result.environmentId));
        }
        return result;
      } finally {
        finish();
      }
    },
    [client, connect, inventory.projects, inventory.services, inventory.error],
  );
}
