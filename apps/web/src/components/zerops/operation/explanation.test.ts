import { describe, expect, it } from "vite-plus/test";

import { isErrorLogLine } from "./explanation";

describe("isErrorLogLine — which lines of a failure's log tail are toned as errors", () => {
  it.each([
    { line: "npm ERR! missing script: build", error: true },
    { line: 'level=error msg="✗ ERR File zerops.yml not found"', error: true },
    { line: "Error: Cannot find module 'express'", error: true },
    { line: "FATAL: password authentication failed", error: true },
    { line: "panic: runtime error: index out of range", error: true },
    { line: "Unhandled exception in worker", error: true },
    { line: "Build failed with exit code 1", error: true },
    { line: "> next build", error: false },
    { line: "added 312 packages in 9s", error: false },
    { line: "errorless mode enabled", error: false },
    { line: "", error: false },
  ])("$line → $error", ({ line, error }) => {
    expect(isErrorLogLine(line)).toBe(error);
  });
});
