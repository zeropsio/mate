import {
  type ProviderApprovalDecision,
  type ProviderDriverKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";

import { ProviderAdapterProcessError, ProviderAdapterRequestError } from "../Errors.ts";
import { agentStoppedUnexpectedly } from "../agentStopped.ts";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

export function mapAcpToAdapterError(
  provider: ProviderDriverKind,
  threadId: ThreadId,
  method: string,
  error: EffectAcpErrors.AcpError,
): ProviderAdapterProcessError | ProviderAdapterRequestError {
  if (isAcpProcessExitedError(error)) {
    return new ProviderAdapterProcessError({
      provider,
      threadId,
      // Dead under a prompt, it crashed mid-turn: the person reads that it
      // stopped; its code and stderr stay with the cause, for the log.
      detail: method === "session/prompt" ? agentStoppedUnexpectedly(provider) : error.message,
      cause: error,
    });
  }
  if (isAcpRequestError(error)) {
    return new ProviderAdapterRequestError({
      provider,
      method,
      detail: error.message,
      cause: error,
    });
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: error.message,
    cause: error,
  });
}

export function acpPermissionOutcome(decision: ProviderApprovalDecision): string {
  switch (decision) {
    case "acceptForSession":
      return "allow-always";
    case "accept":
      return "allow-once";
    case "decline":
    default:
      return "reject-once";
  }
}
