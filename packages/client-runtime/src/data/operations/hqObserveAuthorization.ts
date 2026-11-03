/**
 * A Mate's ZCP authorized to observe its stage and production: HQ records the verified person as
 * whose Zerops permissions observation uses, for the Mate's existing context (`POST
 * /api/mates/:projectId/zcp-authorization` with no key hash). HQ decides who may: a viewer never
 * replaces another recorded person. HQ answers at once and keeps no request id for it, so a lost
 * answer stays uncertain and is asked for again only by the person.
 *
 * @module data/operations/hqObserveAuthorization
 */
import type { OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "authorize-observe": { readonly orgId: string; readonly projectId: string };
  }
}

export const authorizeObserve: OperationKind<"authorize-observe"> = {
  kind: "authorize-observe",
  executor: "hq",
  // HQ's answer is the write's end; the status read again shows it.
  reflected: (_read, _intent, receipt: OperationReceipt) => receipt.outcome.kind === "succeeded",
};
