// @effect-diagnostics nodeBuiltinImport:off -- verifies the Vitest reporter output consumed by gate receipts.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
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

it("a CLI-registered timing reporter writes timeout risks to the gate's configured JSONL file", () => {
  const root = NodeURL.fileURLToPath(new URL("../", import.meta.url));
  const cache = NodePath.join(root, "node_modules/.cache");
  NodeFS.mkdirSync(cache, { recursive: true });
  const fixture = NodeFS.mkdtempSync(NodePath.join(cache, "gate-timing-cli-"));
  const output = NodePath.join(fixture, "timings.jsonl");
  try {
    NodeFS.writeFileSync(
      NodePath.join(fixture, "vitest.config.ts"),
      'export default { test: { include: ["proof.test.ts"], testTimeout: 1000 } };',
    );
    NodeFS.writeFileSync(
      NodePath.join(fixture, "proof.test.ts"),
      // A synchronous wait crosses the risk threshold without racing the timeout callback.
      'import { it } from "vite-plus/test"; it("slow test", () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 850); });',
    );
    const result = NodeChildProcess.spawnSync(
      NodePath.join(root, "node_modules/.bin/vp"),
      [
        "test",
        "run",
        "--config",
        "vitest.config.ts",
        "--reporter",
        "default",
        "--reporter",
        NodePath.join(root, "scripts/gate-timing-reporter.ts"),
      ],
      {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, MATE_GATE_TIMINGS: output },
        timeout: 30_000,
      },
    );
    expect(
      result.status,
      "ASSERTION: a CLI-registered timing reporter must accept Vitest's options object\n" +
        result.stdout +
        result.stderr,
    ).toBe(0);
    const risks = NodeFS.readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(risks).toEqual([
      {
        file: NodePath.join(fixture, "proof.test.ts"),
        test: "slow test",
        durationMs: expect.any(Number),
        timeoutMs: 1000,
      },
    ]);
    expect(risks[0].durationMs).toBeGreaterThanOrEqual(850);
  } finally {
    NodeFS.rmSync(fixture, { recursive: true, force: true });
  }
});
