/**
 * A merge's or release's answer that handed planning over (`HqDeployAnswer.planned: false`): HQ
 * answered before it planned the event's rollout, and the leading HQ plans it later. Until HQ's
 * navigation shows that rollout's jobs — the event's own, by `cause` and `ref` within its
 * application — the surface that pressed it says it waits for planning, never that nothing will
 * deploy; once it shows them, the answer is those jobs, followed as if HQ had answered them.
 *
 * @module hq/deployHandover
 */
import type { HqDeployAnswer, HqDeployOutcome } from "@t3tools/shared/hqDeploys";

import type { HqJob } from "./environments.ts";

/** The event whose rollout an answer is of: a merge by its squash commit, a release by its tag. */
export interface DeployRollout {
  readonly cause: "merge" | "release";
  readonly ref: string;
}

/** That event in its application: what a press's answer is followed by. */
export interface AppDeployRollout extends DeployRollout {
  readonly appId: string;
}

export const WAITING_FOR_PLANNING = "Waiting for planning.";

const outcomeOf = (environment: string, job: HqJob): HqDeployOutcome => ({
  environment,
  kind: job.kind,
  service: job.service,
  sha: job.sha,
  job: job.id,
  state: job.state,
  processId: job.processId,
  behind: null,
  reason: job.reason,
  appVersionId: job.appVersionId,
  ...(job.evidence === undefined ? {} : { evidence: job.evidence }),
  ...(job.verifiedVersionId === undefined ? {} : { verifiedVersionId: job.verifiedVersionId }),
  ...(job.steps === undefined ? {} : { steps: job.steps }),
});

/**
 * The answer as the review says it: a planned one (or one from an HQ that does not say) as HQ
 * answered it; a handed-over one as its rollout's jobs in the application's `environments`, each
 * environment's oldest first, or a wait for planning while there are none.
 */
export function followHandedOver(
  answer: HqDeployAnswer,
  rollout: DeployRollout | undefined,
  environments: ReadonlyArray<{ readonly name: string; readonly jobs: ReadonlyArray<HqJob> }>,
): HqDeployAnswer {
  if (answer.planned !== false) return answer;
  const jobs =
    rollout === undefined
      ? []
      : environments.flatMap(({ name, jobs }) =>
          jobs
            .filter(({ cause, ref }) => cause === rollout.cause && ref === rollout.ref)
            .reverse()
            .map((job) => outcomeOf(name, job)),
        );
  return jobs.length === 0
    ? { jobs: [], note: WAITING_FOR_PLANNING, planned: false }
    : { jobs, note: null };
}
