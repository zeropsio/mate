/**
 * Stopping a running service, at Zerops. Its stop process, where Zerops names one, is the
 * operation's handle and says how it ended; where it names none, its answer is the end.
 *
 * @module data/operations/stopService
 */
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, runningIn, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "stop-service": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

export const stopService: OperationKind<"stop-service"> = {
  kind: "stop-service",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The stop ended ${process.status}.`),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: a stop running for this very service.
  effectHandles: (read, intent) =>
    runningIn(
      read,
      intent.projectId,
      (process) =>
        process.actionName === "stack.stop" && process.serviceStackIds.includes(intent.serviceId),
    ),
};
