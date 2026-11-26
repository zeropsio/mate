#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalJsonInEffect:off -- host witness replay.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { collectTestCases } from "./check-sentences.ts";
import {
  buildGateGraph,
  changedPaths,
  comparisonBase,
  type GatePackage,
  type GateStage,
  selectGateSteps,
  stageEnvironment,
  testStages,
  workspacePackages,
} from "./gate-changed.ts";
import { parseWitness } from "./gate-input-scopes.ts";
import { gateLogDirectory, removeGateLogs } from "./gate-log.ts";

const usage =
  "Usage: node scripts/witness-replay.ts [--changed <base>] [--overlap] [<test file>…]\n" +
  "Applies each witness's replacement to its owner, runs the test file, restores the owner and passes\n" +
  "only when the witnessed case fails with an assertion error and passes unmutated. --changed replays\n" +
  "the witnesses new or changed against <base>. --overlap also\n" +
  "prints the other cases the mutation kills, one JSON line each; named unit files are compared with\n" +
  "each other only.";

/** One witness line on one case: the case that must die of the line's mutation. */
export interface Replay {
  readonly file: string;
  readonly line: number;
  readonly titles: ReadonlyArray<string>;
  readonly witness: string;
}

/** The cases of a test file whose witness lines are absent from the same case at the base. */
export function witnessedCases(file: string, source: string, baseSource?: string): Replay[] {
  const key = (title: string | undefined, witness: string) => JSON.stringify([title, witness]);
  const before = new Set(
    baseSource === undefined
      ? []
      : collectTestCases(baseSource, file).flatMap((testCase) =>
          testCase.witnesses.map((witness) => key(testCase.titles[0], witness)),
        ),
  );
  return collectTestCases(source, file)
    .filter((testCase) => !testCase.suite)
    .flatMap((testCase) =>
      testCase.witnesses
        .filter((witness) => !before.has(key(testCase.titles[0], witness)))
        .map((witness) => ({ file, line: testCase.line, titles: testCase.titles, witness })),
    );
}

export interface VitestCase {
  readonly title: string;
  readonly fullName: string;
  readonly status: string;
  readonly failureMessages: ReadonlyArray<string>;
  readonly location?: { readonly line: number };
}

export interface VitestFile {
  readonly name: string;
  readonly status: string;
  readonly message: string;
  readonly assertionResults: ReadonlyArray<VitestCase>;
}

/** The part of Vitest's JSON reporter output the replay reads. */
export interface VitestReport {
  readonly testResults: ReadonlyArray<VitestFile>;
}

