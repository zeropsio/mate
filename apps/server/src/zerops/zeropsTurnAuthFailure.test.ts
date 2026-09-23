import type { SpiEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { turnAuthFailureAgent } from "./zeropsTurnAuthFailure.ts";

const CLAUDE_SIGNED_OUT =
  "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.";

const event = (input: {
  readonly type: string;
  readonly provider: string;
  readonly providerInstanceId?: string;
  readonly payload: unknown;
}): SpiEvent =>
  ({
    eventId: "evt-1",
    threadId: "thread-1",
    createdAt: "2026-09-23T12:00:00Z",
    ...input,
  }) as SpiEvent;

const codexError = (codexErrorInfo: unknown) => ({
  message: "codex failed",
  class: "provider_error",
  detail: { error: { message: "codex failed", codexErrorInfo }, willRetry: false },
});

describe("turnAuthFailureAgent", () => {
  it.each([
    [
      "Claude refusing for want of a login",
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      "claude-code",
    ],
    [
      "Codex answering unauthorized",
      event({ type: "runtime.error", provider: "codex", payload: codexError("unauthorized") }),
      "codex",
    ],
    [
      "Codex's connection refused with a 401",
      event({
        type: "runtime.error",
        provider: "codex",
        payload: codexError({ responseStreamConnectionFailed: { httpStatusCode: 401 } }),
      }),
      "codex",
    ],
    [
      "the instance id naming the agent over the driver",
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        providerInstanceId: "claude-code",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      "claude-code",
    ],
    // Not an authentication failure.
    [
      "Codex out of credits",
      event({
        type: "runtime.error",
        provider: "codex",
        payload: codexError("usageLimitExceeded"),
      }),
      undefined,
    ],
    [
      "Codex's connection refused with a 503",
      event({
        type: "runtime.error",
        provider: "codex",
        payload: codexError({ httpConnectionFailed: { httpStatusCode: 503 } }),
      }),
      undefined,
    ],
    [
      "any other Claude error",
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        payload: { message: "Claude API is overloaded (529). Try again shortly." },
      }),
      undefined,
    ],
    // A warning is retried by the agent itself; the turn has not failed.
    [
      "a warning carrying the same words",
      event({
        type: "runtime.warning",
        provider: "claudeAgent",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      undefined,
    ],
    // An agent this feed does not report on.
    [
      "another driver's login failing",
      event({ type: "runtime.error", provider: "cursor", payload: { message: CLAUDE_SIGNED_OUT } }),
      undefined,
    ],
    [
      "a custom instance of a known driver",
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        providerInstanceId: "claude-work",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      undefined,
    ],
  ] as const)("%s", (_name, input, expected) => {
    expect(turnAuthFailureAgent(input)).toBe(expected);
  });
});
