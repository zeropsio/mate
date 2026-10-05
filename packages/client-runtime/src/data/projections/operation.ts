/**
 * Where one operation stands, as the person sees it (HANDOFF §4.6): accepted by its owner, then
 * reflected in the scope it changes, then done — the end only as the owner says it. A lost answer
 * is shown as uncertain while the owner is asked; an observation that ran out is unresolved, with
 * who must act next, never a failure nobody reported.
 *
 * @module data/projections/operation
 */
import type { OperationRecord } from "../model.ts";
import { sameValue } from "./equal.ts";
import type { Projection, ProjectionReads } from "../store.ts";

export type OperationProgress =
  | { readonly stage: "unknown" }
  | { readonly stage: "submitting" }
  | { readonly stage: "unsent"; readonly next: "send-again" }
  | { readonly stage: "uncertain"; readonly next: "asking-owner" | "ask-owner-again" }
  | { readonly stage: "refused"; readonly reason: string }
  | { readonly stage: "accepted" | "reflected"; readonly operationId: string }
  | {
      readonly stage: "done";
      readonly operationId: string;
      readonly outcome: "succeeded" | "failed" | "cancelled";
    }
  | {
      readonly stage: "unresolved";
      readonly operationId: string | null;
      readonly nextActor: string;
    };

/** Whether the scope the intent changes shows it now: the move's project sits where it asked. */
function reflected(read: ProjectionReads, record: OperationRecord): boolean {
  const placement = read.fact("placement", record.intent.projectId);
  return (
    placement.kind === "known" &&
    placement.value.kind === "app" &&
    placement.value.appId === record.intent.to.appId
  );
}

export const operationProgress: Projection<string, OperationProgress> = {
  name: "operationProgress",
  keyOf: (requestId) => requestId,
  equals: sameValue,
  derive: (read, requestId) => {
    const record = read.operation(requestId);
    if (record === undefined) return { stage: "unknown" };
    const { receipt } = record;
    if (receipt !== null && receipt.outcome.kind !== "pending")
      return { stage: "done", operationId: receipt.operationId, outcome: receipt.outcome.kind };
    if (record.unresolved !== null)
      return {
        stage: "unresolved",
        operationId: receipt?.operationId ?? null,
        nextActor: record.unresolved.nextActor,
      };
    if (receipt === null)
      switch (record.submission) {
        case "unsent":
          return { stage: "unsent", next: "send-again" };
        case "uncertain":
          return { stage: "uncertain", next: "asking-owner" };
        case "uncertain-unasked":
          return { stage: "uncertain", next: "ask-owner-again" };
        default:
          return { stage: "submitting" };
      }
    if (receipt.acceptance.kind === "refused")
      return { stage: "refused", reason: receipt.acceptance.reason };
    return {
      stage: reflected(read, record) ? "reflected" : "accepted",
      operationId: receipt.operationId,
    };
  },
};
