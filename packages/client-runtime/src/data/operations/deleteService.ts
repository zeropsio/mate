/**
 * Deleting a service, at Zerops — only ever a person's confirmed Delete of a service its tier no
 * longer declares; HQ never deletes one. Its delete process is the operation's handle; the service
 * proven gone ends it as well, its process's end unseen.
 *
 * @module data/operations/deleteService
 */
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "delete-service": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

export const deleteService: OperationKind<"delete-service"> = {
  kind: "delete-service",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, intent, receipt) =>
    read.fact("service", intent.serviceId).kind === "deleted"
      ? { kind: "succeeded" }
      : settledByProcess(read, receipt, (process) => `The deletion ended ${process.status}.`),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: a delete running for this very service.
  effectHandles: (read, intent) =>
    runningIn(
      read,
      intent.projectId,
      (process) =>
        process.actionName === "stack.delete" && process.serviceStackIds.includes(intent.serviceId),
    ),
};
