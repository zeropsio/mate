/**
 * A member's take-over write: HQ deletes a token it no longer uses within the call, and replaces one
 * in use by starting the operation that owns its replacement as `id` (the Mate's hand-over, the
 * environment's deploy key), which runs on without the tab and shows on its Mate or its
 * application in navigation. A lost answer is read in the member's list once it is read again.
 *
 * @module data/operations/hqTakeOver
 */
import type { HqTakeOverStarted } from "@t3tools/shared/hqTakeOver";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "take-over-token": {
      readonly orgId: string;
      readonly userId: string;
      readonly tokenId: string;
      /** The operation HQ starts as, for a token in use. */
      readonly id: string;
      /** Who gets a Mate's key; absent: its owner. */
      readonly ownerUserId?: string;
    };
  }
  interface OperationResults {
    /** `started`: the operation replacing a token in use; `null`: the token was only deleted. */
    readonly "take-over-token": { readonly started: HqTakeOverStarted | null };
  }
}

export const takeOverToken: OperationKind<"take-over-token"> = {
  kind: "take-over-token",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
