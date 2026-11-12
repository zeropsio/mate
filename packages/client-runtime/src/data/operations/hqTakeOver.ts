/**
 * A member's take-over write, which HQ answers at once: one integration token the member minted
 * replaced with one the person mints, and the old one deleted. A lost answer is read in the
 * member's list once it is read again: a token replaced is no longer in it.
 *
 * @module data/operations/hqTakeOver
 */
import type { HqTakeOverReplaced } from "@t3tools/shared/hqTakeOver";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "take-over-token": {
      readonly orgId: string;
      readonly userId: string;
      readonly tokenId: string;
      /** Who gets a Mate's key; absent: its owner. */
      readonly ownerUserId?: string;
    };
  }
  interface OperationResults {
    readonly "take-over-token": HqTakeOverReplaced;
  }
}

export const takeOverToken: OperationKind<"take-over-token"> = {
  kind: "take-over-token",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
