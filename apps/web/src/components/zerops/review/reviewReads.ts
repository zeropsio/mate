/**
 * What a review's sheet names beside its own reads, off the candidate list the left menu reads
 * too: the project's name, its Draft, and the stage that follows `main`.
 */
import { buildCanonicalGroupTree, flowChange } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { draftLook, type DraftLook } from "@t3tools/client-runtime/zerops/draftLook";
import { mateParts } from "@t3tools/client-runtime/zerops/mateParts";
import { classicCopyRead } from "@t3tools/client-runtime/zerops/serviceMap";
import { useMemo, useState } from "react";
import { useMatesLeases } from "~/zerops/useMatesLeases";
import { useHqAppDetail, useHqAppReleases } from "~/zerops/useHqAppDetail";

import { useHqAddress } from "~/zerops/projectFlows";
import { useLinkedChange } from "~/zerops/useLinkedChange";
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

/** The change named by a draft pane, kept through a gap between HQ's lists. */
export function useDraftChange(change: {
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
}) {
  const detail = useHqAppDetail(change.groupId);
  const address = useHqAddress();
  const record = detail.changes?.find(
    (entry) => entry.repo === change.repository && entry.number === change.number,
  );
  const linked = useLinkedChange(
    record === undefined
      ? { appId: change.groupId, repo: change.repository, number: change.number }
      : null,
  );
  const linkedPull = linked.kind === "read" ? linked.pull : undefined;
  const current = useMemo(
    () => (record === undefined ? linkedPull : flowChange(record, address)),
    [record, linkedPull, address],
  );
  const [held, setHeld] = useState(current);
  if (current !== undefined && current !== held) setHeld(current);
  return current ?? held;
}

/** The part's app address and the open branch's draft. */
export function useMatePreviews(
  appId: string,
  mateProjectId: string,
  mateTier: string | undefined,
  repository: string,
  repositoryUrl: string | undefined,
  state: "open" | "adding" | "merging" | "merged" | "closed",
  branch: string | undefined,
): ReviewTryTargets & { readonly draft: DraftLook } {
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
  const classicBranch = classic.branch;
  return useMemo(() => {
    const targets = tryItTargets({
      routes: row?.routes ?? [],
      hostnames: row?.services?.hostnames ?? [],
      pools: row?.services?.pools,
      controlPlane: row?.service?.name,
      tier: mateTier,
      repository,
      repositoryUrl,
      repositoryRemote,
      poolPairs,
    });
    const parts =
      row?.services === undefined
        ? undefined
        : mateParts({
            services: row.services.hostnames.map((hostname) => ({ hostname })),
            routes: row.routes ?? [],
            pools: row.services.pools,
            controlPlane: row.service?.name,
            tier: mateTier,
            poolPairs,
          }).parts;
    const classicPart = parts?.find((part) => part.devService === repository && !part.pooled);
    return {
      ...targets,
      draft: draftLook({
        state,
        branch,
        repositoryUrl,
        repositoryRemote,
        leases: row?.services?.pools?.length === 0 ? [] : leases,
        classic:
          parts === undefined
            ? undefined
            : classicPart === undefined
              ? null
              : {
                  hostname: classicPart.devService,
                  branch: classicBranch,
                },
      }),
    };
  }, [
    row,
    mateTier,
    repository,
    repositoryUrl,
    repositoryRemote,
    state,
    branch,
    leases,
    poolPairs,
    classicBranch,
  ]);
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
