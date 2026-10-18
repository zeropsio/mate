/**
 * A person stops an automated Mate's task from Mate (`HqApi.stopTask`). HQ answers at once and
 * keeps no request id: a stop told again is the same stop, and one HQ holds as ended is HQ's
 * `conflict` — nothing left to stop. HQ's answer is the write's end; the task's state in HQ's
 * navigation then follows its Mate's word that it stopped.
 *
 * @module data/operations/hqTaskStop
 */
import type { OperationReceipt } from "../model.ts";
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "stop-task": {
      readonly orgId: string;
      readonly appId: string;
      readonly taskId: string;
    };
  }
}

export const stopTask: OperationKind<"stop-task"> = {
  kind: "stop-task",
  executor: "hq",
  reflected: (_read: unknown, _intent: unknown, receipt: OperationReceipt) =>
    receipt.outcome.kind === "succeeded",
};
