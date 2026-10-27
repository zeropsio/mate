// @effect-diagnostics nodeBuiltinImport:off -- verifies the Vitest reporter output consumed by gate receipts.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import GateTimingReporter from "./gate-timing-reporter.ts";

it("the gate records tests within twenty percent of their effective timeout", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-timing-"));
  const path = NodePath.join(directory, "timings.jsonl");
  try {
    const reporter = new GateTimingReporter(path);
    for (const [duration, timeout] of [
      [47999, 60000],
      [48000, 60000],
      [62000, 60000],
      [800, 1000],
      [1, 0],
    ] as const) {
      reporter.onTestCaseResult({
        fullName: `case ${duration}`,
        module: { moduleId: "scripts/example.test.ts" },
        options: { timeout },
        project: { config: { testTimeout: 60000 } },
        diagnostic: () => ({ duration }),
      });
    }
    expect(
      NodeFS.readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      "ASSERTION: the receipt must expose timeout risk using each test's effective timeout",
    ).toEqual([
      { file: "scripts/example.test.ts", test: "case 48000", durationMs: 48000, timeoutMs: 60000 },
      { file: "scripts/example.test.ts", test: "case 62000", durationMs: 62000, timeoutMs: 60000 },
      { file: "scripts/example.test.ts", test: "case 800", durationMs: 800, timeoutMs: 1000 },
    ]);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
