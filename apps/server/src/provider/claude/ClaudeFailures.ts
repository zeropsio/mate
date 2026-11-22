import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderRuntimeTurnStatus, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";

import {
  type ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";
import { PROVIDER } from "./ClaudeSessionState.ts";

/** The detail a failure of the SDK's own stream is wrapped in (`runSdkStream`). */
export const STREAM_FAILED_DETAIL = "Claude runtime stream failed.";

export function toMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return fallback;
}

function normalizeClaudeStreamMessages(
  cause: Cause.Cause<ProviderAdapterProcessError>,
): ReadonlyArray<string> {
  const errors: Array<string> = [];
  for (const error of Cause.prettyErrors(cause)) {
    const message = error.message.trim();
    if (message.length > 0) {
      errors.push(message);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  const squashed = toMessage(Cause.squash(cause), "").trim();
  return squashed.length > 0 ? [squashed] : [];
}

/**
 * The SDK's own words for an interruption, whole: never a phrase found inside
 * a longer message, which can carry the CLI's stderr ("… exited with code 1.
 * stderr: Request was aborted.") and is a crash.
 */
const CLAUDE_INTERRUPTION_MESSAGES: ReadonlySet<string> = new Set([
  "all fibers interrupted without error",
  "request was aborted",
  "interrupted by user",
  "claude code process aborted by user",
  "operation aborted",
]);

function isClaudeInterruptedMessage(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/^error: /u, "")
    .replace(/\.$/u, "");
  return CLAUDE_INTERRUPTION_MESSAGES.has(normalized);
}

export function isClaudeInterruptedCause(cause: Cause.Cause<ProviderAdapterProcessError>): boolean {
  return (
    Cause.hasInterruptsOnly(cause) ||
    normalizeClaudeStreamMessages(cause).some(isClaudeInterruptedMessage) ||
    cause.reasons.some(
      (reason) =>
        Cause.isFailReason(reason) && isClaudeInterruptedMessage(toMessage(reason.error.cause, "")),
    )
  );
}

function resultErrorsText(result: SDKResultMessage): string {
  return "errors" in result && Array.isArray(result.errors)
    ? result.errors.join(" ").toLowerCase()
    : "";
}

/** Failure text for structured terminal reasons, including success-tagged failures. */
function terminalResultError(
  reason: SDKResultMessage["terminal_reason"],
  failureHint?: string,
): string | undefined {
  switch (reason) {
    case "api_error":
      return failureHint ?? "Claude gave up after repeated API errors.";
    case "malformed_tool_use_exhausted":
      return "Claude gave up after repeated malformed tool calls.";
    case "budget_exhausted":
      return "Claude stopped: the turn's token budget was exhausted.";
    case "structured_output_retry_exhausted":
      return "Claude could not produce the requested structured output.";
    case "tool_deferred_unavailable":
      return "Claude could not resume a deferred tool call: the tool is no longer available.";
    case "turn_setup_failed":
      return "Claude could not start the turn.";
    case "blocking_limit":
      return "Claude stopped: a usage limit blocked the request.";
    case "rapid_refill_breaker":
      return "Claude stopped: the context refilled too quickly after compaction.";
    case "prompt_too_long":
      return "Claude stopped: the prompt exceeds the model's context window.";
    case "image_error":
      return "Claude stopped: an image in the conversation could not be processed.";
    case "model_error":
      return "Claude stopped: the model returned an error.";
    default:
      return undefined;
  }
}

function isInterruptedResult(result: SDKResultMessage): boolean {
  // The CLI stamps user aborts explicitly: interrupting mid-tool-call yields
  // "aborted_tools" (with an internal "[ede_diagnostic] ..." error and
  // is_error: true), interrupting mid-stream yields "aborted_streaming".
  if (
    result.terminal_reason === "aborted_tools" ||
    result.terminal_reason === "aborted_streaming"
  ) {
    return true;
  }

  const errors = resultErrorsText(result);
  if (errors.includes("interrupt")) {
    return true;
  }

  return (
    result.subtype === "error_during_execution" &&
    result.is_error === false &&
    (errors.includes("request was aborted") ||
      errors.includes("interrupted by user") ||
      errors.includes("aborted"))
  );
}

/**
 * The CLI reports repeated 529 overload failures as a success-subtype result
 * with api_error_status 529 and an empty error list; the status code is the
 * only structured failure signal.
 */
function isOverloadedResult(result: SDKResultMessage): boolean {
  return result.subtype === "success" && result.api_error_status === 529;
}

/**
 * A gateway refuses an oversized request with 413, and the CLI ends the turn as a success-subtype
 * result carrying that status. Sending the same history again fails the same way.
 */
function isRequestTooLargeResult(result: SDKResultMessage): boolean {
  return result.subtype === "success" && result.api_error_status === 413;
}

/**
 * Whether a result ends a Claude turn other than the sent one open here. The
 * CLI names every send a turn consumed, and marks a turn it started itself (a
 * background task's wake) with an origin. A result that says neither stays
 * the open turn's, as it always was for producers that echo nothing.
 */
export function resultEndsAnotherTurn(result: SDKResultMessage, turnId: string): boolean {
  const consumed =
    result.user_message_uuids ??
    (result.user_message_uuid === undefined ? [] : [result.user_message_uuid]);
  if (consumed.includes(turnId)) return false;
  return consumed.length > 0 || (result.origin !== undefined && result.origin.kind !== "human");
}

/** Derives turn status and its error from the same provider result. */
export function resultOutcome(
  result: SDKResultMessage,
  failureHint?: string,
): {
  status: ProviderRuntimeTurnStatus;
  errorMessage: string | undefined;
} {
  // A success result flagged is_error only fails when the turn already
  // reported its cause (expired login, rejected usage window).
  const successTaggedFailure = result.subtype === "success" && result.is_error === true;
  const structuredError = isOverloadedResult(result)
    ? "Claude is at capacity right now. Try again in a minute: send a message to pick up where it left off."
    : isRequestTooLargeResult(result)
      ? "This thread's request is too large for Claude's API (HTTP 413), so sending it again fails the same way. Continue in a new thread."
      : (terminalResultError(result.terminal_reason, failureHint) ??
        (successTaggedFailure ? failureHint : undefined));
  // CLI diagnostic entries must not become the error banner. Success results
  // carry no typed error list, but a success-tagged failure may still list one.
  const listedErrors: ReadonlyArray<unknown> =
    "errors" in result && Array.isArray(result.errors) ? result.errors : [];
  const listedError =
    result.subtype === "success" && !successTaggedFailure
      ? undefined
      : listedErrors.find(
          (error): error is string =>
            typeof error === "string" && !error.startsWith("[ede_diagnostic]"),
        );
  const errorMessage = listedError || structuredError;
  if (structuredError !== undefined) return { status: "failed", errorMessage };
  if (result.subtype === "success") return { status: "completed", errorMessage };
  if (isInterruptedResult(result)) return { status: "interrupted", errorMessage };
  return {
    status: resultErrorsText(result).includes("cancel") ? "cancelled" : "failed",
    errorMessage,
  };
}

function toSessionError(
  threadId: ThreadId,
  cause: unknown,
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  // Only words about the session itself: "model not found" or a proxy's
  // "connection closed" is no closed session.
  const normalized = toMessage(cause, "").toLowerCase();
  if (/\bunknown session\b|\bsession\b[^.]*\bnot found\b/.test(normalized)) {
    return new ProviderAdapterSessionNotFoundError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  if (/\b(query|session|stream|transport|process|stdin)\b[^.]*\bclosed\b/.test(normalized)) {
    return new ProviderAdapterSessionClosedError({
      provider: PROVIDER,
      threadId,
      cause,
    });
  }
  return undefined;
}

export function toRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown,
): ProviderAdapterError {
  const sessionError = toSessionError(threadId, cause);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: `${method} failed`,
    cause,
  });
}
