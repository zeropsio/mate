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
      `import { defineConfig } from 'vite-plus/test/config'; export default defineConfig({ test: { include: ['*.test.ts'], fileParallelism: false, sequence: { sequencer: class { shard(files) { return files; } sort(files) { return files.sort((a, b) => a.moduleId.localeCompare(b.moduleId)); } } }, runner: ${JSON.stringify(NodePath.join(root, "scripts/scenario-budget-runner.ts"))}, globalSetup: [${JSON.stringify(NodePath.join(root, "scripts/scenario-budget.setup.ts"))}] } });`,
    );
    NodeFS.writeFileSync(
      NodePath.join(directory, "case.test.ts"),
      `import { it, expect, beforeAll, afterAll, describe } from 'vite-plus/test'; ${source}`,
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

it("the Signal runner attributes suite cleanup logs to the suite, not its last case", () =>
  withProject(
    `describe('group', () => {
       it('last case', () => {});
       afterAll(() => console.log('AFTER_SUITE_MARKER'));
     });`,
    (run) => {
      const result = run(["--reporter=default"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/stdout \| .*case\.test\.ts > group\nAFTER_SUITE_MARKER/u);
    },
  ));

it("Decision: the shard emits each original named failure before later cases, with secrets redacted", () =>
  withProject(
    `describe('Menu', () => {
       it('shows the broken state', () => { throw new Error('expected Mate row; password=shard-secret-123\\n::notice::not a command; value=' + process.env.SIGNAL_TEST_TOKEN); });
     });
     it('continues', () => { process.stdout.write('FIXTURE_CONTINUED\\n'); });`,
    (_run, directory) => {
      const executable = NodePath.join(directory, "vp");
      NodeFS.writeFileSync(
        executable,
        `#!/usr/bin/env node
         import { spawnSync } from 'node:child_process';
         const child = spawnSync(${JSON.stringify(NodePath.join(root, "node_modules/.bin/vp"))}, [
           'test', 'run', '--config', ${JSON.stringify(NodePath.join(directory, "vite.config.ts"))},
           '--reporter=verbose', '--reporter=json', '--outputFile.json=' + process.env.MATE_SIGNAL_REPORT + '.vitest.json',
           '--reporter=' + ${JSON.stringify(NodePath.join(root, "scripts/signal-reporter.ts"))}
         ], { cwd: ${JSON.stringify(directory)}, env: process.env, stdio: 'inherit' });
         process.exit(child.status ?? 1);`,
        { mode: 0o755 },
      );
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [NodePath.join(root, "scripts/signal.ts"), "shard", "non-c", "1/3"],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}${NodePath.delimiter}${process.env.PATH ?? ""}`,
            MATE_SIGNAL_DIRECTORY: directory,
            SIGNAL_TEST_TOKEN: "unlabelled-secret-789",
          },
        },
      );
      const output = result.stdout + result.stderr;
      expect(result.status, output).toBe(0);
      const failure = output.indexOf("Signal original case failure");
      expect(failure).toBeGreaterThanOrEqual(0);
      expect(failure).toBeLessThan(output.indexOf("FIXTURE_CONTINUED"));
      expect(output).toMatch(/::error file=.*title=Signal original case failure::/u);
      expect(output).toContain(NodePath.relative(root, NodePath.join(directory, "case.test.ts")));
      expect(output).toContain("Menu > shows the broken state");
      expect(output).toContain("expected Mate row");
      expect(output).toMatch(/case\.test\.ts > Menu > shows the broken state \d+ms/u);
      expect(output).toMatch(/case\.test\.ts > continues \d+ms/u);
      expect(output).not.toContain("shard-secret-123");
      expect(output).not.toContain("unlabelled-secret-789");
      expect(output).toContain("%0A::notice::not a command");
      expect(output).not.toContain("\n::notice::not a command");
      expect(output).not.toContain("fail-pass");
      expect(output).not.toContain("fail-fail");
      expect(
        JSON.parse(NodeFS.readFileSync(NodePath.join(directory, "non-c-1.json"), "utf8")).tests[0]
          .status,
      ).toBe("failed");
    },
  ));

it("Decision: shard infrastructure evidence names the cause without exposing secrets", () =>
  withProject("throw new Error('scenario setup unavailable; token=shard-secret-456');", (run) => {
    const result = run();
    const output = result.stdout + result.stderr;
    expect(output).toContain("Signal incomplete");
    expect(output).toContain("scenario setup unavailable");
    expect(output).not.toContain("shard-secret-456");
    expect(output).not.toContain("fail-pass");
    expect(output).not.toContain("fail-fail");
  }));

it("Signal's rerun executes only the failed test of a file and still certifies its evidence", () =>
  withProject(
    "describe('group', () => { it('flaky (1)', () => expect(1).toBe(2)); it('steady', () => {}); });",
    (run) => {
      const initial = readSignalReport(run().output);
      const rerunResult = run(["--testNamePattern", failedSelection([initial]).testNamePattern]);
      const rerun = readSignalReport(rerunResult.output);
      expect(rerunResult.stdout + rerunResult.stderr).not.toContain("Signal original case failure");
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
     describe('opening', () => {
       it('stuck', async () => { when.menu.opensMate(); await new Promise(() => {}); });
       it('after the stuck one', () => {});
     });`,
    (run, directory) => {
      const result = run(["--testTimeout=200"]);
      expect(result.status, result.stderr).toBe(1);
      expect(NodeFS.existsSync(`${result.output}.vitest.json`), result.stdout + result.stderr).toBe(
        true,
      );
      const report = readSignalReport(result.output);
      expect(report.tests.map(({ title, status, reason }) => [title, status, reason])).toEqual([
        ["opening stuck", "failed", "hung: no end within 200 ms; last step: when.menu.opensMate"],
        ["opening after the stuck one", "passed", undefined],
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
  expect(failedSelection([report]).files).toEqual([]);
});

it("Signal classifies an assertion recorded before a killed shard without rerunning its timed-out case", () => {
  const file = NodePath.join(root, "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts");
  const initial = reportFromProgress([
    { event: "end", file, title: "Chat > send", status: "failed" },
    { event: "start", file, title: "Chat > open" },
  ]);
  const rerun = {
    tests: [
      {
        file: NodePath.relative(root, file),
        title: "Chat send",
        path: ["Chat", "send"],
        status: "passed",
      },
    ],
    errors: [],
  };
  expect(failedSelection([initial]).testNamePattern).toBe("^(?:Chat > send)$");
  expect(classifyFailures([initial], rerun, 42)).toEqual([
    { file: NodePath.relative(root, file), title: "Chat > send", class: "fail-pass", run: 42 },
    {
      file: NodePath.relative(root, file),
      title: "Chat > open",
      class: "timed-out",
      run: 42,
      reason: "hung: the shard ended while this case was running",
    },
  ]);
});

it("Decision: a shard stops after three consecutive time-bound failures and names them across files", () =>
  withProject(
    `it('timeout before pass', async () => { await new Promise(() => {}); });
     it('pass resets the streak', () => {});
     it('timeout before assertion', async () => { await new Promise(() => {}); });
     it('assertion resets the streak', () => { expect(1).toBe(2); });
     it('hung one', async () => { await new Promise(() => {}); });`,
    (run, directory) => {
      NodeFS.writeFileSync(
        NodePath.join(directory, "next.test.ts"),
        `import { it } from 'vite-plus/test';
         it('hung two', async () => { await new Promise(() => {}); });
         it('hung three', async () => { await new Promise(() => {}); });
         it('must not start', () => { throw new Error('unreachable'); });`,
      );
      const result = run(["--testTimeout=200", "--reporter=default"]);
      expect(result.status, result.stderr).toBe(1);
      expect(NodeFS.existsSync(`${result.output}.vitest.json`), result.stdout + result.stderr).toBe(
        true,
      );
      const report = readSignalReport(result.output);
      expect(
        report.tests.filter(({ status }) => status === "failed").map(({ title }) => title),
      ).toEqual([
        "timeout before pass",
        "timeout before assertion",
        "assertion resets the streak",
        "hung one",
        "hung two",
        "hung three",
      ]);
      expect(result.stdout + result.stderr).toContain(
        "Stopped shard after 3 consecutive time-bound failures: hung one; hung two; hung three",
      );
    },
  ));
