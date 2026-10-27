#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- Signal's same-commit runner and classifier.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { JsonTestResults } from "vite-plus/test/node";
import { chatGateStages, chatGateTestFiles } from "./chat-gate.ts";
import { spreadShard } from "./lib/spread-shard.ts";
import type { SignalProgress } from "./signal-reporter.ts";

export interface SignalReport {
  /** `path` is the test's describe titles then its own: what Vitest's name filter reads. */
  tests: { file: string; title: string; path: string[]; status: string; reason?: string }[];
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
  /** Set when the case hung (hit the case ceiling, or ran when its shard was killed). */
  reason?: string;
}

export function classifyFailures(
  initial: ReadonlyArray<SignalReport>,
  rerun: SignalReport,
  run: number,
): SignalFailure[] {
  return failedTests(initial).map(({ file, title, reason }) => {
    const test = rerun.tests.find((test) => test.file === file && test.title === title);
    if (!test || !["passed", "failed"].includes(test.status))
      throw new Error(`Signal rerun did not execute ${file}: ${title}`);
    return {
      file,
      title,
      class: test.status === "passed" ? "fail-pass" : "fail-fail",
      run,
      ...(reason === undefined ? {} : { reason }),
    };
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

// Each C scenario file's slowest summed test time in Signal runs 40112366539 and 40114861112
// (2026-10-24), so the C shards split the time rather than the file count. The four
// owner-reported layout files are their describe groups' times from the file they were split from.
const cScenarioDurations = {
  "apps/web/test/scenarios/areas/c-mate/owner-reported-layout-regressions-conversation.scenario.ts": 157796,
  "apps/web/test/scenarios/areas/c-mate/owner-reported-layout-regressions-composer.scenario.ts": 134579,
  "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts": 127867,
  "apps/web/test/scenarios/areas/c-mate/owner-reported-layout-regressions-live-card.scenario.ts": 101771,
  "apps/web/test/scenarios/areas/c-mate/engine-page.scenario.ts": 70523,
  "apps/web/test/scenarios/areas/c-mate/owner-reported-layout-regressions-menu.scenario.ts": 69967,
  "apps/web/test/scenarios/areas/c-mate/engine-card.scenario.ts": 55981,
  "apps/web/test/scenarios/areas/c-mate/images.scenario.ts": 38479,
  "apps/web/test/scenarios/areas/c-mate/fold-work.scenario.ts": 38276,
  "apps/web/test/scenarios/areas/c-mate/ownership-loading.scenario.ts": 30697,
  "apps/web/test/scenarios/areas/c-mate/composer-overlap.scenario.ts": 29798,
  "apps/web/test/scenarios/areas/c-mate/health.scenario.ts": 24745,
  "apps/web/test/scenarios/areas/c-mate/overview-reload.scenario.ts": 16815,
  "apps/web/test/scenarios/areas/c-mate/admission.scenario.ts": 13920,
  "apps/web/test/scenarios/areas/c-mate/replay.scenario.ts": 13261,
  "apps/web/test/scenarios/areas/c-mate/recovery.scenario.ts": 13198,
  "apps/web/test/scenarios/areas/c-mate/identity.scenario.ts": 11643,
  "apps/web/test/scenarios/areas/c-mate/overview-filter.scenario.ts": 10969,
  "apps/web/test/scenarios/areas/c-mate/projects-opening.scenario.ts": 10162,
  "apps/web/test/scenarios/areas/c-mate/composer.scenario.ts": 8329,
  "apps/web/test/scenarios/areas/c-mate/first-send.scenario.ts": 7565,
  "apps/web/test/scenarios/areas/c-mate/providerLimits.scenario.ts": 6777,
  "apps/web/test/scenarios/areas/c-mate/image-layout.scenario.ts": 6139,
  "apps/web/test/scenarios/areas/c-mate/engine-secret.scenario.ts": 4566,
  "apps/web/test/scenarios/areas/c-mate/context-window.scenario.ts": 4519,
  "apps/web/test/scenarios/areas/c-mate/opening.scenario.ts": 3402,
};

const relativeFile = (file: string) => NodePath.relative(root, file).split(NodePath.sep).join("/");

function readProgress(output: string): SignalProgress[] {
  const path = `${output}.progress.jsonl`;
  if (!NodeFS.existsSync(path)) return [];
  return NodeFS.readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SignalProgress);
}

/**
 * What a shard that never wrote its report leaves: every case that ended, and the case that was
 * still running, which is the one to name. A case's title is its full name, so no `path` is known.
 */
export function reportFromProgress(lines: ReadonlyArray<SignalProgress>): SignalReport {
  const cases = new Map<string, SignalReport["tests"][number]>();
  for (const line of lines) {
    const file = relativeFile(line.file);
    const base = { file, title: line.title, path: [line.title] };
    cases.set(
      JSON.stringify([file, line.title]),
      line.event === "start"
        ? {
            ...base,
            status: "failed",
            reason: "hung: the shard ended while this case was running",
          }
        : {
            ...base,
            status: line.status,
            ...(line.reason === undefined ? {} : { reason: line.reason }),
          },
    );
  }
  return { tests: [...cases.values()], errors: [] };
}

const shardReports = ["c-1", "c-2", "c-3", "c-4", "non-c-1", "non-c-2", "non-c-3"];

export function readSignalReport(output: string): SignalReport {
  const evidence = JSON.parse(
    NodeFS.readFileSync(`${output}.vitest.json`, "utf8"),
  ) as JsonTestResults;
  const reasons = new Map(
    readProgress(output).flatMap((line) =>
      line.event === "end" && line.reason !== undefined
        ? [[JSON.stringify([relativeFile(line.file), line.title]), line.reason] as const]
        : [],
    ),
  );
  return {
    tests: evidence.testResults.flatMap((file) =>
      file.assertionResults.map((test) => {
        const found = relativeFile(file.name);
        const reason = reasons.get(JSON.stringify([found, test.fullName]));
        return {
          file: found,
          title: test.fullName,
          path: [...test.ancestorTitles, test.title],
          status: test.status,
          ...(reason === undefined ? {} : { reason }),
        };
      }),
    ),
    errors: JSON.parse(NodeFS.readFileSync(`${output}.errors.json`, "utf8")) as string[],
  };
}

function runScenarios(args: string[], output: string): SignalReport {
  NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
  NodeFS.rmSync(output, { force: true });
  NodeFS.rmSync(`${output}.vitest.json`, { force: true });
  NodeFS.rmSync(`${output}.errors.json`, { force: true });
  NodeFS.rmSync(`${output}.progress.jsonl`, { force: true });
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
            cScenarioDurations,
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
    const killed: string[] = [];
    const initial = shardReports.map((name) => {
      const report = NodePath.join(directory, `${name}.json`);
      if (NodeFS.existsSync(report))
        return JSON.parse(NodeFS.readFileSync(report, "utf8")) as SignalReport;
      const lines = readProgress(report);
      if (!lines.length) throw new Error(`Signal has no report or progress for shard ${name}`);
      killed.push(name);
      return reportFromProgress(lines);
    });
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
    for (const failure of failures.filter((failure) => failure.reason !== undefined))
      console.log(
        `::error file=${failure.file},title=Signal case hung::${failure.title}: ${failure.reason}`,
      );
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
    if (killed.length)
      throw new Error(`Signal: shards ${killed.join(", ")} ended without writing their report`);
  } else throw new Error("Usage: node scripts/signal.ts shard c|non-c <index/count> | classify");
}
