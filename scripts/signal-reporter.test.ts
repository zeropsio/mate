// @effect-diagnostics nodeBuiltinImport:off -- exercises the real Vitest JSON and infrastructure reporters.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { classifyFailures, readSignalReport, validateReport } from "./signal.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
it.each([
  { kind: "assertion", source: "it('deliberate failure', () => expect(1).toBe(2));" },
  {
    kind: "setup",
    source: "beforeAll(() => { throw new Error('setup unavailable'); }); it('case', () => {});",
  },
  { kind: "collection", source: "throw new Error('collection unavailable');" },
  { kind: "skipped", source: "it.skip('omitted case', () => {});" },
  { kind: "expected failure", source: "it.fails('expected failure', () => expect(1).toBe(2));" },
])("Signal distinguishes $kind evidence through Vitest's real reporters", ({ kind, source }) => {
  NodeFS.mkdirSync(NodePath.join(root, ".plans"), { recursive: true });
  const directory = NodeFS.mkdtempSync(NodePath.join(root, ".plans/signal-reporter-"));
  try {
    NodeFS.writeFileSync(
      NodePath.join(directory, "vite.config.ts"),
      `import { defineConfig } from 'vite-plus/test/config'; export default defineConfig({ test: { include: ['*.test.ts'] } });`,
    );
    NodeFS.writeFileSync(
      NodePath.join(directory, "case.test.ts"),
      `import { it, expect, beforeAll } from 'vite-plus/test'; ${source}`,
    );
    const output = NodePath.join(directory, "report");
    const result = NodeChildProcess.spawnSync(
      "vp",
      [
        "test",
        "run",
        "--config",
        "vite.config.ts",
        "--reporter=json",
        `--outputFile.json=${output}.vitest.json`,
        `--reporter=${NodePath.join(root, "scripts/signal-reporter.ts")}`,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, MATE_SIGNAL_REPORT: output },
        timeout: 30_000,
      },
    );
    expect(result.status, result.stderr).toBe(
      ["skipped", "expected failure"].includes(kind) ? 0 : 1,
    );
    const report = readSignalReport(output);
    if (kind === "assertion") {
      expect(report.errors).toEqual([]);
      expect(() => validateReport(report)).not.toThrow();
      expect(classifyFailures([report], report, 42)).toEqual([
        {
          file: NodePath.relative(root, NodePath.join(directory, "case.test.ts")),
          title: "deliberate failure",
          class: "fail-fail",
          run: 42,
        },
      ]);
    } else
      expect(
        () => validateReport(report),
        "ASSERTION: incomplete execution cannot certify the Signal inventory",
      ).toThrow("Signal infrastructure failed");
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
