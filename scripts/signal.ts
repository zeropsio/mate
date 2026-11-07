#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- Signal's same-commit runner and classifier.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import type { JsonTestResults } from "vite-plus/test/node";
import { chatGateStages, chatGateTestFiles } from "./chat-gate.ts";
import { scenarioDurations } from "./lib/scenario-durations.ts";
import { spreadShard } from "./lib/spread-shard.ts";
import { maskSignalSecrets, signalEvidence, type SignalProgress } from "./signal-reporter.ts";

export interface SignalReport {
  /** `path` is the test's describe titles then its own: what Vitest's name filter reads. */
  tests: { file: string; title: string; path: string[]; status: string; reason?: string }[];
  errors: string[];
}

function infrastructureReason(report: SignalReport): string | undefined {
  return !report.tests.length || report.errors.length
    ? report.errors.join("; ") || "no tests ran"
    : undefined;
}

export function validateReport(report: SignalReport): void {
  const reason = infrastructureReason(report);
  if (reason !== undefined) throw new Error(`Signal infrastructure failed: ${reason}`);
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
  const failed = failedTests(reports).filter((test) => test.reason === undefined);
  const names = new Set(failed.map((test) => test.path.map(escapeRegExp).join(" > ")));
  return {
    files: [...new Set(failed.map((test) => test.file))].sort(),
    testNamePattern: `^(?:${[...names].join("|")})$`,
  };
}

export interface SignalFailure {
  file: string;
  title: string;
  class: "fail-pass" | "fail-fail" | "timed-out";
  run: number;
  /** Set when the case hung (hit the case ceiling, or ran when its shard was killed). */
  reason?: string;
}

