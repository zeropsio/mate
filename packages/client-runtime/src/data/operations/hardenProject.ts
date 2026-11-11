/**
 * A Mate's key hardened at Zerops: lowered to its own project, its delegations dropped
 * (`ZeropsApiClient.hardenMate`). Done once Zerops answers, with why a key could not be lowered.
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
