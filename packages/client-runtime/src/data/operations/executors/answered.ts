/**
 * The receipt of a Zerops write whose answer is its end: Zerops did it once it answered, and the
 * target the write changed is the operation's id and handle.
 *
 * @module data/operations/executors/answered
 */
import type { Family, OperationReceipt } from "../../model.ts";

export const answeredReceipt = (
  requestId: string,
  target: { readonly family: Family; readonly id: string },
  /** The processes Zerops answered with, where it named any. */
  processes: ReadonlyArray<string> = [],
): OperationReceipt => ({
  requestId,
  operationId: target.id,
  executor: "zerops",
  affected: [target, ...processes.map((id) => ({ family: "process" as const, id }))],
  handles: [target.id, ...processes],
  acceptance: { kind: "accepted" },
  outcome: { kind: "succeeded", evidence: "Zerops answered the write." },
});