export function classifyFailures(
  initial: ReadonlyArray<SignalReport>,
  rerun: SignalReport,
  run: number,
): SignalFailure[] {
  return failedTests(initial).map(({ file, title, path, reason }) => {
    if (reason !== undefined) return { file, title, class: "timed-out", run, reason };
    const test = rerun.tests.find(
      (test) => test.file === file && test.path.join(" > ") === path.join(" > "),
    );
    if (!test || !["passed", "failed"].includes(test.status))
      throw new Error(`Signal rerun did not execute ${file}: ${title}`);
    return {
      file,
      title,
      class: test.status === "passed" ? "fail-pass" : "fail-fail",
      run,
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

const relativeFile = (file: string) => NodePath.relative(root, file).split(NodePath.sep).join("/");

function readProgress(output: string): SignalProgress[] {
  const path = `${output}.progress.jsonl`;
  if (!NodeFS.existsSync(path)) return [];
  const lines = NodeFS.readFileSync(path, "utf8").split("\n");
  // A killed writer may leave an incomplete final record; completed lines are still evidence.
  lines.pop();
  return lines.filter(Boolean).map((line) => JSON.parse(line) as SignalProgress);
}

/**
 * What a shard that never wrote its report leaves: every case that ended, and the case that was
 * still running, which is the one to name. A case's title is its full name, so no `path` is known.
 */
export function reportFromProgress(lines: ReadonlyArray<SignalProgress>): SignalReport {
  const cases = new Map<string, SignalReport["tests"][number]>();
  for (const line of lines) {
    if (line.event === "phase") continue;
    const file = relativeFile(line.file);
    const base = { file, title: line.title, path: [line.title] };
    const key = JSON.stringify([file, line.title]);
    if (line.event === "casePhase" && cases.has(key)) continue;
    cases.set(
      key,
      line.event === "start" || line.event === "casePhase"
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

/** The scenario files outside stage C, as repository paths: what the non-C shards run. */
function nonChatScenarioFiles(): string[] {
  const areas = "apps/web/test/scenarios/areas";
  return NodeFS.readdirSync(NodePath.join(root, areas), { recursive: true })
    .map((path) => `${areas}/${String(path).split(NodePath.sep).join("/")}`)
    .filter((file) => file.endsWith(".scenario.ts") && !file.startsWith(`${areas}/c-mate/`));
}

/**
 * Shard `index` of `count` of a Signal group, by each file's measured time, so its shards finish
 * together inside their step budget: a file count or a path hash put one shard past it.
 */
export function signalShardFiles(
  group: "c" | "non-c",
  index: number,
  count: number,
  durations: Readonly<Record<string, number>> = scenarioDurations,
): string[] {
  const files =
    group === "c"
      ? chatGateTestFiles(
          root,
          chatGateStages.filter((stage) => stage.id === "C"),
        )
      : nonChatScenarioFiles();
  return spreadShard(files, index, count, durations);
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
        const path = [...test.ancestorTitles, test.title];
        // Reporter.fullName uses " > "; JSON.fullName uses spaces. Join the structural path.
        const reason = reasons.get(JSON.stringify([found, path.join(" > ")]));
        return {
          file: found,
          title: test.fullName,
          path,
          status: test.status,
          ...(reason === undefined ? {} : { reason }),
        };
      }),
    ),
    errors: JSON.parse(NodeFS.readFileSync(`${output}.errors.json`, "utf8")) as string[],
  };
}

async function runScenarios(args: string[], output: string): Promise<SignalReport | undefined> {
  NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
  NodeFS.rmSync(output, { force: true });
  NodeFS.rmSync(`${output}.vitest.json`, { force: true });
  NodeFS.rmSync(`${output}.errors.json`, { force: true });
  NodeFS.rmSync(`${output}.progress.jsonl`, { force: true });
  const child = NodeChildProcess.spawn(
    "vp",
    [
      "test",
      "run",
      "--config",
      "../../scripts/scenario-ci.config.ts",
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
      stdio: ["inherit", "pipe", "pipe"],
      env: { ...process.env, MATE_SIGNAL_REPORT: output, VITEST_MAX_WORKERS: undefined },
    },
  );
  // A complete line keeps secrets split across stream chunks together without delaying case output.
  for (const [input, output] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ] as const)
    NodeReadline.createInterface({ input }).on("line", (line) => {
      const masked = maskSignalSecrets(line);
      // Keep our annotations; failure text must not create other workflow commands.
      const annotation =
        /^::error (?:file=[^,]*,)?title=Signal (?:original case failure|incomplete)::/u;
      output.write(`${annotation.test(masked) ? masked : masked.replaceAll("::", "%3A%3A")}\n`);
    });
  let interrupted: NodeJS.Signals | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted ??= signal;
    child.kill(signal);
  };
  const onTerm = () => interrupt("SIGTERM");
  const onInt = () => interrupt("SIGINT");
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onInt);
  let failure: Error | undefined;
  const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("error", (error) => (failure = error));
      child.once("close", (status, signal) => resolve({ status, signal }));
    },
  );
  process.removeListener("SIGTERM", onTerm);
  process.removeListener("SIGINT", onInt);

  if (
    failure ||
    interrupted ||
    result.signal ||
    !NodeFS.existsSync(`${output}.vitest.json`) ||
    !NodeFS.existsSync(`${output}.errors.json`)
  ) {
    const reason = failure?.message ?? interrupted ?? result.signal ?? "missing report";
    let running: SignalReport["tests"] = [];
    try {
      running = reportFromProgress(readProgress(output)).tests.filter(
        (test) => test.reason === "hung: the shard ended while this case was running",
      );
    } catch {
      // A truncated progress receipt cannot certify which case was running.
    }
    if (running.length)
      for (const test of running)
        signalEvidence("Signal incomplete", `${test.title}: shard ended (${reason})`, test.file);
    else signalEvidence("Signal incomplete", `shard ended (${reason})`);
    return undefined;
  }
  let report: SignalReport;
  try {
    report = readSignalReport(output);
  } catch (error) {
    signalEvidence("Signal incomplete", `cannot read report: ${String(error)}`);
    return undefined;
  }
  const reason = infrastructureReason(report);
  if (reason !== undefined) {
    // The reporter has already emitted each error; only an empty run needs a new explanation.
    if (!report.errors.length) signalEvidence("Signal incomplete", reason);
    return undefined;
  }
  if (result.status !== 0 && !report.tests.some((test) => test.status === "failed")) {
    signalEvidence("Signal incomplete", `runner exited ${result.status} without a failed test`);
    return undefined;
  }
  NodeFS.writeFileSync(output, JSON.stringify(report));
  return report;
}

