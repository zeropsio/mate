/**
 * Access changes HQ runs as operations on the maker's carried token (`HqApi.startAccessChanges`),
 * one per person, and the maker's delete of one that failed or waits for their fresh token
 * (`HqApi.deleteAccessChange`). Each change's id is the client's, so the same start sent again
 * answers the same operations; how each goes on is drawn from HQ's `access:<id>` navigation keys
 * (`hqAccessOperation`), never from a copy here.
 *
 * @module data/operations/hqAccess
 */
import type { HqStartedAccessChange } from "../../zerops/hq/client.ts";
import type { OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "start-access-changes": {
      readonly orgId: string;
      readonly changes: ReadonlyArray<HqStartedAccessChange>;
    };
    readonly "delete-access-change": {
      readonly orgId: string;
      /** The operation's id, as its start chose it. */
      readonly id: string;
    };
  }
  interface OperationResults {
    /** The operations HQ started or already held, by the ids the start chose. */
    readonly "start-access-changes": {
      readonly operations: ReadonlyArray<{ readonly id: string }>;
    };
  }
}

// HQ's answer is the write's end; each change goes on in its navigation key.
const answeredByHq = (_read: unknown, _intent: unknown, receipt: OperationReceipt) =>
  receipt.outcome.kind === "succeeded";

export const startAccessChanges: OperationKind<"start-access-changes"> = {
  kind: "start-access-changes",
  executor: "hq",
  reflected: answeredByHq,
};

export const deleteAccessChange: OperationKind<"delete-access-change"> = {
  kind: "delete-access-change",
  executor: "hq",
  reflected: answeredByHq,
};
