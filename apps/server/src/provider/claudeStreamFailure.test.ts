import { describe, expect, it } from "vite-plus/test";

import {
  describeClaudeStreamFailure,
  makeStderrTail,
  scrubSecrets,
} from "./claudeStreamFailure.ts";

/** Fake secrets built from parts: never a real-looking token in the source. */
const KEY = ["sk", "ant", "api03", "x".repeat(40)].join("-");
const BEARER = ["Bearer", "abc".repeat(12)].join(" ");

function sdkError(message: string, props: Record<string, unknown> = {}) {
  return Object.assign(new Error(message), props);
}

describe("describeClaudeStreamFailure", () => {
  const NEXT = "Send a message to pick up where it left off.";
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly error: unknown;
    readonly stderr: string;
    readonly reason: string;
  }> = [
    {
      name: "a Node heap out of memory in its stderr",
      error: sdkError("Claude Code process exited with code 134", { exitCode: 134 }),
      stderr:
        "<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n",
      reason: "Claude Code ran out of memory.",
    },
    {
      name: "killed by the system",
      error: sdkError("Claude Code process terminated by signal SIGKILL", { signal: "SIGKILL" }),
      stderr: "",
      reason: "Claude Code was stopped by the system (SIGKILL), most often for lack of memory.",
    },
    {
      name: "an exit code, no stderr",
      error: sdkError("Claude Code process exited with code 1", { exitCode: 1 }),
      stderr: "",
      reason: "Claude Code exited (code 1).",
    },
    {
      name: "an exit code only in the message",
      error: new Error("Claude Code process exited with code 2. stderr: boom"),
      stderr: "",
      reason: "Claude Code exited (code 2).",
    },
    {
      name: "the API stopped answering",
      error: new Error("API Error: 529 Overloaded"),
      stderr: "",
      reason: "The Claude API stopped answering.",
    },
    {
      name: "a dropped connection in its stderr",
      error: new Error("stream closed"),
      stderr: "Error: socket hang up\n    at TLSSocket.onclose",
      reason: "The Claude API stopped answering.",
    },
    {
      name: "nothing to go on",
      error: new Error("All fibers interrupted without error"),
      stderr: "",
      reason: "Claude Code stopped unexpectedly.",
    },
    {
      name: "not even an error",
      error: undefined,
      stderr: "",
      reason: "Claude Code stopped unexpectedly.",
    },
  ];
  for (const { name, error, stderr, reason } of cases) {
    it(name, () => {
      const failure = describeClaudeStreamFailure({ error, stderr });
      expect(failure.reason).toBe(reason);
      expect(failure.words).toBe(`${reason} ${NEXT}`);
    });
  }

  it("keeps what the log needs: the error, its code or signal, its stderr, scrubbed", () => {
    const failure = describeClaudeStreamFailure({
      error: sdkError(`Claude Code process exited with code 1. stderr: key ${KEY}`, {
        exitCode: 1,
      }),
      stderr: `Authorization: ${BEARER}\nANTHROPIC_API_KEY=${KEY}\nfatal: it broke`,
    });
    expect(failure.log.exitCode).toBe(1);
    expect(failure.log.signal).toBeNull();
    expect(failure.log.stderr).toContain("fatal: it broke");
    const logged = JSON.stringify(failure.log);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(BEARER.split(" ")[1]);
    expect(failure.words).not.toContain("fatal");
  });
});

describe("makeStderrTail", () => {
  it("keeps the last bytes of what was written, whole lines first", () => {
    const tail = makeStderrTail(32);
    tail.push("first line that will be dropped\n");
    tail.push("second\n");
    tail.push("third\n");
    expect(tail.text().length).toBeLessThanOrEqual(32);
    expect(tail.text().endsWith("second\nthird\n")).toBe(true);
    expect(tail.text()).not.toContain("first");
  });

  it("is empty before anything was written", () => {
    expect(makeStderrTail().text()).toBe("");
  });
});

describe("scrubSecrets", () => {
  it.each([
    [`key ${KEY} end`, KEY],
    [`Authorization: ${BEARER}`, BEARER.split(" ")[1]!],
    [`ANTHROPIC_AUTH_TOKEN=${"t".repeat(30)}`, "t".repeat(30)],
    [`"apiKey":"${"k".repeat(30)}"`, "k".repeat(30)],
    [`x-api-key: ${"q".repeat(30)}`, "q".repeat(30)],
  ])("%s", (text, secret) => {
    const scrubbed = scrubSecrets(text);
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain("[redacted]");
  });

  it("leaves ordinary words alone", () => {
    expect(scrubSecrets("FATAL ERROR: heap out of memory at 0x1f")).toBe(
      "FATAL ERROR: heap out of memory at 0x1f",
    );
  });
});
