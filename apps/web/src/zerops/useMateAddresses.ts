/**
 * A Mate's public addresses (`mateAddresses`), read from what the account
 * already holds: the Mate's project topology and the group's stage and
 * production projects in the inventory. No request of its own — the topology's
 * interest is the conversation's (`useProjectTopology` in ChatView).
 */
import { derivePublicRoutes } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import { useContext, useMemo } from "react";

import { InventoryContext } from "./inventoryContext";
import { groupAddressEnvironments, mateAddresses, type MateAddress } from "./mateAddresses.logic";
import { useEnvironmentProjectRef, useEnvironmentTopology } from "./useZeropsFeeds";

const NO_ADDRESSES: ReadonlyArray<MateAddress> = [];

export interface MateAddressesRead {
  readonly addresses: ReadonlyArray<MateAddress>;
  /** False while the topology, or a group project the account is still reading, is unread. */
  readonly known: boolean;
}

export function useMateAddresses(environmentId: EnvironmentId | null): MateAddressesRead {
  const topology = useEnvironmentTopology(environmentId).view;
  const project = useEnvironmentProjectRef(environmentId);
  const inventory = useContext(InventoryContext);
  return useMemo(() => {
    if (topology === undefined) return { addresses: NO_ADDRESSES, known: false };
    const group =
      project === null || inventory === null
        ? undefined
        : groupAddressEnvironments({
            projectId: project.projectId,
            projects: inventory.projects,
            routesOf: (entry) => {
              const outcome = inventory.services.get(entry.id);
              return outcome?.status === "resolved"
                ? derivePublicRoutes(entry, outcome.services)
                : undefined;
            },
          });
    const addresses = mateAddresses({
      services: topology.services,
      ownRole: group?.ownRole,
      environments: group?.environments ?? [],
    });
    return {
      addresses: addresses.length === 0 ? NO_ADDRESSES : addresses,
      // An unread project reads as failed once the account's read settles: then it is known absent.
      known: group === undefined || !group.pending || inventory?.isLoading !== true,
    };
  }, [topology, project, inventory]);
}
