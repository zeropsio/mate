import { deployAnswerFollowing, deployLogTarget } from "@t3tools/client-runtime/zerops/hq";
import type { HqJob } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { useMemo } from "react";
import { useZeropsProjectFlowOptional } from "../projectFlowContext";

/**
 * An answer's jobs as HQ's stream carries them now, and the log each can open. HQ job ids join an
 * answer to its project; environment names may change after the press. The answer is only what
 * the request saw: the streamed state of its jobs is what it says.
 */
export function useDeployAnswerFollowing(answer: HqDeployAnswer | undefined) {
  const flows = useZeropsProjectFlowOptional()?.flows;
  return useMemo(() => {
    const logs = new Map<
      string,
      {
        readonly projectId: string;
        readonly target: NonNullable<ReturnType<typeof deployLogTarget>>;
      }
    >();
    if (answer === undefined || flows === undefined) return { answer, logs };
    const asked = new Set(answer.jobs.flatMap(({ job }) => (job === null ? [] : [job])));
    const streamed = new Map<string, HqJob>();
    for (const app of flows.values()) {
      for (const environment of app.environmentInputs) {
        for (const service of environment.services) {
          for (const job of [service.deploy?.latest, service.deploy?.live]) {
            if (job === undefined || job === null || !asked.has(job.id)) continue;
            streamed.set(job.id, job);
            const target = deployLogTarget(job);
            if (target !== undefined)
              logs.set(job.id, { projectId: environment.projectId, target });
          }
        }
      }
    }
    return { answer: deployAnswerFollowing(answer, streamed), logs };
  }, [answer, flows]);
}
