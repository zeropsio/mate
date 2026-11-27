/**
 * What a review's sheet names beside its own reads, off the candidate list the left menu reads
 * too: the project's name, a Mate's previews and the stage that follows `main`.
 */
import { buildCanonicalGroupTree } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { classicCopyRead } from "@t3tools/client-runtime/zerops/serviceMap";
import { useMemo } from "react";
import { useMatesLeases } from "~/zerops/useMatesLeases";
import { useHqAppReleases } from "~/zerops/useHqAppDetail";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { stageDeploysMerges } from "./ZeropsReview.logic";
import { tryItTargets, type ReviewTryTargets } from "@t3tools/client-runtime/zerops/tryItTargets";
import { useZeropsCandidates, useZeropsDetailCandidates } from "~/zerops/useZeropsCandidates";

/** The project's name, as the menu names it. */
export function useGroupName(groupId: string): string | undefined {
  const { listing } = useZeropsCandidates();
  return useMemo(
    () =>
      buildCanonicalGroupTree(heldCandidates(listing).rows, { order: "name" }).groups.find(
        (entry) => entry.group.groupId === groupId,
      )?.group.name,
    [groupId, listing],
  );
}

/** The part's app address and the open branch's draft. */
export function useMatePreviews(
  appId: string,
  mateProjectId: string,
  mateTier: string | undefined,
  repository: string,
  repositoryUrl: string | undefined,
  open: boolean,
  branch: string | undefined,
): ReviewTryTargets {
  const { listing } = useZeropsDetailCandidates();
  const appIds = useMemo(() => [appId], [appId]);
  const repo = useHqAppReleases(appIds)
    .repos.get(appId)
    ?.find((entry) => entry.name === repository);
  const repositoryRemote = repo?.remote?.url ?? repo?.follows;
  const copies = useMatesLeases([{ projectId: mateProjectId }])[mateProjectId];
  const leases = copies?.leases;
  const poolPairs = copies?.poolPairs;
  const row = heldCandidates(listing).rows.find((entry) => entry.project.id === mateProjectId);
  const classic = classicCopyRead(repository, copies?.copies);
  const classicServers = classic.devServers;
  const classicBranch = classic.branch;
  return useMemo(
    () =>
      tryItTargets({
        routes: row?.routes ?? [],
        hostnames: row?.services?.hostnames ?? [],
        pools: row?.services?.pools,
        controlPlane: row?.service?.name,
        tier: mateTier,
        repository,
        repositoryUrl,
        repositoryRemote,
        open,
        branch,
        leases: row?.services === undefined ? undefined : leases,
        poolPairs,
        classicBranch,
        classicServers,
      }),
    [
      row,
      mateTier,
      repository,
      repositoryUrl,
      repositoryRemote,
      open,
      branch,
      leases,
      poolPairs,
      classicBranch,
      classicServers,
    ],
  );
}

/**
 * Every stage that deploys what merges into `main` (`stageDeploysMerges`): it follows `main` and
 * has deployed from it.
 */
export function mainStagesOf(
  flow: ZeropsProjectFlow,
): ReadonlyArray<ZeropsProjectFlow["environmentInputs"][number]> {
  return flow.environmentInputs.filter((entry) => {
    if (entry.tier !== "stage") return false;
    const row = flow.environments.find((candidate) => candidate.id === entry.id);
    return row !== undefined && stageDeploysMerges(row);
  });
}
