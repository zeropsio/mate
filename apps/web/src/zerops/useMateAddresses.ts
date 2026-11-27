/**
 * A Mate's public addresses (`mateAddresses`), read from what the account
 * already holds: the Mate's project topology and copies, and the group's stage
 * and production projects in the inventory. Workspaces are the Mate's leases
 * (`lifecycleLeases`), each named by its chat (`useLeaseChats`); a migrated
 * part pairs its stage with a pool from the Mate's copies (`poolPairsOf`).
 * Dev servers come from those same copies (`devServersOf`).
 */
import { derivePublicRoutes } from "@t3tools/client-runtime/zerops";
import {
  devServersOf,
  lifecycleLeases,
  poolPairsOf,
  standInsOf,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import { useContext, useMemo } from "react";

import { InventoryContext } from "./inventoryContext";
import {
  groupAddressEnvironments,
  mateAddresses,
  type MateAddress,
} from "@t3tools/client-runtime/zerops/mateAddresses";
import { useLeaseChats } from "./useLeaseChats";
import { useProjectsServiceValues } from "./ZeropsAccountData";
import { useEnvironmentProjectRef, useZeropsMateCopies, useZeropsTopology } from "./useZeropsFeeds";

const NO_ADDRESSES: ReadonlyArray<MateAddress> = [];

export interface MateAddressesRead {
  readonly addresses: ReadonlyArray<MateAddress>;
  /** False while the topology, or a group project the account is still reading, is unread. */
  readonly known: boolean;
}

export function useMateAddresses(environmentId: EnvironmentId | null): MateAddressesRead {
  const topology = useZeropsTopology(environmentId);
  const lifecycle = useZeropsMateCopies(environmentId);
  // Each workspace by the chat it is for, as Sites and the Zerops panel name it. This hook never
  // mounts on a change's review (`/change/…`), so reading every chat's binding holds no review back.
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
      // A dev service can list several dev servers (`mateAddresses`).
      services: topology.services.map((service) => ({
        ...service,
        devServers: devServersOf(service.hostname, lifecycle),
      })),
      leases: lifecycleLeases(lifecycle),
      leaseChats,
      poolPairs: poolPairsOf(lifecycle),
      standIns: standInsOf(lifecycle),
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
