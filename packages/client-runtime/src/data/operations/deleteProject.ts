/**
 * Deleting a project, at Zerops: its delete process is the operation's handle. Its row in the
 * process family reflects it and its terminal status ends it; its project's process history is
 * held until then, so an end met while the account was away is read. No clock decides the end.
 *
 * @module data/operations/deleteProject
 */
import type { OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "delete-project": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
    };
  }
}

const DELETE_ACTION = "project.delete";
const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);
const FAILED_REASON = "The Zerops deletion process failed or was canceled.";

const processOf = (receipt: OperationReceipt) => receipt.handles[0] ?? "";

export const deleteProject: OperationKind<"delete-project"> = {
  kind: "delete-project",
  executor: "zerops",
  reflected: (read, _intent, receipt) => read.fact("process", processOf(receipt)).kind === "known",
  settledBy: (read, _intent, receipt) => {
    const process = read.fact("process", processOf(receipt));
    if (process.kind !== "known") return null;
    if (process.value.status === "FINISHED") return { kind: "succeeded" };
    if (FAILED_STATUSES.has(process.value.status))
      return { kind: "failed", reason: process.value.failReason ?? FAILED_REASON };
    return null;
  },
  observedIn: (intent, receipt) =>
    receipt.handles.length === 0
      ? null
      : { family: "process", listing: "history", ownerId: intent.projectId },
  // After a lost answer: a delete process running for this very project.
  effectHandles: (read, intent) =>
    [...read.index("running", intent.projectId)].filter((id) => {
      const process = read.fact("process", id);
      return process.kind === "known" && process.value.actionName === DELETE_ACTION;
    }),
};
