/**
 * Deleting a project, at Zerops: its delete process is the operation's handle. Its row in the
 * process family reflects it and its terminal status ends it; its project's process history is
 * held until then, so an end met while the account was away is read. Once the project is gone that
 * history answers not-found, and the project's proven deletion ends it instead. No clock decides
 * the end.
 *
 * @module data/operations/deleteProject
 */
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

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
const FAILED_REASON = "The Zerops deletion process failed or was canceled.";

export const deleteProject: OperationKind<"delete-project"> = {
  kind: "delete-project",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, intent, receipt) =>
    // The project proven gone is the deletion's end, though its process's end went unseen.
    read.fact("project", intent.projectId).kind === "deleted"
      ? { kind: "succeeded" }
      : settledByProcess(read, receipt, (process) => process.failReason ?? FAILED_REASON),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: a delete process running for this very project.
  effectHandles: (read, intent) =>
    runningIn(read, intent.projectId, (process) => process.actionName === DELETE_ACTION),
};
