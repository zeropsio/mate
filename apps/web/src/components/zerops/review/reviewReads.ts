/**
 * What a review's sheet names beside its own reads, off the candidate list the left menu reads
 * too: the project's name, a Mate's previews, the address production answers at, and the stage
 * that follows `main`.
 */
import {
  buildZeropsGroupTree,
  pairPreviewRoutes,
  type GroupFlowPreview,
} from "@t3tools/client-runtime/zerops";
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

/** A Mate's preview as "Try it" offers it: its service, its address, and where that answers. */
export interface ReviewPreview extends GroupFlowPreview {
  readonly host: string;
}

const NO_PREVIEWS: ReadonlyArray<ReviewPreview> = [];

/**
 * The Mate's previews: "Try it", one per service and named by it. There is none per change; the
 * Mate's own stand for it, each — a frontend and a backend are two, and nothing says which a
 * change touched (the owner, 2026-10-11: "there are multiple services, backend, frontend, how do
 * you know?").
 */
export function useMatePreviews(mateProjectId: string): ReadonlyArray<ReviewPreview> {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    const row = heldCandidates(listing).rows.find((entry) => entry.project.id === mateProjectId);
    const previews = pairPreviewRoutes(row?.routes ?? [], row?.services?.hostnames ?? []);
    return previews.length === 0
      ? NO_PREVIEWS
      : previews.map((preview) => ({
          ...preview,
          host: preview.url.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, ""),
        }));
  }, [listing, mateProjectId]);
}

/** The address production answers at, its first route: "Production now … at shop.acme.com". */
export function useProductionHost(projectId: string | undefined): string | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(() => {
    if (projectId === undefined) return undefined;
    const row = heldCandidates(listing).rows.find((entry) => entry.project.id === projectId);
    return row?.routes?.[0]?.host;
  }, [listing, projectId]);
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
