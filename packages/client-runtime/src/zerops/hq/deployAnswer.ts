import type { HqDeliveryAnswer, HqDeliveryOutcome, HqPushOutcome } from "@t3tools/shared/hqDeploys";
import type { HqDeliveryNavigationJob } from "@t3tools/shared/hqStream";
/**
 * What an event's own answer says of the deploys it asked for (`@t3tools/shared/hqDeploys`), in a
 * person's words: HQ submits them in the request — a merge, a release, a Run again, an Add service
 * — so the surface that pressed it says at once where each stands, by environment, before HQ's
 * stream brings the jobs to their rows.
 *
 * @module hq/deployAnswer
 */
import type { HqDeployAnswer, HqDeployOutcome } from "@t3tools/shared/hqDeploys";

import { formatStorageBytes } from "../gitBrowse/home.ts";
import { shortCommit } from "../release.ts";
import type { HqJob } from "./environments.ts";
import { deployLogTarget, type DeployLogTarget } from "./deployLog.ts";

type DeployObservation = Pick<
  HqDeployOutcome,
  "evidence" | "appVersionId" | "verifiedVersionId" | "steps" | "sourceArchiveBytes"
>;

/** The operation's next actor/action, shared by the answer and its durable service row. */
export function deployFollowText(
  job: Pick<HqDeployOutcome, "state" | "evidence">,
): string | undefined {
  const waiting = job.state === "submitting" && job.evidence?.phase === "waiting-for-build";
  if (!waiting && job.state !== "unresolved") return undefined;
  const actor = job.evidence?.nextActor;
  const next =
    actor === "hq"
      ? "HQ is checking its status."
      : actor === "none"
        ? "Check it in Zerops."
        : "Check it in Zerops, or run it again.";
  return `${waiting ? "Waiting for Zerops to start the build." : "HQ lost track of this deploy."} ${next}`;
}

/** Only HQ's measurement of this job supplies its compressed source size. */
export const sourceArchiveLabel = (bytes: number | null | undefined): string =>
  bytes == null
    ? "Source archive size is not available yet."
    : `Source archive: ${formatStorageBytes(bytes)}`;

/** One job of the answer, said. */
export interface DeployAnswerJob extends DeployObservation {
  readonly sourceArchive?: string | undefined;
  readonly jobId: string | null;
  readonly deployLog: DeployLogTarget | undefined;
  readonly state: HqDeployOutcome["state"];
  readonly service: string | null;
  /** The commit and outcome, for a row that already names the service. */
  readonly line: string;
  /**
   * Its outcome alone, for a review's Where row that names the service: where it stands, no
   * commit — the run's release panel read "app f1b66ee building"; the commit is its log's.
   */
  readonly standing: string;
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
        ? `${prefix}on its way`
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

function deployJobSaid(outcome: HqDeployOutcome, answer: HqDeployAnswer): DeployAnswerJob {
  return {
    ...(outcome.kind === "deploy"
      ? { sourceArchive: sourceArchiveLabel(outcome.sourceArchiveBytes) }
      : {}),
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
    standing:
      outcome.service === null ? jobText(outcome, answer) : jobText(outcome, answer, "").trim(),
    text: jobText(outcome, answer),
  };
}

/** The answer by environment, in the order HQ named them. */
export function deployAnswerSaid(answer: HqDeployAnswer): DeployAnswerSaid {
  const environments = new Map<string, Array<DeployAnswerJob>>();
  for (const outcome of answer.jobs) {
    const jobs = environments.get(outcome.environment) ?? [];
    jobs.push(deployJobSaid(outcome, answer));
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
            ...(job.sourceArchiveBytes === undefined
              ? {}
              : { sourceArchiveBytes: job.sourceArchiveBytes }),
          };
    }),
  };
}

/** A hand-over is distinct from a Zerops deploy and keeps its attempted/confirmed evidence. */
export interface PushAnswerJob {
  readonly kind: "push";
  readonly jobId: string | null;
  readonly service: string;
  readonly sha: string;
  readonly state: HqPushOutcome["state"];
  readonly evidence: HqPushOutcome["evidence"];
  readonly steps: HqPushOutcome["steps"];
  readonly line: string;
  readonly text: string;
}
export interface DeliveryAnswerSaid {
  readonly environments: ReadonlyArray<{
    readonly environment: string;
    readonly jobs: ReadonlyArray<DeployAnswerJob | PushAnswerJob>;
  }>;
  readonly note: string | undefined;
}
function pushText(job: HqPushOutcome): string {
  const subject = `${job.service} ${shortCommit(job.sha)}`;
  switch (job.state) {
    case "pushed":
      return `${subject} pushed${job.evidence?.confirmed === undefined ? "" : ` to ${job.evidence.confirmed.ref}`}`;
    case "queued":
      return `${subject} queued`;
    case "submitting":
      return `${subject}: ${job.evidence?.nextAction || "HQ is checking this push."}`;
    case "unresolved":
      return `${subject}: Mate couldn't confirm this push.${job.evidence?.nextAction ? ` ${job.evidence.nextAction}` : " Check the remote branch."}`;
    case "refused":
      return `${subject} wasn't pushed${job.reason ? `: ${job.reason}` : ""}`;
    case "superseded":
      return `${subject} superseded`;
  }
}
/** Mixed answers preserve HQ's order and use each target's own words. */
export function deliveryAnswerSaid(answer: HqDeliveryAnswer): DeliveryAnswerSaid {
  const environments = new Map<string, Array<DeployAnswerJob | PushAnswerJob>>();
  const deploys = {
    jobs: answer.jobs.filter((job): job is HqDeployOutcome => job.kind !== "push"),
    note: null,
  };
  for (const outcome of answer.jobs) {
    const jobs = environments.get(outcome.environment) ?? [];
    if (outcome.kind === "push") {
      jobs.push({
        kind: "push",
        jobId: outcome.job,
        service: outcome.service,
        sha: outcome.sha,
        state: outcome.state,
        evidence: outcome.evidence,
        steps: outcome.steps,
        line: pushText(outcome),
        text: pushText(outcome),
      });
    } else {
      jobs.push(deployJobSaid(outcome, deploys));
    }
    environments.set(outcome.environment, jobs);
  }
  return {
    environments: [...environments].map(([environment, jobs]) => ({ environment, jobs })),
    note: answer.note?.trim() || undefined,
  };
}
/** A delayed receipt names the same job and sha; another operation cannot settle this answer. */
export function deliveryAnswerFollowing(
  answer: HqDeliveryAnswer,
  streamed: ReadonlyMap<string, HqDeliveryNavigationJob>,
): HqDeliveryAnswer {
  return {
    ...answer,
    jobs: answer.jobs.map((outcome): HqDeliveryOutcome => {
      const job = outcome.job === null ? undefined : streamed.get(outcome.job);
      if (job === undefined || job.kind !== outcome.kind || job.sha !== outcome.sha) return outcome;
      if (outcome.kind === "push" && job.kind === "push")
        return {
          ...outcome,
          state: job.state,
          reason: job.reason,
          ...(job.evidence == null ? {} : { evidence: job.evidence }),
          ...(job.steps === undefined ? {} : { steps: job.steps }),
        };
      if (outcome.kind !== "push" && job.kind !== "push")
        return deployAnswerFollowing({ jobs: [outcome], note: null }, new Map([[job.id, job]]))
          .jobs[0]!;
      return outcome;
    }),
  };
}
