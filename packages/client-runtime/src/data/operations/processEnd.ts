/**
 * A write Zerops answers with its process (a delete, a restart, a start) or processes (an import,
 * one per service it creates): each process's row reflects it and their terminal statuses end it;
 * its project's process history is held until then.
 * After a lost answer, a write whose effect is one process on one service (`effectProcessOf`) is
 * answered by that process of its project, running or created since the press
 * (`effectsByProcess`); a delete's, by its process still running there (`runningIn`).
 *
 * @module data/operations/processEnd
 */
import { historyScope } from "../families/process.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import type { OperationIntent, OperationReceipt } from "../model.ts";
import { effectProcessOf, processEffects } from "../projections/lostAnswer.ts";
import type { ProjectionReads } from "../store.ts";
import type { Settlement } from "./kind.ts";

const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

/** The processes an accepted write follows: its receipt's handles, one for most writes. */
const processesOf = (receipt: OperationReceipt) =>
  receipt.handles.length === 0 ? [""] : receipt.handles;

/** Whether every process's row is in the store. */
export const reflectedByProcess = (read: ProjectionReads, receipt: OperationReceipt) =>
  processesOf(receipt).every((id) => read.fact("process", id).kind === "known");

/**
 * The end its processes' terminal rows say; `null` while one says none. A write with several
 * processes (an import creating several services) ended once each did: succeeded where all
 * finished, failed where any failed or was canceled, with what each of those says.
 */
export function settledByProcess(
  read: ProjectionReads,
  receipt: OperationReceipt,
  /** What the person is told of a process that failed or was canceled. */
  failedReason: (process: ProcessValue) => string,
): Settlement | null {
  const failed: Array<string> = [];
  for (const id of processesOf(receipt)) {
    const process = read.fact("process", id);
    if (process.kind !== "known") return null;
    if (FAILED_STATUSES.has(process.value.status)) failed.push(failedReason(process.value));
    else if (process.value.status !== "FINISHED") return null;
  }
  return failed.length === 0
    ? { kind: "succeeded" }
    : { kind: "failed", reason: [...new Set(failed)].join(" ") };
}

/** Its project's process history, held while an accepted write's process may still end. */
export const historyHolding = (projectId: string, receipt: OperationReceipt) =>
  receipt.outcome.kind !== "pending" || receipt.handles.length === 0
    ? null
    : { family: "process" as const, listing: "history" as const, ownerId: projectId };

/** The processes running in the project that would show the write began. */
export const runningIn = (
  read: ProjectionReads,
  projectId: string,
  isOwn: (process: ProcessValue) => boolean,
) =>
  [...read.index("running", projectId)].filter((id) => {
    const process = read.fact("process", id);
    return process.kind === "known" && isOwn(process.value);
  });

/**
 * After a lost answer, the processes that may answer a write whose effect is one process on one
 * service: that process's action on that service, judged over the project's known processes and
 * its history as read (`processEffects`); `null` for a write with no such process.
 */
export function effectsByProcess(
  read: ProjectionReads,
  intent: OperationIntent,
  since: number | undefined,
  before?: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  const effect = effectProcessOf(intent);
  if (effect === null) return null;
  // A process not in the store is not one Zerops listed: none to judge.
  const known = (ids: Iterable<string>) => {
    const values: Array<ProcessValue> = [];
    for (const id of ids) {
      const process = read.fact("process", id);
      if (process.kind === "known") values.push(process.value);
    }
    return values;
  };
  return processEffects(
    known(read.index("project", effect.projectId)),
    { serviceId: effect.serviceId, action: effect.action, since, seen: before },
    known(read.members(historyScope(effect.orgId, effect.projectId)).ids),
  );
}
