/**
 * Starting a stopped service, at Zerops. Its start process, where Zerops names one, is the
 * operation's handle and says how it ended; where it names none, its answer is the end.
 *
 * @module data/operations/startService
 */
import type { OperationKind } from "./kind.ts";
import {
  effectsByProcess,
  historyHolding,
  reflectedByProcess,
  settledByProcess,
} from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "start-service": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

export const startService: OperationKind<"start-service"> = {
  kind: "start-service",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The start ended ${process.status}.`),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // After a lost answer: a start of this very service, running or created since the press.
  effectHandles: effectsByProcess,
};
