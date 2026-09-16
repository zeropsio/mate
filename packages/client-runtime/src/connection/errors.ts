import type { EnvironmentId } from "@t3tools/contracts";
import { mateOnlyOwnerOpensIt, ZEROPS_READ_ONLY_DOOR_REASON } from "../zerops/mateAccess.ts";
import type { RemoteEnvironmentAuthError } from "../authorization/remote.ts";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
} from "./model.ts";

export function profileMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connection profile ${connectionId} is unavailable.`,
  });
}

export function credentialMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "authentication",
    detail: `Connection credential ${connectionId} is unavailable.`,
  });
}

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  });
}

export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentAuthError,
): ConnectionAttemptError {
  switch (error._tag) {
    case "EnvironmentAuthInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: "The environment credential is invalid.",
        traceId: error.traceId,
      });
    case "EnvironmentOperationForbiddenError":
      // The Mate is theirs to see and not to open. Kept apart from the generic
      // permission error on purpose: that one reads as something to fix, and
      // this is whose Mate it is.
      if (error.reason === ZEROPS_READ_ONLY_DOOR_REASON) {
        return new ConnectionBlockedError({
          reason: "read-only",
          detail: mateOnlyOwnerOpensIt(),
          traceId: error.traceId,
        });
      }
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential does not grant the required access.",
        traceId: error.traceId,
      });
    case "EnvironmentScopeRequiredError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential does not grant the required access.",
        traceId: error.traceId,
      });
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment rejected the authentication request.",
        traceId: error.traceId,
      });
    case "EnvironmentResourceNotFoundError":
      // Not expected during connection authorization, but the shared request
      // error type now includes it (used by resource fetches like the thread
      // snapshot). Treat it as a configuration issue with the endpoint.
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment endpoint could not be found.",
        traceId: error.traceId,
      });
    case "RemoteEnvironmentAuthTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message,
      });
    case "RemoteEnvironmentAuthFetchError":
      return new ConnectionTransientError({
        reason: "network",
        detail: error.message,
      });
    case "EnvironmentInternalError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The environment could not authorize the connection.",
        traceId: error.traceId,
      });
    case "RemoteEnvironmentAuthInvalidJsonError":
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
      });
  }
}
