// @effect-diagnostics nodeBuiltinImport:off -- exercises the real Vitest JSON and infrastructure reporters.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import {
  classifyFailures,
  failedSelection,
  readSignalReport,
  reportFromProgress,
  validateReport,
} from "./signal.ts";

const root = NodePath.resolve(import.meta.dirname, "..");

/** One throwaway Vitest project holding `source`, run with Signal's real reporters. */
function withProject(
  source: string,
  use: (
    run: (args?: string[]) => NodeChildProcess.SpawnSyncReturns<string> & { output: string },
    directory: string,
  ) => void,
) {
  NodeFS.mkdirSync(NodePath.join(root, ".plans"), { recursive: true });
  const directory = NodeFS.mkdtempSync(NodePath.join(root, ".plans/signal-reporter-"));
  try {
    NodeFS.writeFileSync(
      NodePath.join(directory, "vite.config.ts"),
      `import { defineConfig } from 'vite-plus/test/config'; export default defineConfig({ test: { include: ['*.test.ts'] } });`,
    );
    NodeFS.writeFileSync(
      NodePath.join(directory, "case.test.ts"),
      `import { it, expect, beforeAll, describe } from 'vite-plus/test'; ${source}`,
    );
    let runs = 0;
    use((args = []) => {
      const output = NodePath.join(directory, `report-${++runs}`);
      const result = NodeChildProcess.spawnSync(
        "vp",
        [
          "test",
          "run",
          "--config",
          "vite.config.ts",
          ...args,
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
      return Object.assign(result, { output });
    }, directory);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

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
  withProject(source, (run, directory) => {
    const result = run();
    expect(result.status, result.stderr).toBe(
      ["skipped", "expected failure"].includes(kind) ? 0 : 1,
    );
    const report = readSignalReport(result.output);
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
  });
});

it("Signal's rerun executes only the failed test of a file and still certifies its evidence", () =>
  withProject(
    "describe('group', () => { it('flaky (1)', () => expect(1).toBe(2)); it('steady', () => {}); });",
    (run) => {
      const initial = readSignalReport(run().output);
      const rerun = readSignalReport(
        run(["--testNamePattern", failedSelection([initial]).testNamePattern]).output,
      );
      expect(rerun.errors).toEqual([]);
      expect(rerun.tests.map(({ title, status }) => [title, status])).toEqual([
        ["group flaky (1)", "failed"],
        ["group steady", "skipped"],
      ]);
      expect(classifyFailures([initial], rerun, 42).map((failure) => failure.class)).toEqual([
        "fail-fail",
      ]);
    },
  ));

it("a case that hits the hang ceiling fails as hung, names its last step, and the shard goes on", () =>
  withProject(
    `import { trackSteps } from ${JSON.stringify(NodePath.join(root, "apps/web/test/scenarios/harness/lastStep.ts"))};
     const when = trackSteps('when', { menu: { opensMate: () => 1 } });
     it('stuck', async () => { when.menu.opensMate(); await new Promise(() => {}); });
     it('after the stuck one', () => {});`,
    (run, directory) => {
      const result = run(["--testTimeout=200"]);
      expect(result.status, result.stderr).toBe(1);
      const report = readSignalReport(result.output);
      expect(report.tests.map(({ title, status, reason }) => [title, status, reason])).toEqual([
        ["stuck", "failed", "hung: no end within 200 ms; last step: when.menu.opensMate"],
        ["after the stuck one", "passed", undefined],
      ]);
      const [failure] = classifyFailures([report], report, 42);
      expect(failure?.reason).toContain("hung");
      expect(failure?.file).toBe(NodePath.relative(root, NodePath.join(directory, "case.test.ts")));
    },
  ));

it("a shard killed mid-case leaves its finished cases and names the running one", () => {
  const file = NodePath.join(
    root,
    "apps/web/test/scenarios/areas/c-mate/projects-opening.scenario.ts",
  );
  const report = reportFromProgress([
    { event: "start", file, title: "done case" },
    { event: "end", file, title: "done case", status: "passed" },
    { event: "start", file, title: "running case" },
  ]);
  expect(report.tests.map(({ title, status, reason }) => [title, status, reason])).toEqual([
    ["done case", "passed", undefined],
    ["running case", "failed", "hung: the shard ended while this case was running"],
  ]);
  expect(failedSelection([report]).files).toEqual([
    "apps/web/test/scenarios/areas/c-mate/projects-opening.scenario.ts",
  ]);
});
