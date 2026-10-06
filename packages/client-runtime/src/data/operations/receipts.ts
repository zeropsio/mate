/**
 * The operation family's one reducer: intent and request id recorded before the
 * request leaves, a lost answer marked uncertain, the owner's receipts admitted as they come — from
 * the answer, from a lookup by the original id, or from the owner's own stream. A receipt never
 * regresses: a settled outcome stays settled. No input here comes from a clock.
 *
 * @module data/operations/receipts
 */
import type { OperationIntent, OperationReceipt, OperationRecord, Unobservable } from "../model.ts";

export type OperationInput =
  | {
      readonly kind: "operation-recorded";
      readonly requestId: string;
      readonly intent: OperationIntent;
      /** Handles already known for it: a request resumed after a restart. */
      readonly handles?: ReadonlyArray<string>;
      /** The effect handles the owner's facts showed just before the send. */
      readonly before?: ReadonlyArray<string>;
    }
  /** The request went out and its answer was lost: whether the owner took it is unknown. */
  | { readonly kind: "operation-uncertain"; readonly requestId: string }
  /** The owner did not take the request (it never arrived, or was turned away unread). */
  | {
      readonly kind: "operation-unsent";
      readonly requestId: string;
      /** What its owner, or the door before it, said: the person reads it as said. */
      readonly reason?: string;
    }
  /** The owner could not be asked whether it took a request whose answer was lost. */
  | { readonly kind: "operation-lookup-failed"; readonly requestId: string }
  /** The owner, asked by the original id, holds no such request: it was never taken. */
  | { readonly kind: "operation-absent"; readonly requestId: string }
  | { readonly kind: "operation-receipt"; readonly receipt: OperationReceipt }
  /** The owner says it can no longer observe the operation, and who must act; never a clock. */
  | {
      readonly kind: "operation-exhausted";
      readonly requestId: string;
      readonly unobservable: Unobservable;
      /** The owner's handles it reported with it (the stop it ran before it lost sight). */
      readonly handles?: ReadonlyArray<string>;
    };

/** Handles only accumulate: one the account knew is never forgotten by a later answer. */
const withHandles = (record: OperationRecord, handles: ReadonlyArray<string>): OperationRecord =>
  handles.every((handle) => record.handles.includes(handle))
    ? record
    : { ...record, handles: [...new Set([...record.handles, ...handles])] };

const settled = (receipt: OperationReceipt | null) =>
  receipt !== null && receipt.outcome.kind !== "pending";

export function reduceOperation(
  record: OperationRecord | undefined,
  input: OperationInput,
): OperationRecord | undefined {
  if (input.kind === "operation-recorded")
    return record === undefined
      ? {
          requestId: input.requestId,
          intent: input.intent,
          submission: "recorded",
          receipt: null,
          handles: input.handles ?? [],
          before: input.before ?? null,
          unresolved: null,
        }
      : withHandles(record, input.handles ?? []);
  if (record === undefined) return undefined;
  switch (input.kind) {
    case "operation-uncertain":
      return record.receipt === null ? { ...record, submission: "uncertain" } : record;
    case "operation-unsent":
      return record.receipt === null
        ? {
            ...record,
            submission: "unsent",
            ...(input.reason === undefined ? {} : { unsentBecause: input.reason }),
          }
        : record;
    case "operation-lookup-failed":
      return record.receipt === null ? { ...record, submission: "uncertain-unasked" } : record;
    case "operation-absent":
      return record.receipt === null ? { ...record, submission: "recorded" } : record;
    case "operation-receipt":
      return settled(record.receipt)
        ? record
        : {
            ...withHandles(record, input.receipt.handles),
            submission: "answered",
            receipt: input.receipt,
            unresolved: null,
          };
    case "operation-exhausted":
      return settled(record.receipt)
        ? record
        : { ...withHandles(record, input.handles ?? []), unresolved: input.unobservable };
  }
}

export const requestIdOf = (input: OperationInput) =>
  input.kind === "operation-receipt" ? input.receipt.requestId : input.requestId;

export const isOperationInput = (input: { readonly kind: string }): input is OperationInput =>
  input.kind.startsWith("operation-");
