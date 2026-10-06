/**
 * What an event's own answer says of the deploys it asked for (`@t3tools/shared/hqDeploys`), in a
 * person's words: HQ submits them in the request — a merge, a release, a Run again, an Add service
 * — so the surface that pressed it says at once where each stands, by environment, before HQ's
 * stream brings the jobs to their rows.
 *
 * @module hq/deployAnswer
 */
import type { HqDeployAnswer, HqDeployOutcome } from "@t3tools/shared/hqDeploys";

import { shortCommit } from "../release.ts";
import type { HqJob } from "./environments.ts";
import { deployLogTarget, type DeployLogTarget } from "./deployLog.ts";

type DeployObservation = Pick<
  HqDeployOutcome,
  "evidence" | "appVersionId" | "verifiedVersionId" | "steps"
>;

/** The operation's next actor/action, shared by the answer and its durable service row. */
export function deployFollowText(
  job: Pick<HqDeployOutcome, "state" | "reason" | "evidence">,
): string | undefined {
  const waiting = job.state === "submitting" && job.evidence?.phase === "waiting-for-build";
  if (!waiting && job.state !== "unresolved") return undefined;
  const action = job.evidence?.nextAction.trim();
  const actor = job.evidence?.nextActor;
  const next = action
    ? `${actor === "hq" ? "HQ acts next" : actor === "person" ? "A person acts next" : "No next actor is assigned"}: ${action}`
    : job.reason?.trim() ||
      "A person must inspect the original handles in Zerops before asking Run again.";
  return `${waiting ? "Waiting for Zerops to start the build." : "HQ could not follow this deploy to its end."} ${next}`;
}

/** One job of the answer, said. */
export interface DeployAnswerJob extends DeployObservation {
  readonly jobId: string | null;
  readonly deployLog: DeployLogTarget | undefined;
  readonly state: HqDeployOutcome["state"];
  readonly service: string | null;
  /** The commit and outcome, for a row that already names the service. */
  readonly line: string;
  readonly text: string;
}

/** One environment's jobs of the answer, in the order HQ answered them. */
export interface DeployAnswerEnvironment {
  readonly environment: string;
  readonly jobs: ReadonlyArray<DeployAnswerJob>;
}

/** An answer said: each environment's jobs, and what HQ left out, in its words. */
export interface DeployAnswerSaid {
  readonly environments: ReadonlyArray<DeployAnswerEnvironment>;
  readonly note: string | undefined;
}

/** What a job deploys, as its line names it: a service at its commit, or the recipe's delta. */
const subjectOf = (outcome: HqDeployOutcome) =>
  outcome.kind === "delta"
    ? "The recipe's services"
    : `${outcome.service ?? "A service"}${outcome.sha === null ? "" : ` ${shortCommit(outcome.sha)}`}`;

const jobText = (
  outcome: HqDeployOutcome,
  answer: HqDeployAnswer,
  subject = subjectOf(outcome),
): string => {
  const reason = outcome.reason?.trim() || undefined;
  const prefix = subject === "" ? "" : `${subject} `;
  switch (outcome.state) {
    // A delta's import runs: its services are being added.
    case "building":
      return outcome.kind === "delta" ? `${prefix}being added` : `${prefix}building`;
    case "submitting": {
      const waiting = deployFollowText(outcome);
      return waiting === undefined
        ? `${prefix}submitted; HQ reads where it stands`
        : `${subject === "" ? "" : `${subject}: `}${waiting}`;
    }
    case "queued": {
      const ahead = answer.jobs.find((other) => other.job !== null && other.job === outcome.behind);
      return `${prefix}queued behind ${ahead === undefined ? "the build under way" : subjectOf(ahead)}`;
    }
    case "live":
      return reason === undefined
        ? `${prefix}live`
        : `${subject === "" ? "" : `${subject}: `}${reason}`;
    case "failed":
      return reason === undefined ? `${prefix}failed` : `${prefix}failed: ${reason}`;
    case "refused":
      return reason === undefined
        ? `HQ refused${subject === "" ? "" : ` ${subject}`}`
        : `HQ refused${subject === "" ? "" : ` ${subject}`}: ${reason}`;
    case "unresolved":
      return `${subject === "" ? "" : `${subject}: `}${deployFollowText(outcome)}`;
    case "skipped":
      return reason === undefined ? `${prefix}skipped` : `${prefix}skipped: ${reason}`;
    case "superseded":
      return `${prefix}superseded`;
  }
};

/** The answer by environment, in the order HQ named them. */
export function deployAnswerSaid(answer: HqDeployAnswer): DeployAnswerSaid {
  const environments = new Map<string, Array<DeployAnswerJob>>();
  for (const outcome of answer.jobs) {
    const jobs = environments.get(outcome.environment) ?? [];
    jobs.push({
      jobId: outcome.job,
      ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      ...(outcome.appVersionId === undefined ? {} : { appVersionId: outcome.appVersionId }),
      ...(outcome.verifiedVersionId === undefined
        ? {}
        : { verifiedVersionId: outcome.verifiedVersionId }),
      ...(outcome.steps === undefined ? {} : { steps: outcome.steps }),
      deployLog:
        outcome.job === null
          ? undefined
          : deployLogTarget({
              id: outcome.job,
              kind: outcome.kind,
              processId: outcome.processId,
              appVersionId: outcome.appVersionId ?? null,
            }),
      state: outcome.state,
      service: outcome.service,
      line:
        outcome.service === null
          ? jobText(outcome, answer)
          : jobText(outcome, answer, outcome.sha === null ? "" : shortCommit(outcome.sha)).trim(),
      text: jobText(outcome, answer),
    });
    environments.set(outcome.environment, jobs);
  }
  return {
    environments: [...environments].map(([environment, jobs]) => ({ environment, jobs })),
    note: answer.note?.trim() || undefined,
  };
}

/**
 * The answer as HQ's stream has it since: each job it names, found by id among the streamed ones,
 * stands where HQ says it stands now. The answer is the request's one snapshot; HQ's jobs are the
 * truth, and a job the stream does not carry keeps what it was answered.
 */
export function deployAnswerFollowing(
  answer: HqDeployAnswer,
  streamed: ReadonlyMap<string, Pick<HqJob, "state" | "reason" | "processId"> & DeployObservation>,
): HqDeployAnswer {
  return {
    ...answer,
    jobs: answer.jobs.map((outcome) => {
      const job = outcome.job === null ? undefined : streamed.get(outcome.job);
      return job === undefined
        ? outcome
        : {
            ...outcome,
            state: job.state,
            reason: job.reason,
            processId: job.processId ?? outcome.processId,
            ...(job.evidence == null ? {} : { evidence: job.evidence }),
            ...(job.appVersionId == null ? {} : { appVersionId: job.appVersionId }),
            ...(job.verifiedVersionId == null ? {} : { verifiedVersionId: job.verifiedVersionId }),
            ...(job.steps === undefined ? {} : { steps: job.steps }),
          };
    }),
  };
}
