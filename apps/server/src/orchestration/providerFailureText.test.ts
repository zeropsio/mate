import { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  ProviderUnsupportedError,
} from "../provider/Errors.ts";
import { describeProviderFailure, formatProviderFailure } from "./providerFailureText.ts";

const threadId = ThreadId.make("thread");
const stack = "Error: Query closed before response received\n    at Query.close (sdk.mjs:1:1)";

describe("describeProviderFailure", () => {
  it.each([
    {
      name: "a closed session",
      cause: Cause.fail(
        new ProviderAdapterSessionClosedError({
          provider: "claudeAgent",
          threadId,
          cause: new Error(stack),
        }),
      ),
      expected: {
        sentence: "The agent's session closed before it got this message.",
        code: "session-closed",
      },
    },
    {
      name: "a missing session",
      cause: Cause.fail(new ProviderAdapterSessionNotFoundError({ provider: "codex", threadId })),
      expected: { sentence: "The agent's session was not running.", code: "session-missing" },
    },
    {
      name: "a request error keeps its detail's first line",
      cause: Cause.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "turn/start",
          detail: `turn/start failed\n${stack}`,
        }),
      ),
      expected: { sentence: "turn/start failed", code: "request-failed" },
    },
    {
      name: "a process error keeps its detail",
      cause: Cause.fail(
        new ProviderAdapterProcessError({ provider: "codex", threadId, detail: "The CLI exited." }),
      ),
      expected: { sentence: "The CLI exited.", code: "process-failed" },
    },
    {
      name: "a validation error keeps its issue",
      cause: Cause.fail(
        new ProviderAdapterValidationError({
          provider: "codex",
          operation: "sendTurn",
          issue: "The message is empty.",
        }),
      ),
      expected: { sentence: "The message is empty.", code: "invalid-request" },
    },
    {
      name: "another tagged error says its own message and is coded by its tag",
      cause: Cause.fail(new ProviderUnsupportedError({ provider: "codex" })),
      expected: {
        sentence: new ProviderUnsupportedError({ provider: "codex" }).message,
        code: "provider-unsupported",
      },
    },
    {
      name: "a defect never shows its stack",
      cause: Cause.die(new Error(stack)),
      expected: { sentence: "Something went wrong while starting this turn.", code: "internal" },
    },
  ])("$name", ({ cause, expected }) => {
    expect(describeProviderFailure(cause)).toEqual(expected);
    const text = formatProviderFailure(cause);
    expect(text).toBe(`${expected.sentence} (${expected.code})`);
    expect(text).not.toContain("\n");
  });
});
