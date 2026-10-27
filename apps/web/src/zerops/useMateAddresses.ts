/**
 * A Mate's public addresses (`mateAddresses`), read from what the account
 * already holds: the Mate's project topology, the dev servers the
 * conversation's lifecycle last read, and the group's stage and production
 * projects in the inventory. No request of its own — the topology's contents
 * are the same ones the conversation and project panel read. A thread bound to
 * a lease adds the dev servers zcp last read on each of its leases
 * (`threadLeasesOf`: the envelope's leases, never a service), under each one's name; a part
 * migrated to a dev pool pairs its stage with the pool as the lifecycle's envelope keys it
 * (`poolPairsOf`).
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { checkoutLabel, derivePublicRoutes } from "@t3tools/client-runtime/zerops";
import {
  devServersOf,
  leaseDevServersOf,
  poolPairsOf,
  threadLeasesOf,
} from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useContext, useMemo } from "react";

import { useThreadShell } from "../state/entities";
import { InventoryContext } from "./inventoryContext";
import { groupAddressEnvironments, mateAddresses, type MateAddress } from "./mateAddresses.logic";
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
  const threadRef = useMemo(
    () =>
      environmentId === null || threadId === null ? null : scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const lease = useThreadShell(threadRef)?.lease ?? null;
  const project = useEnvironmentProjectRef(environmentId);
  const inventory = useContext(InventoryContext);
  const projectIds = useMemo(
    () => (inventory === null ? [] : inventory.projects.map(({ id }) => id)),
    [inventory],
  );
  const services = useProjectsServiceValues(projectIds);
  return useMemo(() => {
    if (topology === undefined) return { addresses: NO_ADDRESSES, known: false };
    const leases = threadLeasesOf(lease, lifecycle);
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
      services: topology.services.map((service) => ({
        ...service,
        devServers: devServersOf(service.hostname, lifecycle),
      })),
      leases: leases.map(({ alias }) => ({
        alias,
        label: checkoutLabel(alias, leases),
        devServers: leaseDevServersOf(alias, lifecycle),
      })),
      poolPairs: poolPairsOf(lifecycle),
      ownRole: group?.ownRole,
      environments: group?.environments ?? [],
    });
    return {
      addresses: addresses.length === 0 ? NO_ADDRESSES : addresses,
      // An unread project reads as failed once the account's read settles: then it is known absent.
      known: group === undefined || !group.pending || inventory?.isLoading !== true,
    };
  }, [topology, lifecycle, lease, project, inventory, services]);
}
