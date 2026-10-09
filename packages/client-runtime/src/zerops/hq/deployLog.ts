import type { HqJob } from "./environments.ts";
import type { ActivityProcess } from "../activity/dto.ts";
import type { BuildLogQuery } from "../activity/buildLog.ts";
import type { PipelineReadout } from "../activity/pipelineReadout.ts";
import { readPipeline } from "../activity/pipelineReadout.ts";
import { buildLogFor } from "../activity/observe.ts";
import { getPipelineState, pipelineTerminalOutcome } from "../activity/pipelineState.ts";

export interface DeployLogTarget {
  readonly jobId: string;
  readonly processId: string | null;
  readonly appVersionId: string | null;
}
/** Only durable platform ids open an inspection; a service and a time never identify a build. */
export function deployLogTarget(
  job: Pick<HqJob, "id" | "kind" | "processId" | "appVersionId">,
): DeployLogTarget | undefined {
  if (job.kind !== "deploy" || (job.processId === null && job.appVersionId === null))
    return undefined;
  return { jobId: job.id, processId: job.processId, appVersionId: job.appVersionId };
}
/** The account's process read, joined by id: the same pipeline and builder query chat uses. */
export function inspectDeployLog(
  target: DeployLogTarget,
  projectId: string,
  processes: ReadonlyArray<ActivityProcess>,
  nowMs: number,
  service: string,
):
  | { readonly pipeline: PipelineReadout; readonly query?: BuildLogQuery; readonly live: boolean }
  | undefined {
  const process = deployLogProcess(target, projectId, processes);
  if (process?.appVersion === undefined) return undefined;
  const pipeline = readPipeline(process.appVersion, {
    nowMs,
    serviceName: service,
    actionStartedAt: process.created,
  });
  const query = buildLogFor(process);
  return {
    pipeline,
    ...(query === undefined ? {} : { query }),
    live:
      (process.status === "RUNNING" || process.status === "PENDING") &&
      pipelineTerminalOutcome(getPipelineState(process.appVersion)) === undefined,
  };
}

/** Match the same durable process identity before opening and while inspecting. */
export function deployLogProcess(
  target: DeployLogTarget,
  projectId: string,
  processes: ReadonlyArray<ActivityProcess>,
) {
  return processes.find(
    (entry) =>
      entry.projectId === projectId &&
      (target.processId !== null
        ? entry.id === target.processId
        : target.appVersionId !== null && entry.appVersion?.id === target.appVersionId),
  );
}
