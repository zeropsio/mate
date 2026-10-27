/**
 * Restarting a service, at Zerops (`PUT /service-stack/{id}/restart`): what makes a vault value
 * live in a service that runs the one before (a running process keeps the environment it booted
 * with). Its restart process is the operation's handle and says how it ended.
 *
 * @module data/operations/serviceRestart
 */
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "service-restart": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

export const serviceRestart: OperationKind<"service-restart"> = {
  kind: "service-restart",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The restart ended ${process.status}.`),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: a restart running for this very service.
  effectHandles: (read, intent) =>
    runningIn(
      read,
      intent.projectId,
      (process) =>
        process.actionName === "stack.restart" &&
        process.serviceStackIds.includes(intent.serviceId),
    ),
};
