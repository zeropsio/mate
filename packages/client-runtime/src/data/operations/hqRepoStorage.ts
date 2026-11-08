/**
 * A repository's Git storage cap set by an Owner or Admin: HQ's answer is the repository's storage
 * as it stands after, so the answer ends it and is what the figure shows. HQ keeps no request id
 * for it; a lost answer stays uncertain and nothing is sent again blindly.
 *
 * @module data/operations/hqRepoStorage
 */
import type { HqRepoStorage } from "@t3tools/contracts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "set-repo-cap": {
      readonly orgId: string;
      readonly appId: string;
      /** HQ's repository: `appdev`. */
      readonly repo: string;
      /** Whole GiB, as the person typed it: HQ alone decides the range. */
      readonly capGiB: number;
    };
  }
  interface OperationResults {
    readonly "set-repo-cap": { readonly storage: HqRepoStorage };
  }
}

export const setRepoCap: OperationKind<"set-repo-cap"> = {
  kind: "set-repo-cap",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.acceptance.kind === "accepted",
};