async function main(): Promise<void> {
  const [mode, group, shard] = process.argv.slice(2);
  const directory = NodePath.resolve(process.env.MATE_SIGNAL_DIRECTORY ?? "signal-reports");
  if (mode === "shard" && ["c", "non-c"].includes(group ?? "") && /^\d+\/\d+$/u.test(shard ?? "")) {
    const [index, count] = shard!.split("/").map(Number) as [number, number];
    if (index < 1 || index > count) throw new Error("Invalid Signal shard");
    const files = signalShardFiles(group as "c" | "non-c", index, count);
    if (
      !(await runScenarios(
        files.map((file) => NodePath.join(root, file)),
        NodePath.join(directory, `${group}-${index}.json`),
      ))
    )
      process.exitCode = 1;
  } else if (mode === "classify") {
    const killed: string[] = [];
    const infrastructure: { shard: string; reason: string }[] = [];
    const initial = shardReports.flatMap((name) => {
      const report = NodePath.join(directory, `${name}.json`);
      let evidence: SignalReport;
      if (NodeFS.existsSync(report)) {
        evidence = JSON.parse(NodeFS.readFileSync(report, "utf8")) as SignalReport;
      } else if (
        NodeFS.existsSync(`${report}.vitest.json`) &&
        NodeFS.existsSync(`${report}.errors.json`)
      ) {
        evidence = readSignalReport(report);
      } else {
        const lines = readProgress(report);
        if (!lines.length) {
          infrastructure.push({ shard: name, reason: "no report or progress" });
          return [];
        }
        evidence = reportFromProgress(lines);
      }
      const reason = infrastructureReason(evidence);
      if (reason !== undefined) {
        infrastructure.push({ shard: name, reason });
        // A budget stop leaves uncertified cases, but its completed timeouts still need names.
        if (!evidence.tests.some((test) => ["passed", "failed"].includes(test.status))) return [];
        evidence = { ...evidence, errors: [] };
      }
      if (!NodeFS.existsSync(report)) killed.push(name);
      return [evidence];
    });
    NodeFS.writeFileSync(
      "signal-infrastructure.json",
      JSON.stringify(infrastructure, null, 2) + "\n",
    );
    for (const { shard, reason } of infrastructure)
      signalEvidence("Signal infrastructure", `${shard}: ${reason}`);
    const { files, testNamePattern } = failedSelection(initial);
    const run = Number(process.env.GITHUB_RUN_ID);
    if (!Number.isSafeInteger(run) || run <= 0)
      throw new Error("Signal requires its workflow run id");
    const timeouts = initial
      .map((report) => ({
        ...report,
        tests: report.tests.filter((test) => test.reason !== undefined),
      }))
      .filter((report) => report.tests.length);
    // Preserve already-known verdicts even if the assertion rerun exhausts its hard budget.
    NodeFS.writeFileSync(
      "signal-failures.json",
      JSON.stringify(classifyFailures(timeouts, { tests: [], errors: [] }, run), null, 2) + "\n",
    );
    for (const report of timeouts)
      for (const failure of report.tests)
        signalEvidence(
          "Signal timed out, not rerun",
          `${failure.title}: ${failure.reason}`,
          failure.file,
        );
    const rerun = files.length
      ? await runScenarios(
          [...files.map((file) => NodePath.join(root, file)), "--testNamePattern", testNamePattern],
          NodePath.join(directory, "rerun.json"),
        )
      : { tests: [], errors: [] };
    if (!rerun) {
      process.exitCode = 1;
      return;
    }
    const failures = classifyFailures(initial, rerun, run);
    NodeFS.writeFileSync("signal-failures.json", JSON.stringify(failures, null, 2) + "\n");
    console.log(`Signal classified ${failures.length} original test failures`);
    // The previous nightly run's classification, when the workflow fetched one.
    const previous = process.env.MATE_SIGNAL_PREVIOUS;
    if (previous !== undefined && NodeFS.existsSync(previous)) {
      const reds = standingReds(
        JSON.parse(NodeFS.readFileSync(previous, "utf8")) as SignalFailure[],
        failures,
      );
      for (const red of reds) signalEvidence("Standing red", red.title, red.file);
      if (reds.length)
        throw new Error(`Signal: ${reds.length} tests fail-fail on two consecutive nightly runs`);
    } else console.log("Signal has no previous nightly classification to compare");
    if (infrastructure.length) process.exitCode = 1;
    if (killed.length)
      throw new Error(`Signal: shards ${killed.join(", ")} ended without writing their report`);
  } else throw new Error("Usage: node scripts/signal.ts shard c|non-c <index/count> | classify");
}

if (import.meta.main) await main();
