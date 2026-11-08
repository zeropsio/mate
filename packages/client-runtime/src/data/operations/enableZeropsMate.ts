/**
 * Turning Zerops Mate on for a container made without it, as a birth makes a Mate on an existing
 * project: the Mate's record in HQ first where HQ holds none (`POST /api/mates`, owned by the
 * person pressing; HQ's refusal of a person or a project it may not hold ends it, nothing written
 * at Zerops); then the Mate's own key, established by the person and written as the zcp's secret
 * `ZCP_API_KEY` (`ZeropsApiClient.installMateKey`) — the key the platform made with the container
 * is one HQ's Mate door never admits; then its `ZCP_MATE_ENABLED` flag written on, the write
 * reading it back itself (`ZeropsApiClient.writeMateFlag`); then the container restarted, the boot
 * that reads both. The restart's process is the operation's handle and says how it ended. A
 * restart not taken after the flag landed leaves the flag on and the restart the person's next
 * step; a lost answer is never adopted from a restart someone else may have made.
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
      /** Its name: the Mate's own key is `zcp-<name>`, as the platform names its own. */
      readonly projectName: string;
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
