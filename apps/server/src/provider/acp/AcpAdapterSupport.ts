import { type ProviderDriverKind, type ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as EffectAcpErrors from "effect-acp/errors";

import { ProviderAdapterProcessError, ProviderAdapterRequestError } from "../Errors.ts";
import { agentStoppedUnexpectedly } from "@t3tools/shared/threadStatus";
const isAcpProcessExitedError = Schema.is(EffectAcpErrors.AcpProcessExitedError);

/**
 * A profiled thread's own folder on an agent, the same for each of the thread's sessions: the
 * agent keeps its sessions by that folder, so they resume after a restart.
 */
export const profiledThreadDirectory = (
  stateDir: string,
  provider: ProviderDriverKind,
  threadId: ThreadId,
): string => `${stateDir}/profiled-threads/${provider}/${threadId}`;
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
