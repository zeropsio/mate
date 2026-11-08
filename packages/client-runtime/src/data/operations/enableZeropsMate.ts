/**
 * Turning Zerops Mate on for a container. First what HQ's Mate door would refuse is refused here,
 * before anything is written: a container key HQ could read in clear (`ZeropsApiClient.mateKeyOf`),
 * then the Mate's record HQ is asked for (`POST /api/mates`, as a birth on an existing project
 * writes it, owned by the person pressing), refused by HQ for a person or a project it may not hold.
 * Only then, at Zerops: its `ZCP_MATE_ENABLED` flag written on — the write reads it back itself
 * (`ZeropsApiClient.writeMateFlag`) — then the container restarted, the boot that reads the flag. The restart's process is the operation's handle and says how it
 * ended. A restart not taken after the flag landed leaves the flag on and the restart the person's
 * next step; a lost answer is never adopted from a restart someone else may have made.
 *
 * @module data/operations/enableZeropsMate
 */
import type { OperationKind } from "./kind.ts";
import { historyHolding, reflectedByProcess, settledByProcess } from "./processEnd.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "enable-zerops-mate": {
      /** The organization whose link observes the project's processes. */
      readonly orgId: string;
      readonly projectId: string;
      readonly serviceId: string;
      /** The Mate's record HQ is asked to write first; absent where HQ holds it already. */
      readonly record?: { readonly face: string };
    };
  }
}

export const enableZeropsMate: OperationKind<"enable-zerops-mate"> = {
  kind: "enable-zerops-mate",
  executor: "zerops",
  reflected: (read, _intent, receipt) => reflectedByProcess(read, receipt),
  settledBy: (read, _intent, receipt) =>
    settledByProcess(read, receipt, (process) => `The restart ended ${process.status}.`),
  observedIn: (intent, receipt) => historyHolding(intent.projectId, receipt),
};
