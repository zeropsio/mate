import { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { OperationReceipt } from "../model.ts";
import type { FamilySpec } from "./spec.ts";
import { scopeOf } from "./spec.ts";

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqLifecycle: HqLifecycleRecord;
  }
}
const decode = Schema.decodeUnknownOption(HqLifecycleRecord);
export const hqLifecycleFamily: FamilySpec<"hqLifecycle"> = {
  family: "hqLifecycle",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-lifecycle", leaving: "removed", demand: "navigation" },
  hq: {
    scope: "navigation",
    idOf: (key) => (key.startsWith("lifecycle:") ? key.slice(10) : null),
    keyOf: (id) => `lifecycle:${id}`,
    decode: (raw, key) => {
      const record = Option.getOrNull(decode(raw));
      return record?.requestId === key.slice(10) ? record : null;
    },
  },
};
export const hqLifecycleScope = (orgId: string) => scopeOf(hqLifecycleFamily, orgId);
/** Converts HQ's exact retained answer to the existing operation reducer's receipt. */
export const lifecycleReceipt = (record: HqLifecycleRecord): OperationReceipt => ({
  requestId: record.requestId,
  operationId: record.requestId,
  executor: "hq",
  affected: [{ family: "placement", id: record.intent.projectId }],
  handles: [record.intent.projectId],
  acceptance: {
    kind: "accepted",
    ...(record.result === undefined ? {} : { result: record.result }),
  },
  outcome: { kind: "succeeded", evidence: "The original HQ retained this request and its answer." },
});
