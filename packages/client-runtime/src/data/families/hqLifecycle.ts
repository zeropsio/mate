import { HqLifecycleRecord, type HqLifecycleIntent } from "@t3tools/shared/hqLifecycle";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { OperationIntent, OperationReceipt } from "../model.ts";
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

/** The lifecycle requests this client still makes; HQ's retained record of another restores nothing. */
type ClientLifecycleIntent = Extract<HqLifecycleIntent, { readonly kind: OperationIntent["kind"] }>;
const CLIENT_LIFECYCLE_KINDS: ReadonlySet<string> = new Set<ClientLifecycleIntent["kind"]>([
  "move-project",
  "prepare-mate-deletion",
  "complete-mate-deletion",
  "complete-key-retirement",
]);

export type RecoverableLifecycleRecord = HqLifecycleRecord & {
  readonly intent: ClientLifecycleIntent & { readonly hqProjectId: string };
};

/** Recovering a local operation requires the original HQ's key and a request this client makes. */
export function isRecoverableLifecycle(
  record: HqLifecycleRecord,
  orgId: string,
  hqProjectId?: string,
): record is RecoverableLifecycleRecord {
  return (
    CLIENT_LIFECYCLE_KINDS.has(record.intent.kind) &&
    record.intent.orgId === orgId &&
    record.intent.hqProjectId !== undefined &&
    (hqProjectId === undefined || record.intent.hqProjectId === hqProjectId)
  );
}

/** Converts HQ's exact retained answer to the existing operation reducer's receipt. */
export const lifecycleReceipt = (record: HqLifecycleRecord): OperationReceipt => {
  const { result } = record;
  return {
    requestId: record.requestId,
    operationId: record.requestId,
    executor: "hq",
    affected: [{ family: "placement", id: record.intent.projectId }],
    handles: [record.intent.projectId],
    acceptance: {
      kind: "accepted",
      ...(result === undefined ? {} : { result }),
    },
    outcome: {
      kind: "succeeded",
      evidence: "The original HQ retained this request and its answer.",
    },
  };
};
