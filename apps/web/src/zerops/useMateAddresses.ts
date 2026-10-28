/**
 * A Mate's public addresses (`mateAddresses`), read from what the account
 * already holds: the Mate's project topology, the dev servers the
 * conversation's lifecycle last read, and the group's stage and production
 * projects in the inventory. No request of its own — the topology's contents
 * are the same ones the conversation and project panel read. The Mate's parts
 * come from the one reader (`mateParts`): its dev pools' workspaces are the leases zcp holds for
 * the whole Mate in the lifecycle's newest envelope (`lifecycleLeases`), each by the chat it is for
 * (`useLeaseChats`), and a part migrated to a dev pool pairs its stage with the pool as that
 * envelope keys it (`poolPairsOf`).
 */
import { derivePublicRoutes } from "@t3tools/client-runtime/zerops";
import { lifecycleLeases, poolPairsOf } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useContext, useMemo } from "react";

import { InventoryContext } from "./inventoryContext";
import { groupAddressEnvironments, mateAddresses, type MateAddress } from "./mateAddresses.logic";
import { useLeaseChats } from "./useMatesLeases";
import { useProjectsServiceValues } from "./ZeropsAccountData";
import { useEnvironmentProjectRef, useZeropsLifecycle, useZeropsTopology } from "./useZeropsFeeds";

const NO_ADDRESSES: ReadonlyArray<MateAddress> = [];

export interface MateAddressesRead {
  readonly addresses: ReadonlyArray<MateAddress>;
  /** False while the topology, or a group project the account is still reading, is unread. */
  readonly known: boolean;
}

export function useMateAddresses(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): MateAddressesRead {
  const topology = useZeropsTopology(environmentId);
  const lifecycle = useZeropsLifecycle(environmentId, threadId);
  const leaseChats = useLeaseChats(environmentId);
  const project = useEnvironmentProjectRef(environmentId);
  const inventory = useContext(InventoryContext);
  const projectIds = useMemo(
    () => (inventory === null ? [] : inventory.projects.map(({ id }) => id)),
    [inventory],
  );
  const services = useProjectsServiceValues(projectIds);
  return useMemo(() => {
    if (topology === undefined) return { addresses: NO_ADDRESSES, known: false };
    const group =
      project === null || inventory === null
        ? undefined
        : groupAddressEnvironments({
            projectId: project.projectId,
            projects: inventory.projects,
            routesOf: (entry) => {
              const listed = services[entry.id];
              return listed === undefined ? undefined : derivePublicRoutes(entry, listed);
            },
          });
    const addresses = mateAddresses({
      services: topology.services,
      leases: lifecycleLeases(lifecycle),
      leaseChats,
      poolPairs: poolPairsOf(lifecycle),
      ownRole: group?.ownRole,
      environments: group?.environments ?? [],
    });
    return {
      addresses: addresses.length === 0 ? NO_ADDRESSES : addresses,
      // An unread project reads as failed once the account's read settles: then it is known absent.
      known: group === undefined || !group.pending || inventory?.isLoading !== true,
    };
  }, [topology, lifecycle, leaseChats, project, inventory, services]);
}
