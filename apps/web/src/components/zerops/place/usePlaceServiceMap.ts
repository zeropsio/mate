import {
  EMPTY_PROJECT_TOPOLOGY_SNAPSHOT,
  inventoryTopology,
  usageOwnerOf,
} from "@t3tools/client-runtime/data";
import {
  buildZeropsServiceMap,
  type ZeropsServiceRow,
} from "@t3tools/client-runtime/zerops/serviceMap";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { useAccountDataOptional, useDetailDemand, useProjection } from "~/zerops/ZeropsAccountData";

const NO_TOPOLOGY = Atom.make(EMPTY_PROJECT_TOPOLOGY_SNAPSHOT);

/**
 * A place's services as the service map joins them — each one's type, its use now and its last
 * day — from the account's store, demanded while the place's page shows them.
 */
export function usePlaceServiceMap(projectId: string | undefined): {
  readonly rows: ReadonlyArray<ZeropsServiceRow> | undefined;
  readonly usageRead: boolean;
} {
  const account = useAccountDataOptional();
  const orgId = account?.orgId ?? null;
  const owner = orgId === null || projectId === undefined ? null : usageOwnerOf(orgId, projectId);
  useDetailDemand("usage", undefined, owner);
  useDetailDemand("usageHistory", undefined, owner);
  const snapshot = useProjection(
    inventoryTopology,
    orgId === null || projectId === undefined
      ? null
      : { orgId, projectId, viewer: account?.viewer },
    NO_TOPOLOGY,
  );
  return useMemo(() => {
    const map = buildZeropsServiceMap(snapshot.view);
    return {
      rows: map?.groups.flatMap((group) => group.rows),
      usageRead: map?.usageRead ?? false,
    };
  }, [snapshot.view]);
}
