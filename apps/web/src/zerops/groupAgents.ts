/**
 * The agents a group's existing environments are signed in with, so a Mate born into that group
 * offers the same ones instead of the platform's whole menu (`agentSelection.ts`): each
 * environment's service read once more at the creation, and unioned.
 *
 * A read that fails is no reason to refuse a creation: it adds no agent, and with none at all the
 * import leaves `ZCP_AGENTS` out and the container offers every agent — exactly what it did before
 * this existed.
 */
import { RegistryContext } from "@effect/atom-react";
import { servicesAgents } from "@t3tools/client-runtime/data";
import { unionAgents, type ZeropsAgentType } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useCallback, useContext } from "react";

import { useAccountDataOptional } from "./ZeropsAccountData";

export type ReadGroupAgents = (
  environments: ReadonlyArray<{ readonly item: ZeropsCandidate }>,
) => Promise<ReadonlyArray<ZeropsAgentType>>;

export function useReadGroupAgents(): ReadGroupAgents {
  const registry = useContext(RegistryContext);
  const account = useAccountDataOptional();
  return useCallback(
    async (environments) => {
      const orgId = account?.orgId ?? null;
      if (account === null || orgId === null) return [];
      const serviceIds = environments.flatMap(({ item }) =>
        item.service === undefined ? [] : [item.service.id],
      );
      const read = await Promise.all(
        serviceIds.map((ownerId) => account.readDetail({ family: "serviceAgents", ownerId })),
      );
      const agents = registry.get(account.data.project(servicesAgents, { orgId, serviceIds }));
      // Only what a read at this creation answered: a failed one adds no agent.
      return unionAgents(
        serviceIds.flatMap((serviceId, index) => {
          const value = agents[serviceId]?.value;
          return read[index] === true && value !== undefined ? [value] : [];
        }),
      );
    },
    [account, registry],
  );
}
