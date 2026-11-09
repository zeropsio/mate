/**
 * A write Zerops answers with its process (a delete, a restart, a start) or processes (an import,
 * one per service it creates): each process's row reflects it and their terminal statuses end it;
 * its project's process history is held until then.
 * After a lost answer, a process of the write's own running in its project is what adopts it.
 *
 * @module data/operations/processEnd
 */
import type { ProcessValue } from "../families/process.ts";
import type { OperationReceipt } from "../model.ts";
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
