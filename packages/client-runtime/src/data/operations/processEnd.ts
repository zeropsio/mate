/**
 * A write Zerops answers with its process: the process's row reflects it and its terminal status
 * ends it; its project's process history is held until then. After a lost answer, a process of
 * the write's own action running for its own service is what adopts it.
 *
 * @module data/operations/processEnd
 */
import type { OperationReceipt } from "../model.ts";
import type { ProjectionReads } from "../store.ts";
import type { Settlement } from "./kind.ts";

const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

const processOf = (receipt: OperationReceipt) => receipt.handles[0] ?? "";

export function followedByProcess<
  Intent extends { readonly projectId: string; readonly serviceId: string },
>(options: {
  /** The process's action: `stack.start`. */
  readonly action: string;
  /** What the person is told the process ended as: "The start". */
  readonly what: string;
}) {
  return {
    reflected: (read: ProjectionReads, _intent: Intent, receipt: OperationReceipt) =>
      read.fact("process", processOf(receipt)).kind === "known",
    settledBy: (
      read: ProjectionReads,
      _intent: Intent,
      receipt: OperationReceipt,
    ): Settlement | null => {
      const process = read.fact("process", processOf(receipt));
      if (process.kind !== "known") return null;
      if (process.value.status === "FINISHED") return { kind: "succeeded" };
      if (FAILED_STATUSES.has(process.value.status))
        return { kind: "failed", reason: `${options.what} ended ${process.value.status}.` };
      return null;
    },
    observedIn: (intent: Intent, receipt: OperationReceipt) =>
      receipt.outcome.kind !== "pending" || receipt.handles.length === 0
        ? null
        : { family: "process" as const, listing: "history" as const, ownerId: intent.projectId },
    effectHandles: (read: ProjectionReads, intent: Intent) =>
      [...read.index("running", intent.projectId)].filter((id) => {
        const process = read.fact("process", id);
        return (
          process.kind === "known" &&
          process.value.actionName === options.action &&
          process.value.serviceStackIds.includes(intent.serviceId)
        );
      }),
  };
}
