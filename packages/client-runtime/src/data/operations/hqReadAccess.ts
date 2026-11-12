/**
 * A person's ask for read access to an environment Zerops does not show them, and an Admin's close
 * of it (`POST /api/read-access-requests`, `…/:id/close`). HQ records and lists requests and writes
 * nothing at Zerops: the Admin's browser gives `READ_ONLY` there first (`set-project-access`). HQ
 * answers at once and keeps no request id, so a lost answer is read in the list once it is read
 * again; asking again answers the request still open, and a close of one already closed is `404`.
 *
 * @module data/operations/hqReadAccess
 */
import type { ReadAccessOutcome } from "../../zerops/hq/readAccess.ts";
import type { OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "ask-read-access": { readonly orgId: string; readonly projectId: string };
    readonly "close-read-access": {
      readonly orgId: string;
      /** HQ's id of the request. */
      readonly id: string;
      readonly outcome: ReadAccessOutcome;
    };
  }
}

// HQ's answer is the write's end; the list read again shows it.
const answeredByHq = (_read: unknown, _intent: unknown, receipt: OperationReceipt) =>
  receipt.outcome.kind === "succeeded";

export const askReadAccess: OperationKind<"ask-read-access"> = {
  kind: "ask-read-access",
  executor: "hq",
  reflected: answeredByHq,
};

export const closeReadAccess: OperationKind<"close-read-access"> = {
  kind: "close-read-access",
  executor: "hq",
  reflected: answeredByHq,
};
