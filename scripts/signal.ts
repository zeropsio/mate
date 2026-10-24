#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- Signal's same-commit runner and classifier.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { JsonTestResults } from "vite-plus/test/node";
import { chatGateStages, chatGateTestFiles } from "./chat-gate.ts";
import { spreadShard } from "./lib/spread-shard.ts";

export interface SignalReport {
  /** `path` is the test's describe titles then its own: what Vitest's name filter reads. */
  tests: { file: string; title: string; path: string[]; status: string }[];
  errors: string[];
}

export function validateReport(report: SignalReport): void {
  if (!report.tests.length || report.errors.length)
    throw new Error(`Signal infrastructure failed: ${report.errors.join("; ") || "no tests ran"}`);
}

const failedTests = (reports: ReadonlyArray<SignalReport>) => {
  reports.forEach(validateReport);
  return [
    ...new Map(
      reports
        .flatMap((report) => report.tests)
        .filter((test) => test.status === "failed")
        .map((test) => [JSON.stringify([test.file, test.title]), test]),
    ).values(),
  ];
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The failed files, and a name pattern that selects only their failed tests. */
export function failedSelection(reports: ReadonlyArray<SignalReport>): {
  files: string[];
  testNamePattern: string;
} {
  const failed = failedTests(reports);
  const names = new Set(failed.map((test) => test.path.map(escapeRegExp).join(" > ")));
  return {
    files: [...new Set(failed.map((test) => test.file))].sort(),
    testNamePattern: `^(?:${[...names].join("|")})$`,
  };
}

export interface SignalFailure {
  file: string;
  title: string;
  class: "fail-pass" | "fail-fail";
  run: number;
}

export function classifyFailures(
  initial: ReadonlyArray<SignalReport>,
  rerun: SignalReport,
  run: number,
): SignalFailure[] {
  return failedTests(initial).map(({ file, title }) => {
    const test = rerun.tests.find((test) => test.file === file && test.title === title);
    if (!test || !["passed", "failed"].includes(test.status))
      throw new Error(`Signal rerun did not execute ${file}: ${title}`);
    return { file, title, class: test.status === "passed" ? "fail-pass" : "fail-fail", run };
  });
}

/** Tests that failed and failed again on this run and on the previous one: a standing red. */
export function standingReds(
  previous: ReadonlyArray<SignalFailure>,
  current: ReadonlyArray<SignalFailure>,
): SignalFailure[] {
  const key = (failure: SignalFailure) => JSON.stringify([failure.file, failure.title]);
  const before = new Set(previous.filter((failure) => failure.class === "fail-fail").map(key));
  return current.filter((failure) => failure.class === "fail-fail" && before.has(key(failure)));
}

const root = NodePath.resolve(import.meta.dirname, "..");

export function readSignalReport(output: string): SignalReport {
  const evidence = JSON.parse(
    NodeFS.readFileSync(`${output}.vitest.json`, "utf8"),
  ) as JsonTestResults;
  return {
    tests: evidence.testResults.flatMap((file) =>
      file.assertionResults.map((test) => ({
        file: NodePath.relative(root, file.name).split(NodePath.sep).join("/"),
        title: test.fullName,
        path: [...test.ancestorTitles, test.title],
        status: test.status,
      })),
    ),
    errors: JSON.parse(NodeFS.readFileSync(`${output}.errors.json`, "utf8")) as string[],
  };
}

function runScenarios(args: string[], output: string): SignalReport {
  NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
  NodeFS.rmSync(output, { force: true });
  NodeFS.rmSync(`${output}.vitest.json`, { force: true });
  NodeFS.rmSync(`${output}.errors.json`, { force: true });
  const result = NodeChildProcess.spawnSync(
    "vp",
    [
      "test",
      "run",
      "--config",
      "test/scenarios/vitest.config.ts",
      "--project",
      "scenarios",
      ...args,
      "--allowOnly=false",
      "--reporter=verbose",
      "--reporter=json",
      `--outputFile.json=${output}.vitest.json`,
      "--reporter=../../scripts/signal-reporter.ts",
    ],
    {
      cwd: NodePath.join(root, "apps/web"),
      stdio: "inherit",
      env: { ...process.env, MATE_SIGNAL_REPORT: output, VITEST_MAX_WORKERS: undefined },
    },
  );
  if (result.error || result.signal || !NodeFS.existsSync(`${output}.vitest.json`))
    throw new Error(
      `Signal runner failed: ${result.error?.message ?? result.signal ?? "missing report"}`,
    );
  const report = readSignalReport(output);
  validateReport(report);
  if (result.status !== 0 && !report.tests.some((test) => test.status === "failed"))
    throw new Error(`Signal runner exited ${result.status} without a failed test`);
  NodeFS.writeFileSync(output, JSON.stringify(report));
  return report;
}

if (import.meta.main) {
  const [mode, group, shard] = process.argv.slice(2);
  const directory = NodePath.resolve(process.env.MATE_SIGNAL_DIRECTORY ?? "signal-reports");
  if (mode === "shard" && ["c", "non-c"].includes(group ?? "") && /^\d+\/\d+$/u.test(shard ?? "")) {
    const [index, count] = shard!.split("/").map(Number) as [number, number];
    if (index < 1 || index > count) throw new Error("Invalid Signal shard");
    const args =
      group === "c"
        ? spreadShard(
            chatGateTestFiles(
              root,
              chatGateStages.filter((stage) => stage.id === "C"),
            ),
            index,
            count,
          ).map((file) => NodePath.join(root, file))
        : [
            "test/scenarios/areas",
            "--exclude",
            "test/scenarios/areas/c-mate/**",
            "--shard",
            shard!,
          ];
    runScenarios(args, NodePath.join(directory, `${group}-${index}.json`));
  } else if (mode === "classify") {
    const paths = NodeFS.readdirSync(directory).filter((path) =>
      /^(?:c|non-c)-\d+\.json$/u.test(path),
    );
    if (paths.length !== 7)
      throw new Error(`Signal expected seven shard reports, got ${paths.length}`);
    const initial = paths.map(
      (path) =>
        JSON.parse(NodeFS.readFileSync(NodePath.join(directory, path), "utf8")) as SignalReport,
    );
    const { files, testNamePattern } = failedSelection(initial);
    const rerun = files.length
      ? runScenarios(
          [...files.map((file) => NodePath.join(root, file)), "--testNamePattern", testNamePattern],
          NodePath.join(directory, "rerun.json"),
        )
      : { tests: [], errors: [] };
    const run = Number(process.env.GITHUB_RUN_ID);
    if (!Number.isSafeInteger(run) || run <= 0)
      throw new Error("Signal requires its workflow run id");
    const failures = classifyFailures(initial, rerun, run);
    NodeFS.writeFileSync("signal-failures.json", JSON.stringify(failures, null, 2) + "\n");
    console.log(`Signal classified ${failures.length} original test failures`);
    // The previous kh-next run's classification, when the workflow fetched one.
    const previous = process.env.MATE_SIGNAL_PREVIOUS;
    if (previous !== undefined && NodeFS.existsSync(previous)) {
      const reds = standingReds(
        JSON.parse(NodeFS.readFileSync(previous, "utf8")) as SignalFailure[],
        failures,
      );
      for (const red of reds)
        console.log(`::error file=${red.file},title=Standing red::${red.title}`);
      if (reds.length)
        throw new Error(`Signal: ${reds.length} tests fail-fail on two consecutive kh-next runs`);
    } else console.log("Signal has no previous kh-next classification to compare");
  } else throw new Error("Usage: node scripts/signal.ts shard c|non-c <index/count> | classify");
}
