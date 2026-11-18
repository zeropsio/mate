import { placeAddresses, type GroupFlowAddress } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";

/**
 * The addresses production answers at, one per service (`placeAddresses`): "Production now … at
 * shop.acme.com" where it serves one, and each part's own row where it runs several
 * (`productionNow`).
 */
export function useProductionAddresses(
  projectId: string | undefined,
): ReadonlyArray<GroupFlowAddress> {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    if (projectId === undefined) return NO_ADDRESSES;
    const row = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
    return placeAddresses(row?.routes ?? []);
  }, [listing, projectId]);
}
const NO_ADDRESSES: ReadonlyArray<GroupFlowAddress> = [];
