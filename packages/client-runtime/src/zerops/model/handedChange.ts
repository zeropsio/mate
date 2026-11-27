/**
 * The change a call handed the person: the Draft zcp's handover names, which a turn's finishing
 * message invites them to open and add (`OutcomeModel.change`).
 */
import { changeOfZcpAnswer } from "@t3tools/shared/hqChanges";

import type { ZeropsOperationPullRequest } from "./types.ts";

/** zcp's tool whose actions open and describe a change. */
const CHANGE_TOOL = "zerops_workflow";

/** Its actions whose answer hands the person a Draft; close-change names one it ends. */
const HANDOVER_ACTIONS: ReadonlySet<string> = new Set(["open-change", "describe-change"]);

/**
 * The change a finished `zerops_workflow` open-change or describe-change call names in its answer;
 * none for its close-change, a call that did not complete, or any other tool. `toolName` is
 * normalized, as `ZeropsCall.toolName`.
 */
export function handedChangeOfCall(call: {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>> | undefined;
  readonly completed: boolean;
  readonly resultText: string | undefined;
}): ZeropsOperationPullRequest | null {
  const action = call.input?.action;
  if (
    call.toolName !== CHANGE_TOOL ||
    !call.completed ||
    typeof action !== "string" ||
    !HANDOVER_ACTIONS.has(action) ||
    call.resultText === undefined
  )
    return null;
  let answer: unknown;
  try {
    answer = JSON.parse(call.resultText);
  } catch {
    return null;
  }
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const change = changeOfZcpAnswer(answer as Readonly<Record<string, unknown>>);
  return change === null ? null : { repository: change.repo, number: change.number };
}
