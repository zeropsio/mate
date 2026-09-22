import { captureAccountLifetime } from "./accountLifetime";
import { inventoryCandidates } from "./inventoryContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { beginEnvironmentIdentityExchange, rememberEnvironment } from "./rememberedEnvironments";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { rememberEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  exchangeZeropsContainerIdentity as exchangeZeropsContainerIdentityShared,
  type ZeropsDoorThrowaway,
  type ZeropsIdentityExchangeResult,
} from "@t3tools/client-runtime/zerops/identityExchange";
import { zeropsThrowawayPlatform } from "@t3tools/client-runtime/zerops/doorThrowaway";
import { useCallback } from "react";

import { browserZeropsStorage } from "./storage";

import { appBasePath } from "~/basePath";
import { connectZeropsIdentity } from "~/connection/onboarding";
import { randomUUID } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { promoteCreationHandoff } from "./creationHandoffStorage";
import { rememberZeropsEnvironment } from "./firstPromptStorage";
import { useZeropsSession } from "./ZeropsSessionProvider";

export type { ZeropsIdentityExchangeResult };

export async function exchangeZeropsContainerIdentity<E>(input: {
  readonly containerOrigin: string;
  readonly appOrigin: string;
  readonly basePath: string;
  readonly throwaway: ZeropsDoorThrowaway | null;
  readonly connect: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
  }) => Promise<AtomCommandResult<EnvironmentId, E>>;
}): Promise<ZeropsIdentityExchangeResult> {
  return exchangeZeropsContainerIdentityShared(
    { throwaway: input.throwaway, connect: input.connect },
    input.containerOrigin,
    { servedApp: { origin: input.appOrigin, basePath: input.basePath } },
  );
}

/**
 * Remembers which project and organization a successfully exchanged
 * environment belongs to — the one write every path that can land an
 * environment here (connect, auto-connect, restore, repair) must make the
 * same way (H12): the signer tag (`useZeropsAgentSigner.ts`) reads this ref
 * to know which project to tag, and a path that skipped it left a second
 * browser's sign-in succeeding with every turn still refused because the
 * tag was never written.
 *
 * Best-effort and silent on failure: the environment is connected either
 * way, and a write that failed here is retried the next time anything
 * reconnects this origin.
 */
export async function rememberExchangedProjectRef(
  storage: ZeropsStorageAdapter,
  environmentId: EnvironmentId,
  candidate: { readonly project: { readonly id: string } },
  clientId: string | undefined,
): Promise<void> {
  if (!clientId) return;
  try {
    await rememberEnvironmentProjectRef(storage, environmentId, {
      projectId: candidate.project.id,
      orgId: clientId,
      source: "connect",
    });
  } catch {
    // Best effort — see the doc comment above.
  }
}

export function useZeropsIdentityExchange() {
  const { client, activeOrganization } = useZeropsSession();
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
          retryable: false,
        };
      // The token is minted in the org that owns the Mate's project — the
      // active organization only stands in when the project read carried none.
      const clientId = candidate.project.clientId ?? activeOrganization?.id;
      const finish = beginEnvironmentIdentityExchange(containerOrigin);
      try {
        const result = await exchangeZeropsContainerIdentity({
          containerOrigin,
          appOrigin: window.location.origin,
          basePath: appBasePath(),
          throwaway:
            client.session?.accessToken && clientId
              ? {
                  platform: zeropsThrowawayPlatform(client),
                  clientId,
                  projectId: candidate.project.id,
                  nonce: randomUUID(),
                }
              : null,
          connect: (input) => connect({ ...input, expectedProjectId: candidate.project.id }),
        });
        if (result._tag === "Success" && alive()) {
          rememberEnvironment({ key: candidate.key, environmentId: String(result.environmentId) });
          rememberZeropsEnvironment(String(result.environmentId));
          promoteCreationHandoff(candidate.project.id, String(result.environmentId));
          void rememberExchangedProjectRef(
            browserZeropsStorage,
            result.environmentId,
            candidate,
            clientId,
          );
        }
        return result;
      } finally {
        finish();
      }
    },
    [activeOrganization, client, connect, inventory.projects, inventory.services, inventory.error],
  );
}
