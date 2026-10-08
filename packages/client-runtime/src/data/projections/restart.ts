/** A restart's receipt and process reading, held by the account independently of its card. */
import type { ZeropsProcessOutcome } from "../../zerops/cards/payloads.ts";
import type { Projection } from "../store.ts";
import { runningScope } from "../families/process.ts";
import { scopeFreshness } from "./freshness.ts";
import { sameValue } from "./equal.ts";
import { operationProgress, type OperationProgress } from "./operation.ts";
import type { ProjectKey } from "./processes.ts";

export type RestartProcess = NonNullable<ZeropsProcessOutcome["process"]>;
export interface RestartReading {
  readonly sourceProcessId: string;
  readonly process: RestartProcess;
  readonly phase: "running" | "done" | "failed" | "uncertain";
  readonly requestId?: string;
  readonly progress?: OperationProgress;
}
export interface RestartEvidence {
  readonly processes: Readonly<Record<string, RestartProcess>>;
  readonly running: ReadonlyArray<string>;
  readonly attempts: Readonly<
    Record<
      string,
      {
        readonly requestId: string;
        readonly processId?: string;
        readonly progress: OperationProgress;
      }
    >
  >;
}
export const NO_RESTARTS: RestartEvidence = { processes: {}, running: [], attempts: {} };

export const projectRestarts: Projection<ProjectKey, RestartEvidence> = {
  name: "projectRestarts",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  equals: sameValue,
  derive: (read, { orgId, projectId }) => {
    const processes: Record<string, RestartProcess> = {};
    for (const id of read.index("project", projectId)) {
      const fact = read.fact("process", id);
      if (fact.kind === "known") processes[id] = fact.value;
    }
    const attempts: Record<string, RestartEvidence["attempts"][string]> = {};
    // Index order is explicit submission order, never a timestamp-based verdict.
    for (const requestId of read.index("restartOperations", `${orgId}/${projectId}`)) {
      const record = read.operation(requestId);
      if (record?.intent.kind !== "mate-restart" || record.intent.sourceProcessId === undefined)
        continue;
      const processId = record.receipt?.handles[0] ?? record.handles[0];
      if (processId !== undefined) {
        const fact = read.fact("process", processId);
        if (fact.kind === "known") processes[processId] = fact.value;
      }
      attempts[record.intent.sourceProcessId] = {
        requestId,
        progress: operationProgress.derive(read, requestId),
        ...(processId === undefined ? {} : { processId }),
      };
    }
    return {
      processes,
      running: scopeFreshness(read, runningScope(orgId)).live
        ? [...read.index("running", projectId)]
        : [],
      attempts,
    };
  },
};

/** Terminal tool evidence remains useful when owner history is absent; stale RUNNING never ticks. */
export function readRestart(evidence: RestartEvidence, source: RestartProcess): RestartReading {
  const attempt = evidence.attempts[source.id];
  const observed = evidence.processes[attempt?.processId ?? source.id];
  const terminal = (process: RestartProcess) =>
    ["FAILED", "FINISHED", "CANCELED"].includes(process.status);
  const progress = attempt?.progress;
  let process =
    observed === undefined
      ? attempt?.processId === undefined
        ? source
        : {
            id: attempt.processId,
            actionName: "unknown",
            status:
              progress?.stage === "done"
                ? progress.outcome === "succeeded"
                  ? "FINISHED"
                  : "FAILED"
                : "UNKNOWN",
          }
      : attempt === undefined && terminal(source) && !terminal(observed)
        ? source
        : observed;
  if (progress?.stage === "done")
    process = {
      ...process,
      status:
        progress.outcome === "succeeded"
          ? "FINISHED"
          : progress.outcome === "cancelled"
            ? "CANCELED"
            : "FAILED",
    };
  const phase =
    progress?.stage === "done"
      ? progress.outcome === "succeeded"
        ? "done"
        : "failed"
      : progress?.stage === "unresolved"
        ? "uncertain"
        : attempt !== undefined && (attempt.processId === undefined || observed === undefined)
          ? progress?.stage === "refused" || progress?.stage === "unsent"
            ? "failed"
            : "uncertain"
          : process.status === "FAILED" || process.status === "CANCELED"
            ? "failed"
            : process.status === "FINISHED"
              ? "done"
              : evidence.running.includes(process.id)
                ? "running"
                : "uncertain";
  return {
    sourceProcessId: source.id,
    process,
    phase,
    ...(attempt === undefined ? {} : { requestId: attempt.requestId, progress: attempt.progress }),
  };
}
