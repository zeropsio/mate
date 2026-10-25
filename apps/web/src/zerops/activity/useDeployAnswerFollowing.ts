import type { ProjectId } from "@t3tools/contracts";
import {
  deployAnswerFollowing,
  deployLogTarget,
  followHandedOver,
} from "@t3tools/client-runtime/zerops/hq";
import type { AppDeployRollout, HqJob } from "@t3tools/client-runtime/zerops/hq";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { useMemo, useState } from "react";
import { useAppsEnvironments, useEveryAppId } from "../projectFlows";

/**
 * An answer's jobs as HQ's navigation carries them now, and the log each can open. HQ job ids join
 * an answer to its project; environment names may change after the press. The answer is only what
 * the request saw: the streamed state of its jobs is what it says.
 */
export function useDeployAnswerFollowing(answer: HqDeployAnswer | undefined) {
  const environments = useAppsEnvironments(useEveryAppId());
  return useMemo(() => {
    const logs = new Map<
      string,
      {
        readonly projectId: ProjectId;
        readonly target: NonNullable<ReturnType<typeof deployLogTarget>>;
      }
    >();
    if (answer === undefined) return { answer, logs };
    const asked = new Set(answer.jobs.flatMap(({ job }) => (job === null ? [] : [job])));
    const streamed = new Map<string, HqJob>();
    for (const app of Object.values(environments)) {
      for (const environment of app.environments ?? []) {
        if (environment.target.kind !== "zerops") continue;
        for (const job of environment.jobs) {
          if (!asked.has(job.id)) continue;
          streamed.set(job.id, job);
          const target = deployLogTarget(job);
          if (target !== undefined)
            logs.set(job.id, { projectId: environment.target.projectId, target });
        }
      }
    }
    return { answer: deployAnswerFollowing(answer, streamed), logs };
  }, [answer, environments]);
}

/**
 * A press's answer as its review says it: one that handed planning over waits for planning until
 * HQ's navigation shows its rollout's jobs in its application, then is those jobs — kept, so jobs
 * that leave navigation's window later never turn it back into a wait.
 */
export function useHandedOverAnswer(
  answer: HqDeployAnswer | undefined,
  rollout: AppDeployRollout | undefined,
): HqDeployAnswer | undefined {
  const environments = useAppsEnvironments(useEveryAppId());
  const [kept, setKept] = useState<{
    readonly of: HqDeployAnswer;
    readonly said: HqDeployAnswer;
  }>();
  const said = useMemo(
    () =>
      answer === undefined
        ? undefined
        : followHandedOver(
            answer,
            rollout,
            rollout === undefined ? [] : (environments[rollout.appId]?.environments ?? []),
          ),
    [answer, environments, rollout],
  );
  if (answer === undefined || said === undefined) return undefined;
  if (kept?.of === answer) return kept.said;
  if (answer.planned === false && said.planned !== false) setKept({ of: answer, said });
  return said;
}
