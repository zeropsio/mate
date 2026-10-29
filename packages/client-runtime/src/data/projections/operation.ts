/**
 * Where one operation stands, as the person sees it: accepted by its owner, then
 * reflected in the scope it changes, then done — the end only as the owner says it. A lost answer
 * is shown as uncertain while the owner is asked; an observation that ran out is unresolved, with
 * who must act next, never a failure nobody reported.
 *
 * @module data/projections/operation
 */
import type { RegisteredOperationKind } from "../operations/kind.ts";
import { OPERATION_KINDS, operationKind } from "../operations/kinds.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export type OperationProgress =
  | { readonly stage: "unknown" }
  | { readonly stage: "submitting" }
  | {
      readonly stage: "unsent";
      readonly next: "send-again";
      /** What its owner, or the door before it, said of why it was not taken. */
      readonly reason?: string;
    }
  | { readonly stage: "uncertain"; readonly next: "asking-owner" | "ask-owner-again" }
  | {
      readonly stage: "refused";
      readonly reason: string;
      /** The owner's own code for it (`userDataDuplicateKey`), where it named one. */
      readonly code?: string;
    }
  | { readonly stage: "accepted" | "reflected"; readonly operationId: string }
  | {
      readonly stage: "done";
      readonly operationId: string;
      readonly outcome: "succeeded" | "failed" | "cancelled";
      /** Why, where the owner's facts said it failed. */
      readonly reason?: string;
    }
  | {
      readonly stage: "unresolved";
      readonly operationId: string | null;
      readonly nextActor: string;
      /** What the owner named as the next step, where it named one. */
      readonly nextAction?: string;
      /** Why the owner stopped there, where it said. */
      readonly reason?: string;
    };

/**
 * Progress over a registry of operation kinds: the account's, or a test's own.
 */
export const operationProgressOf = (
  kinds: ReadonlyArray<RegisteredOperationKind>,
): Projection<string, OperationProgress> => ({
  name: "operationProgress",
  keyOf: (requestId) => requestId,
  equals: sameValue,
  derive: (read, requestId) => {
    const record = read.operation(requestId);
    if (record === undefined) return { stage: "unknown" };
    const { receipt } = record;
    if (receipt !== null && receipt.outcome.kind !== "pending")
      return { stage: "done", operationId: receipt.operationId, outcome: receipt.outcome.kind };
    if (receipt === null && record.unresolved !== null)
      return { stage: "unresolved", operationId: null, ...record.unresolved };
    if (receipt === null)
      switch (record.submission) {
        case "unsent":
          return {
            stage: "unsent",
            next: "send-again",
            ...(record.unsentBecause === undefined ? {} : { reason: record.unsentBecause }),
          };
        case "uncertain":
          return { stage: "uncertain", next: "asking-owner" };
        case "uncertain-unasked":
          return { stage: "uncertain", next: "ask-owner-again" };
        default:
          return { stage: "submitting" };
      }
    if (receipt.acceptance.kind === "refused") {
      const { reason, code } = receipt.acceptance;
      return { stage: "refused", reason, ...(code === undefined ? {} : { code }) };
    }
    const kind = operationKind(kinds, record.intent);
    // The owner's facts may say the end before — or instead of — its receipt.
    const settled = kind.settledBy?.(read, record.intent, receipt) ?? null;
    if (settled !== null)
      return settled.kind === "failed"
        ? {
            stage: "done",
            operationId: receipt.operationId,
            outcome: "failed",
            reason: settled.reason,
          }
        : { stage: "done", operationId: receipt.operationId, outcome: "succeeded" };
    // The owner's facts said no end yet; an owner that can no longer observe it leaves it open.
    if (record.unresolved !== null)
      return {
        stage: "unresolved",
        operationId: receipt.operationId,
        ...record.unresolved,
      };
    return {
      stage: kind.reflected(read, record.intent, receipt) ? "reflected" : "accepted",
      operationId: receipt.operationId,
    };
  },
});

export const operationProgress = operationProgressOf(OPERATION_KINDS);
