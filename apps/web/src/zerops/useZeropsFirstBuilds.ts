/**
 * Every listed Mate's first build, as its project's processes say it (`firstBuildState`).
 *
 * A container waiting for its first build (`READY_TO_DEPLOY`) looks the same from its status
 * whether the build is queued, slow or failed: only the build's own process tells. Its project's
 * activity and process history are read while such a container is listed, and no longer — the
 * verdict is the process's, never a clock's.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { useMemo } from "react";

import { useProjectsProcesses } from "./activity/useProjectsProcesses";
import { firstBuildState, type FirstBuildState } from "./mateComing";

/** A candidate whose container waits for its first build, and where its build's process is read. */
export interface FirstBuildTarget {
  readonly key: string;
  readonly projectId: string;
  readonly serviceId: string;
}

/** The candidates whose container waits for its first build. */
export function firstBuildTargets(
  candidates: ReadonlyArray<Pick<ZeropsCandidate, "key" | "project" | "service">>,
): ReadonlyArray<FirstBuildTarget> {
  return candidates.flatMap((candidate) =>
    candidate.service?.status === "READY_TO_DEPLOY"
      ? [{ key: candidate.key, projectId: candidate.project.id, serviceId: candidate.service.id }]
      : [],
  );
}

/** Each target's first build, by candidate key, from its project's processes as read. */
export function firstBuildsOf(
  targets: ReadonlyArray<FirstBuildTarget>,
  processesOf: (projectId: string) => Parameters<typeof firstBuildState>[0],
): ReadonlyMap<string, FirstBuildState> {
  const builds = new Map<string, FirstBuildState>();
  for (const target of targets) {
    const state = firstBuildState(processesOf(target.projectId), target.serviceId);
    if (state !== undefined) builds.set(target.key, state);
  }
  return builds;
}

export function useZeropsFirstBuilds(
  candidates: ReadonlyArray<ZeropsCandidate>,
): ReadonlyMap<string, FirstBuildState> {
  const targets = useMemo(() => firstBuildTargets(candidates), [candidates]);
  const projectIds = useMemo(() => targets.map((target) => target.projectId), [targets]);
  const processes = useProjectsProcesses(projectIds);
  return useMemo(
    () => firstBuildsOf(targets, (projectId) => processes.get(projectId)),
    [processes, targets],
  );
}
