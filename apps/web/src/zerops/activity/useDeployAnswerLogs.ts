import { deployLogTarget } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { useMemo } from "react";
import { useZeropsProjectFlowOptional } from "../projectFlowContext";

/** HQ job ids join an answer to its project; environment names may change after the press. */
export function useDeployAnswerLogs(answer: HqDeployAnswer | undefined) {
  const flows = useZeropsProjectFlowOptional()?.flows;
  return useMemo(() => {
    const logs = new Map<
      string,
      {
        readonly projectId: string;
        readonly target: NonNullable<ReturnType<typeof deployLogTarget>>;
      }
    >();
    if (answer === undefined || flows === undefined) return logs;
    const asked = new Set(answer.jobs.flatMap(({ job }) => (job === null ? [] : [job])));
    for (const app of flows.values()) {
      for (const environment of app.environmentInputs) {
        for (const service of environment.services) {
          for (const job of [service.deploy?.latest, service.deploy?.live]) {
            if (job === undefined || job === null || !asked.has(job.id)) continue;
            const target = deployLogTarget(job);
            if (target !== undefined)
              logs.set(job.id, { projectId: environment.projectId, target });
          }
        }
      }
    }
    return logs;
  }, [answer, flows]);
}
