/**
 * What a review's sheet names beside its own reads, off the candidate list the left menu reads
 * too: the project's name, a Mate's previews, the address production answers at, and the stage
 * that follows `main`.
 */
import {
  buildZeropsGroupTree,
  pairPreviewRoutes,
  placeAddresses,
  type GroupFlowAddress,
  type GroupFlowPreview,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useMemo } from "react";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { useZeropsCandidates, useZeropsDetailCandidates } from "~/zerops/useZeropsCandidates";

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
 * you know?"). Its repository's only, where a change names one: its pair's stage, each part's.
 */
export function useMatePreviews(
  mateProjectId: string,
  /** The Mate tier on `main` (`ZeropsProjectFlow.mateTier`). */
  mateTier: string | undefined,
  /** The change's repository; `undefined` for every pair's. */
  repository: string | undefined,
): ReadonlyArray<ReviewPreview> {
  const { listing } = useZeropsDetailCandidates();
  return useMemo(() => {
    const row = heldCandidates(listing).rows.find((entry) => entry.project.id === mateProjectId);
    const previews = pairPreviewRoutes(
      row?.routes ?? [],
      row?.services?.hostnames ?? [],
      mateTier,
      repository,
    );
    return previews.length === 0
      ? NO_PREVIEWS
      : previews.map((preview) => ({
          ...preview,
          host: preview.url.replace(/^[a-z]+:\/\//iu, "").replace(/\/+$/u, ""),
        }));
  }, [listing, mateProjectId, mateTier, repository]);
}

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

/** The stage that follows `main`: where a merge lands first. */
export function mainStageOf(
  flow: ZeropsProjectFlow,
): ZeropsProjectFlow["environmentInputs"][number] | undefined {
  return flow.environmentInputs.find(
    (entry) =>
      entry.tier === "stage" &&
      flow.environments.find((row) => row.id === entry.id)?.source === "main",
  );
}
