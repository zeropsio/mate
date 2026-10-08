/** Collect account facts and receipts without deciding restart state. */
import type { Projection } from "../store.ts";
import { runningScope } from "../families/process.ts";
import { scopeFreshness } from "./freshness.ts";
import { sameValue } from "./equal.ts";
import { operationProgress } from "./operation.ts";
import type { ProjectKey } from "./processes.ts";
import type { RestartEvidence, RestartProcess } from "./restart.ts";

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
    const sourceByProcess: Record<string, string> = {};
    // Index order is explicit submission order, never a timestamp-based verdict.
    for (const requestId of read.index("restartOperations", `${orgId}/${projectId}`)) {
      const record = read.operation(requestId);
      if (record?.intent.kind !== "mate-restart" || record.intent.sourceProcessId === undefined)
        continue;
      const sourceProcessId =
        sourceByProcess[record.intent.sourceProcessId] ?? record.intent.sourceProcessId;
      for (const handle of [...record.handles, ...(record.receipt?.handles ?? [])])
        sourceByProcess[handle] = sourceProcessId;
      const processId = record.receipt?.handles[0] ?? record.handles[0];
      if (processId !== undefined) {
        const fact = read.fact("process", processId);
        if (fact.kind === "known") processes[processId] = fact.value;
      }
      attempts[sourceProcessId] = {
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
      sourceByProcess,
    };
  },
};
