/**
 * A Mate's project hardened at Zerops: its key lowered to the project and the project closed off
 * (`ZeropsApiClient.hardenMate`). Done once Zerops answers, with why a key could not be lowered.
 * Asked to confirm, it reads the project's isolation first and writes only where it is not closed
 * off, then reads it back: one that does not read closed off is refused with what it read.
 *
 * @module data/operations/hardenProject
 */
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "harden-project": {
      readonly orgId: string;
      readonly projectId: string;
      /** The key the Mate named to HQ by its id: that key alone is hardened. */
      readonly keyTokenId?: string;
      /** Read the isolation before and after: a project closed off already is left alone. */
      readonly confirm?: true;
    };
  }
  interface OperationResults {
    readonly "harden-project": {
      /** Why a key of the Mate's could not be lowered; `null` where it was, or none was. */
      readonly keyNotLowered: string | null;
    };
  }
}

export const hardenProject: OperationKind<"harden-project"> = {
  kind: "harden-project",
  executor: "zerops",
  reflected: () => true,
};
