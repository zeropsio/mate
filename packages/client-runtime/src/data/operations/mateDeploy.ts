/** A missing Mate deployment is restored by Zerops; its pipeline process owns the result. */
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "mate-deploy": {
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
    };
  }
}

export const mateDeploy: OperationKind<"mate-deploy"> = {
  kind: "mate-deploy",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The deployment ended ${process.status}.`),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
  // A different client's pipeline can run for this service too. With no returned process id,
  // attribution is unknown: retain the uncertain receipt instead of adopting another deployment.
  effectHandles: () => [],
};
