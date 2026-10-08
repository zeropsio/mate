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
import {
  firstBuildTargets,
  firstBuildsOf,
  type FirstBuildState,
} from "@t3tools/client-runtime/data";

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
