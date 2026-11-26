/**
 * What a review's sheet names beside its own reads, off the candidate list the left menu reads
 * too: the project's name, a Mate's previews and the stage that follows `main`.
 */
import { buildCanonicalGroupTree } from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { devServersOf } from "@t3tools/client-runtime/zerops/serviceMap";
import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import type { HqReviewBuild } from "@t3tools/shared/hqChanges";
import { useProjectSitesOf } from "../projectPartsShown";
import { useHqMainChats } from "~/zerops/useMenuMateReadings";
import { useMatesLeases } from "~/zerops/useMatesLeases";
import { useZeropsLifecycle } from "~/zerops/useZeropsFeeds";
import { useHqAppReleases } from "~/zerops/useHqAppDetail";
import { vcsStatus } from "~/state/workspace";

import type { ZeropsProjectFlow } from "~/zerops/projectFlows";
import { stageDeploysMerges, tryItTargets, type ReviewTryTargets } from "./ZeropsReview.logic";
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

const NO_BRANCH = Atom.make<string | null | undefined>(undefined);

/** The branch's Preview and the Review build at its current head. */
export function useMatePreviews(
  appId: string,
  mateProjectId: string,
  mateTier: string | undefined,
  repository: string,
  repositoryUrl: string | undefined,
  branch: string | undefined,
  head: string | undefined,
  reviewBuild: HqReviewBuild | undefined,
): ReviewTryTargets {
  const { listing } = useZeropsDetailCandidates();
  const appIds = useMemo(() => [appId], [appId]);
  const repo = useHqAppReleases(appIds)
    .repos.get(appId)
    ?.find((entry) => entry.name === repository);
  const repositoryRemote = repo?.remote?.url ?? repo?.follows;
  const sites = useProjectSitesOf(mateProjectId);
  const mainChat = useHqMainChats()(mateProjectId);
  const threadKey =
    sites?.mates.find((mate) => mate.candidate.project.id === mateProjectId)?.threadKey ??
    (mainChat === undefined ? undefined : scopedThreadKey(mainChat));
  const leases = useMatesLeases([{ projectId: mateProjectId, threadKey }])[mateProjectId]?.leases;
  const thread = threadKey === undefined ? null : parseScopedThreadKey(threadKey);
  const row = heldCandidates(listing).rows.find((entry) => entry.project.id === mateProjectId);
  const pooled = (row?.services?.pools?.length ?? 0) > 0;
  const lifecycle = useZeropsLifecycle(
    pooled ? null : (thread?.environmentId ?? null),
    pooled ? null : (thread?.threadId ?? null),
  );
  const classicServers = devServersOf(repository, lifecycle);
  const classicAtom = useMemo(() => {
    if (thread === null || pooled) return NO_BRANCH;
    return Atom.make((get): string | null | undefined => {
      const status = get(
        vcsStatus({
          environmentId: thread.environmentId,
          input: { cwd: `/var/www/${repository}` },
        }),
      );
      const value = Option.getOrUndefined(AsyncResult.value(status));
      return value === undefined ? undefined : value.isRepo ? value.refName : null;
    });
  }, [thread?.environmentId, pooled, repository]);
  const classicBranch = useAtomValue(classicAtom);
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
        branch,
        head,
        reviewBuild,
        leases: row?.services === undefined ? undefined : leases,
        classicBranch,
        classicServers,
      }),
    [
      row,
      mateTier,
      repository,
      repositoryUrl,
      repositoryRemote,
      branch,
      head,
      reviewBuild,
      leases,
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
