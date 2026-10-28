/**
 * A Mate's public addresses (`mateAddresses`), read from what the account
 * already holds: the Mate's project topology, the dev servers the
 * conversation's lifecycle last read, and the group's stage and production
 * projects in the inventory. No request of its own — the topology's contents
 * are the same ones the conversation and project panel read. The Mate's parts
 * come from the one reader (`mateParts`): its dev pools' workspaces are the leases zcp holds for
 * the whole Mate in the lifecycle's newest envelope (`lifecycleLeases`), each by the chat it is for
 * (the conversation's own, `useThreadShell`), and a part migrated to a dev pool pairs its stage with the pool as that
 * envelope keys it (`poolPairsOf`). Where a dev service or a workspace runs several dev servers,
 * each running one is listed (`devServersOf`, the leases' own).
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { derivePublicRoutes } from "@t3tools/client-runtime/zerops";
import {
  devServersOf,
  lifecycleLeases,
  poolPairsOf,
  standInsOf,
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
  // The conversation's own lease goes by its title; the Mate's other workspaces by "dev". Every
  // chat's bindings (`useLeaseChats`) are not read here: on a change's review, reloaded, reading
  // them held the review's files and merge check back (review.scenario's reload cases).
  const threadRef = useMemo(
    () =>
      environmentId === null || threadId === null ? null : scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const shell = useThreadShell(threadRef);
  const lease = shell?.lease ?? null;
  const title = shell?.title;
  const leaseChats = useMemo(
    () =>
      lease === null || title === undefined
        ? []
        : [
            {
              alias: lease.alias,
              ...(lease.acquiredAt === undefined ? {} : { acquiredAt: lease.acquiredAt }),
              title,
            },
          ],
    [lease, title],
  );
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
      // A dev service running several dev servers lists each running one (`mateAddresses`).
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
