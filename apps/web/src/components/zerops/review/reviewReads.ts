/**
 * What a review's sheet names beside its own reads, off the candidate list the left menu reads
 * too: the project's name, a Mate's preview, the address production answers at, and the stage
 * that follows `main`.
 */
import { buildZeropsGroupTree, pairPreviewRoute } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";

/** The project's name, as the menu names it. */
export function useGroupName(groupId: string): string | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(
    () =>
      buildZeropsGroupTree(heldCandidates(listing).rows, { order: "name" }).groups.find(
        (entry) => entry.group.groupId === groupId,
      )?.group.name,
    [groupId, listing],
  );
}

/** Where a Zerops project answers: a Mate's pair's stage half, or a production's first route. */
function useRoute(
  projectId: string | undefined,
  pick: "pair" | "first",
): { readonly url: string; readonly host: string } | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    if (projectId === undefined) return undefined;
    const row = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
    const routes = row?.routes ?? [];
    const route =
      pick === "pair" ? pairPreviewRoute(routes, row?.services?.hostnames ?? []) : routes[0];
    return route === undefined ? undefined : { url: route.url, host: route.host };
  }, [listing, pick, projectId]);
}

/** The Mate's preview: "Try it". There is none per change; the Mate's own stands for it. */
export function useMatePreview(mateProjectId: string) {
  return useRoute(mateProjectId, "pair");
}

/** The address production answers at: "Production now … at shop.acme.com". */
export function useProductionHost(projectId: string | undefined): string | undefined {
  return useRoute(projectId, "first")?.host;
}

/** The stage that follows `main`: where a merge lands first. */
export function mainStageOf(
  flow: ZeropsProjectFlow,
): ZeropsProjectFlow["environmentInputs"][number] | undefined {
  return flow.environmentInputs.find(
    (entry) =>
      entry.tier === "stage" &&
      flow.environments.find((row) => row.projectId === entry.projectId)?.source === "main",
  );
}