const object = (value: unknown, at: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Vitest JSON report: ${at} is not an object`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, at: string): string => {
  if (typeof value !== "string") throw new Error(`Vitest JSON report: ${at} is not a string`);
  return value;
};
const list = (value: unknown, at: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`Vitest JSON report: ${at} is not an array`);
  return value;
};

export function decodeVitestReport(value: unknown): VitestReport {
  return {
    testResults: list(object(value, "report").testResults, "testResults").map((entry, index) => {
      const file = object(entry, `testResults[${index}]`);
      const at = `testResults[${index}]`;
      return {
        name: text(file.name, `${at}.name`),
        status: text(file.status, `${at}.status`),
        message: text(file.message, `${at}.message`),
        assertionResults: list(file.assertionResults, `${at}.assertionResults`).map(
          (result, position) => {
            const item = object(result, `${at}.assertionResults[${position}]`);
            const where = `${at}.assertionResults[${position}]`;
            const location =
              item.location === undefined || item.location === null
                ? undefined
                : object(item.location, `${where}.location`);
            if (location && typeof location.line !== "number")
              throw new Error(`Vitest JSON report: ${where}.location.line is not a number`);
            return {
              title: text(item.title, `${where}.title`),
              fullName: text(item.fullName, `${where}.fullName`),
              status: text(item.status, `${where}.status`),
              failureMessages: list(item.failureMessages, `${where}.failureMessages`).map(
                (message, offset) => text(message, `${where}.failureMessages[${offset}]`),
              ),
              ...(location ? { location: { line: location.line as number } } : {}),
            };
          },
        ),
      };
    }),
  };
}

type Outcome =
  | { readonly kind: "passed" }
  | { readonly kind: "assertion" | "error" | "collection" | "missing"; readonly message: string };

// oxlint-disable-next-line eslint/no-control-regex -- Terminal colour contains ESC.
const plain = (message: string) => message.replace(/\u001b\[[\d;]*m/gu, "").trim();
const firstLine = (message: string) => plain(message).split("\n")[0]!;
// Chai, node:assert and @effect/vitest's assert all throw it; it.effect rethrows it unwrapped.
const assertionFailure = (message: string) => /^AssertionError\b/u.test(plain(message));

const fileResult = (report: VitestReport, file: string) =>
  report.testResults.find((result) => result.name.replaceAll("\\", "/").endsWith(`/${file}`));

const ofCase = (results: ReadonlyArray<VitestCase>, replay: Replay) =>
  results.filter(
    (result) => result.location?.line === replay.line || replay.titles.includes(result.title),
  );

function outcome(report: VitestReport | undefined, replay: Replay): Outcome {
  if (!report) return { kind: "collection", message: "Vitest wrote no report" };
  const file = fileResult(report, replay.file);
  const results = ofCase(file?.assertionResults ?? [], replay);
  if (!results.length)
    return file?.message
      ? { kind: "collection", message: firstLine(file.message) }
      : { kind: "missing", message: "has no result for the case" };
  const failed = results.filter((result) => result.status === "failed");
  if (!failed.length)
    return results.some((result) => result.status === "passed")
      ? { kind: "passed" }
      : { kind: "missing", message: `reports the case ${results[0]!.status}` };
  const messages = failed.flatMap((result) => result.failureMessages.map(plain));
  const assertion = messages.find(assertionFailure);
  return assertion
    ? { kind: "assertion", message: firstLine(assertion) }
    : { kind: "error", message: firstLine(messages[0] ?? "failed without a message") };
}

export type Verdict =
  | { readonly witnessed: true }
  | { readonly witnessed: false; readonly reason: string };

/** Witnessed only when the case passes unmutated and its mutation fails it on an assertion. */
export function judge(
  replay: Replay,
  baseline: VitestReport | undefined,
  mutated: VitestReport | undefined,
): Verdict {
  const before = outcome(baseline, replay);
  if (before.kind !== "passed")
    return { witnessed: false, reason: `the unmutated run fails: ${before.message}` };
  const after = outcome(mutated, replay);
  if (after.kind === "assertion") return { witnessed: true };
  if (after.kind === "passed")
    return { witnessed: false, reason: "the case stays green under the mutation" };
  return {
    witnessed: false,
    reason: `the mutation causes ${after.kind === "collection" ? "a collection or import error" : "no assertion failure"}: ${after.message}`,
  };
}

/** Runs one test stage with Vitest's JSON reporter; undefined when Vitest wrote no report. */
export type Runner = (stage: GateStage) => Promise<VitestReport | undefined>;

export interface ReplayOptions {
  readonly workspace: ReadonlyArray<GatePackage>;
  readonly run: Runner;
  /** Told of each write to an owner, before the next run reads it. */
  readonly changed: (absolutePath: string) => void;
  /** The other test files to run under each owner's mutation, for overlap reporting. */
  readonly overlap?: (owner: string) => ReadonlyArray<string>;
  readonly print: (line: Record<string, unknown>) => void;
}

/** Owners currently holding a mutation, by absolute path, so a signal can restore them. */
const mutatedOwners = new Map<string, Buffer>();

// Stage both writes beside the owner so readers can only see a complete version.
function replaceOwner(path: string, write: (temporary: string) => void): void {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodePath.dirname(path), ".witness-"));
  try {
    const temporary = NodePath.join(directory, NodePath.basename(path));
    write(temporary);
    NodeFS.chmodSync(temporary, NodeFS.statSync(path).mode);
    NodeFS.renameSync(temporary, path);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

function restoreOwner(path: string, original: Buffer): void {
  try {
    replaceOwner(path, (absolute) => {
      NodeFS.writeFileSync(absolute, original);
    });
    mutatedOwners.delete(path);
  } catch (error) {
    throw new Error(`Failed to restore witness owner ${path}`, { cause: error });
  }
}

async function runFiles(
  files: ReadonlyArray<string>,
  options: ReplayOptions,
): Promise<Map<string, VitestReport | undefined>> {
  const reports = new Map<string, VitestReport | undefined>();
  for (const stage of testStages(files, options.workspace)) {
    const report = await options.run(stage);
    for (const file of files)
      if (testStages([file], options.workspace)[0]?.name === stage.name) reports.set(file, report);
  }
  return reports;
}

interface Job {
  readonly owner: string;
  readonly old: string;
  readonly next: string;
  readonly replays: Replay[];
  files: string[];
}

/** Replays every witness; resolves to whether each replayed case was witnessed. */
export async function replayWitnesses(
  root: string,
  replays: ReadonlyArray<Replay>,
  options: ReplayOptions,
): Promise<boolean> {
  let witnessedAll = true;
  const fail = (replay: Replay, reason: string, durationMs = 0) => {
    witnessedAll = false;
    options.print({
      file: replay.file,
      line: replay.line,
      title: replay.titles[0],
      witness: replay.witness,
      witnessed: false,
      reason,
      durationMs,
    });
  };
  // One mutation per owner and witness line serves every case that carries the line.
  const jobs = new Map<string, Job>();
  for (const replay of replays) {
    const witness = parseWitness(replay.witness);
    if (!witness || witness.owner.startsWith("/") || witness.owner.split("/").includes("..")) {
      fail(replay, "is not `<owner path> | <old> → <new>` inside the repository");
      continue;
    }
    const key = JSON.stringify([witness.owner, witness.old, witness.next]);
    const job = jobs.get(key) ?? { ...witness, replays: [], files: [] };
    job.replays.push(replay);
    jobs.set(key, job);
  }
  for (const job of jobs.values())
    job.files = [
      ...new Set([
        ...job.replays.map((replay) => replay.file),
        ...(options.overlap?.(job.owner) ?? []),
      ]),
    ].sort();
  const allFiles = [...new Set([...jobs.values()].flatMap((job) => job.files))].sort();
  if (!allFiles.length) return witnessedAll;
  const baseline = await runFiles(allFiles, options);
  const replay = async (job: Job) => {
    let absolute: string;
    const started = Date.now();
    let original: Buffer;
    try {
      absolute = NodeFS.realpathSync(NodePath.join(root, job.owner));
      original = NodeFS.readFileSync(absolute);
    } catch {
      for (const replay of job.replays) fail(replay, `names a missing owner ${job.owner}`);
      return;
    }
    const source = original.toString("utf8");
    const at = job.old ? source.indexOf(job.old) : -1;
    if (at < 0 || source.indexOf(job.old, at + 1) >= 0) {
      for (const replay of job.replays)
        fail(replay, `old text does not occur exactly once in ${job.owner}`);
      return;
    }
    let mutated: Map<string, VitestReport | undefined>;
    mutatedOwners.set(absolute, original);
    try {
      replaceOwner(absolute, (temporary) =>
        NodeFS.writeFileSync(
          temporary,
          source.slice(0, at) + job.next + source.slice(at + job.old.length),
        ),
      );
      options.changed(absolute);
      if (options.overlap)
        for (const replay of job.replays)
          options.print({
            progress: "replaying",
            file: replay.file,
            line: replay.line,
            witness: replay.witness,
          });
      mutated = await runFiles(job.files, options);
    } finally {
      restoreOwner(absolute, original);
      options.changed(absolute);
    }
    const durationMs = Date.now() - started;
    for (const replay of job.replays) {
      const verdict = judge(replay, baseline.get(replay.file), mutated.get(replay.file));
      if (verdict.witnessed)
        options.print({
          file: replay.file,
          line: replay.line,
          title: replay.titles[0],
          witness: replay.witness,
          witnessed: true,
          durationMs,
        });
      else fail(replay, verdict.reason, durationMs);
    }
    if (!options.overlap) return;
    for (const file of job.files) {
      const before = baseline.get(file);
      const after = mutated.get(file);
      for (const result of after ? (fileResult(after, file)?.assertionResults ?? []) : []) {
        if (result.status !== "failed") continue;
        if (job.replays.some((replay) => replay.file === file && ofCase([result], replay).length))
          continue;
        const prior = before
          ? fileResult(before, file)?.assertionResults.find(
              (candidate) => candidate.fullName === result.fullName,
            )
          : undefined;
        if (prior?.status !== "passed") continue;
        options.print({
          overlap: `${job.owner} | ${job.old} → ${job.next}`,
          file,
          line: result.location?.line,
          title: result.fullName,
          assertion: result.failureMessages.some(assertionFailure),
        });
      }
    }
  };
  // One at a time: a mutation is on disk, and each package's Vitest runs one set at a time.
  for (const job of jobs.values()) await replay(job);
  return witnessedAll;
}

/** The replays a CLI invocation names: a lane's new witnesses, or every witness of the files. */
export function selectReplays(
  root: string,
  base: string | undefined,
  files: ReadonlyArray<string>,
): Replay[] {
  for (const file of files)
    if (!NodeFS.existsSync(NodePath.join(root, file)))
      throw new Error(`Missing test file: ${file}`);
  const read = (file: string) => NodeFS.readFileSync(NodePath.join(root, file), "utf8");
  if (base === undefined) return files.flatMap((file) => witnessedCases(file, read(file)));
  const ancestor = comparisonBase(root, base);
  return changedPaths(root, ancestor)
    .filter(
      (path) =>
        /\.test\.tsx?$/u.test(path) &&
        (!files.length || files.includes(path)) &&
        NodeFS.existsSync(NodePath.join(root, path)),
    )
    .flatMap((file) => {
      const before = NodeChildProcess.spawnSync("git", ["show", `${ancestor}:${file}`], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return witnessedCases(file, read(file), before.status === 0 ? before.stdout : undefined);
    });
}

/**
 * Runs stages on one Vitest per package, started once: starting it was nearly all of a replay's
 * time. `changed` drops an owner's transform from every Vitest whenever the owner is written, so
 * a run sees exactly the owner on disk.
 */
async function vitestRunner(root: string, logs: string) {
  const { createVitest } = await import("vite-plus/test/node");
  type Session = {
    readonly vitest: Awaited<ReturnType<typeof createVitest>>;
    readonly outputFile: string;
    readonly log: NodeFS.WriteStream;
  };
  const sessions = new Map<string, Session>();
  const session = async (stage: GateStage, cwd: string): Promise<Session> => {
    const known = sessions.get(cwd);
    if (known) return known;
    const outputFile = NodePath.join(logs, `${sessions.size + 1}.json`);
    const log = NodeFS.createWriteStream(NodePath.join(logs, `${sessions.size + 1}.log`), {
      mode: 0o600,
    });
    const vitest = await createVitest(
      "test",
      {
        root: cwd,
        watch: false,
        reporters: ["json"],
        outputFile,
        includeTaskLocation: true,
        ...(stage.args.includes("--fileParallelism") ? { fileParallelism: true } : {}),
      },
      {},
      { stdout: log, stderr: log },
    );
    await vitest.init();
    const created = { vitest, outputFile, log };
    sessions.set(cwd, created);
    return created;
  };
  const isTestFile = (arg: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(arg);
  const run: Runner = async (stage) => {
    const cwd = NodePath.join(root, stage.cwd ?? ".");
    // A package's config and its workers read the directory and environment `vp test` gives them.
    process.chdir(cwd);
    Object.assign(process.env, stageEnvironment(root, stage));
    const { vitest, outputFile } = await session(stage, cwd);
    const files = new Set(
      stage.args.filter(isTestFile).map((arg) => NodeFS.realpathSync(NodePath.resolve(cwd, arg))),
    );
    const specifications = (await vitest.globTestSpecifications([...files])).filter((spec) =>
      files.has(spec.moduleId),
    );
    NodeFS.rmSync(outputFile, { force: true });
    await vitest.runTestSpecifications(specifications, false);
    return NodeFS.existsSync(outputFile)
      ? decodeVitestReport(JSON.parse(NodeFS.readFileSync(outputFile, "utf8")))
      : undefined;
  };
  return {
    run,
    changed: (absolutePath: string) => {
      for (const { vitest } of sessions.values()) vitest.invalidateFile(absolutePath);
    },
    close: async () => {
      for (const { vitest, log } of sessions.values()) {
        await vitest.close();
        await new Promise((resolve) => log.end(resolve));
      }
    },
  };
}

if (import.meta.main) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  let base: string | undefined;
  let overlap = false;
  const files: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--changed") {
      base = args[++index];
      if (!base || base.startsWith("--")) throw new Error("--changed needs a git ref");
    } else if (arg === "--overlap") overlap = true;
    else if (arg === "--help" || arg.startsWith("--")) {
      console.log(usage);
      process.exit(arg === "--help" ? 0 : 1);
    } else files.push(arg);
  }
  if (base === undefined && !files.length) {
    console.error(usage);
    process.exit(1);
  }
  process.once("exit", () => {
    for (const [path, original] of mutatedOwners) {
      try {
        restoreOwner(path, original);
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
    }
  });
  for (const [signal, status] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)
    process.on(signal, () => process.exit(status));
  const replays = selectReplays(root, base, files);
  if (!replays.length) {
    console.log("witness replay · 0 cases · no new or changed witnesses");
    process.exit(0);
  }
  const unitOverlap =
    overlap && files.length > 0 && files.every((file) => file.endsWith(".unit.test.ts"));
  const related =
    overlap && !unitOverlap
      ? buildGateGraph(
          root,
          new Map(),
          replays.flatMap((replay) => parseWitness(replay.witness)?.owner ?? []),
        )
      : undefined;
  const logs = gateLogDirectory("witness-replay");
  const started = Date.now();
  let failed = 0;
  const runner = await vitestRunner(root, logs);
  const witnessed = await replayWitnesses(root, replays, {
    workspace: related?.workspace ?? workspacePackages(root),
    run: runner.run,
    changed: runner.changed,
    ...(overlap
      ? {
          overlap: (owner: string) =>
            related
              ? selectGateSteps(related, {
                  comparison: "HEAD",
                  existing: [owner],
                  paths: [owner],
                  tests: true,
                  // Only the owner's units are read here, never a stage.
                  inputs: new Map(),
                }).ownedUnits
              : files,
        }
      : {}),
    print: (line) => {
      if (line.witnessed === false) failed++;
      console.log(JSON.stringify(line));
    },
  });
  await runner.close();
  console.log(
    `witness replay · ${replays.length} cases · ${failed} not witnessed · ${((Date.now() - started) / 1000).toFixed(2)}s`,
  );
  if (witnessed) removeGateLogs(logs);
  else console.error(`Vitest logs and JSON reports: ${logs}`);
  process.exit(witnessed ? 0 : 1);
}
