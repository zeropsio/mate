/**
 * A write Zerops answers with its process (a delete, a restart, a start): the process's row
 * reflects it and its terminal status ends it; its project's process history is held until then.
 * After a lost answer, a process of the write's own running in its project is what adopts it.
 *
 * @module data/operations/processEnd
 */
import type { ProcessValue } from "../families/process.ts";
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { Settlement } from "./kind.ts";

const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

/** The process an accepted write follows: its receipt's first handle. */
const processOf = (receipt: OperationReceipt) => receipt.handles[0] ?? "";

/** Whether the process's row is in the store. */
export const reflectedByProcess = (read: ProjectionReads, receipt: OperationReceipt) =>
  read.fact("process", processOf(receipt)).kind === "known";

/** The end its process's terminal row says; `null` while it says none. */
export function settledByProcess(
  read: ProjectionReads,
  receipt: OperationReceipt,
  /** What the person is told of a process that failed or was canceled. */
  failedReason: (process: ProcessValue) => string,
): Settlement | null {
  const process = read.fact("process", processOf(receipt));
  if (process.kind !== "known") return null;
  if (process.value.status === "FINISHED") return { kind: "succeeded" };
  if (FAILED_STATUSES.has(process.value.status))
    return { kind: "failed", reason: failedReason(process.value) };
  return null;
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
