#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- host Git guard.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync, Visitor } from "oxc-parser";
import { sentenceComparison } from "./check-test-sentences.ts";
import { testClockFile, testClockLedger } from "./gate-input-scopes.ts";

/** The clocks a test reads time from; only they may read the live clock. */
export const clockModules = new Set([
  "apps/web/test/scenarios/harness/clientClock.ts",
  "apps/web/test/scenarios/fakes/fakeClock.ts",
]);

export const scannedFile = (path: string): boolean =>
  testClockFile(path) && !clockModules.has(path);

export interface ClockRead {
  readonly line: number;
  readonly column: number;
  readonly form: "Date.now()" | "new Date()" | "performance.now()";
}

/** Live clock reads: `Date.now()`, `performance.now()` and `new Date()` without arguments. */
export function findClockReads(source: string, file: string): ClockRead[] {
  const { program, errors } = parseSync(file, source);
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const reads: ClockRead[] = [];
  const at = (offset: number, form: ClockRead["form"]) => {
    const before = source.slice(0, offset).split("\n");
    reads.push({ line: before.length, column: before.at(-1)!.length + 1, form });
  };
  new Visitor({
    CallExpression(node) {
      const callee = node.callee;
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "now" &&
        (callee.object.name === "Date" || callee.object.name === "performance")
      )
        at(node.start, callee.object.name === "Date" ? "Date.now()" : "performance.now()");
    },
    NewExpression(node) {
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "Date" &&
        node.arguments.length === 0
      )
        at(node.start, "new Date()");
    },
  }).visit(program);
  return reads;
}

export type TestClockLedger = Readonly<Record<string, number>>;

/**
 * A scanned file reads the live clock exactly as often as its ledger entry allows; the ledger never
 * grows past its comparison revision, and an entry above the file's reads must be lowered.
 */
export function ledgerProblems(
  reads: ReadonlyMap<string, ReadonlyArray<ClockRead>>,
  ledger: TestClockLedger,
  previous: TestClockLedger | undefined,
): string[] {
  const problems: string[] = [];
  if (previous)
    for (const [file, allowed] of Object.entries(ledger))
      if (allowed > (previous[file] ?? 0))
        problems.push(
          `${file}: test clock ledger grew ${previous[file] ?? 0} → ${allowed}; read the harness clock instead.`,
        );
  for (const [file, found] of reads) {
    const allowed = ledger[file] ?? 0;
    if (found.length > allowed)
      for (const read of found)
        problems.push(
          `${file}:${read.line}:${read.column} reads ${read.form} outside the harness clock (ledger allows ${allowed}).`,
        );
    else if (found.length < allowed)
      problems.push(
        found.length
          ? `${file}: lower the test clock ledger entry to ${found.length} (currently ${allowed}).`
          : `${file}: remove its test clock ledger entry (currently ${allowed}).`,
      );
  }
  return problems;
}

function git(root: string, args: string[]): string {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || `git ${args.join(" ")} failed`);
  return result.stdout;
}

const decodeLedger = (raw: string): TestClockLedger => {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.values(value).every((count) => Number.isSafeInteger(count) && count > 0)
  )
    throw new Error(`Invalid ${testClockLedger}`);
  return value as TestClockLedger;
};

function previousLedger(root: string, revision: string): TestClockLedger | undefined {
  const exists = (path: string) =>
    NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${revision}:${path}`], { cwd: root })
      .status === 0;
  if (exists(testClockLedger))
    return decodeLedger(git(root, ["show", `${revision}:${testClockLedger}`]));
  // First installation seeds the ledger; a later deletion is an error.
  if (exists("scripts/check-test-clock.ts"))
    throw new Error(`Base revision has no ${testClockLedger}`);
  return undefined;
}

/** Without files, every tracked test file and every ledger entry are checked. */
export function checkTestClock(
  root: string,
  {
    base,
    files,
  }: { readonly base?: string | undefined; readonly files?: ReadonlyArray<string> } = {},
): string[] {
  const ledger = decodeLedger(NodeFS.readFileSync(NodePath.join(root, testClockLedger), "utf8"));
  const scope = files?.length
    ? files.filter(scannedFile)
    : [
        ...new Set([
          ...git(root, ["ls-files", "-z"]).split("\0").filter(scannedFile),
          ...Object.keys(ledger),
        ]),
      ];
  const reads = new Map<string, ClockRead[]>();
  for (const file of scope.sort()) {
    const path = NodePath.join(root, file);
    reads.set(
      file,
      scannedFile(file) && NodeFS.existsSync(path)
        ? findClockReads(NodeFS.readFileSync(path, "utf8"), file)
        : [],
    );
  }
  return ledgerProblems(reads, ledger, previousLedger(root, sentenceComparison(root, base)));
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const base = args[0] === "--base" ? args[1] : undefined;
    const files = base === undefined ? args : args.slice(2);
    if ((args[0] === "--base" && !base) || files.some((file) => file.startsWith("--")))
      throw new Error("Usage: node scripts/check-test-clock.ts [--base <ref>] [file...]");
    const problems = checkTestClock(NodePath.resolve(import.meta.dirname, ".."), { base, files });
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exitCode = 1;
    else console.log("Tests read time from the harness clock (or a shrinking ledger entry).");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
