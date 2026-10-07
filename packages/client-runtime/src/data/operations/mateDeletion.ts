/** Deletion preparation, HQ completion and exact-key retirement have separate receipts. */
import type { ProjectionReads } from "../store.ts";
import { operationResult } from "../model.ts";
import type { IntentOf, OperationKind } from "./kind.ts";

interface DeletionTarget {
  readonly orgId: string;
  readonly hqProjectId: string;
  readonly projectId: string;
}

declare module "../model.ts" {
  interface OperationIntents {
    readonly "prepare-mate-deletion": DeletionTarget;
    readonly "complete-mate-deletion": DeletionTarget & {
      readonly preparedRequestId: string;
      readonly completion: string;
    };
    readonly "retire-mate-key": {
      readonly orgId: string;
      readonly projectId: string;
      readonly tokenId: string;
      readonly preparedRequestId: string;
      readonly completionRequestId: string;
    };
    readonly "complete-key-retirement": DeletionTarget & {
      readonly preparedRequestId: string;
      readonly completionRequestId: string;
    };
  }
  interface OperationResults {
    readonly "prepare-mate-deletion": {
      readonly keyTokenId: string | null;
      readonly completion: string;
    };
  }
}

export const prepareMateDeletion: OperationKind<"prepare-mate-deletion"> = {
  kind: "prepare-mate-deletion",
  executor: "hq",
  reflected: () => false,
};

export const completeMateDeletion: OperationKind<"complete-mate-deletion"> = {
  kind: "complete-mate-deletion",
  executor: "hq",
  reflected: (read, intent) => read.fact("placement", intent.projectId).kind === "deleted",
};

export const completeKeyRetirement: OperationKind<"complete-key-retirement"> = {
  kind: "complete-key-retirement",
  executor: "hq",
  reflected: () => false,
};

export const retireMateKey: OperationKind<"retire-mate-key"> = {
  kind: "retire-mate-key",
  executor: "zerops",
  reflected: () => false,
};

/** After roles disappear, HQ's completion and its original prepared key authorize this remainder. */
export function mateKeyRetirementAllowed(
  read: ProjectionReads,
  intent: IntentOf<"retire-mate-key">,
): boolean {
  const prepared = read.operation(intent.preparedRequestId);
  const completed = read.operation(intent.completionRequestId);
  const key = operationResult(prepared, "prepare-mate-deletion");
  if (
    prepared?.intent.kind !== "prepare-mate-deletion" ||
    completed?.intent.kind !== "complete-mate-deletion" ||
    key === undefined ||
    prepared.receipt?.outcome.kind !== "succeeded" ||
    completed.receipt?.acceptance.kind !== "accepted"
  )
    return false;
  return (
    prepared.intent.orgId === intent.orgId &&
    prepared.intent.projectId === intent.projectId &&
    key.keyTokenId === intent.tokenId &&
    completed.intent.orgId === intent.orgId &&
    completed.intent.projectId === intent.projectId &&
    completed.intent.hqProjectId === prepared.intent.hqProjectId &&
    completed.intent.preparedRequestId === intent.preparedRequestId &&
    completed.intent.completion === key.completion &&
    completed.receipt.outcome.kind === "succeeded"
  );
}

export const MATE_DELETION_KINDS = [
  prepareMateDeletion,
  completeMateDeletion,
  retireMateKey,
  completeKeyRetirement,
] as const;
