#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- host mutation-testing tool.
/**
 * mutation-cull <package-or-dir> [--out DIR] [--concurrency N] [--tests a.test.ts,b.test.ts]
 *
 * Runs StrykerJS (vitest runner, per-test coverage, no bail) on every source file of a directory and writes one
 * row per test case of that directory in CULL.tsv's columns: KILLS-NONE (no mutant fails it), DUPLICATE (every
 * mutant it kills is killed by a cheaper test) or KILLS (with one killed mutant as its witness). Agents judge the
 * rows the tool cannot decide; the tool replaces their one-line mutation trials.
 *
 * Restartable per file: each source file's Stryker report is kept under <out>/reports with a key over the file,
 * the directory's tests and the tool version; a rerun skips files whose key still matches.
 * Stryker runs in place (no sandbox copy of the repository), so the directory must have no uncommitted changes.
 * Run it in a heavy slot: `heavy-slot node scripts/mutation-cull.ts packages/shared/src`.
 *
 * Known gap: under the repository's vitest 5 the Stryker 10.1.1 vitest runner does not reliably activate static
 * (module-level) mutants; a test that guards only module-level code (a schema, a literal table) can read as
 * KILLS-NONE or DUPLICATE, and which static mutants count as killed varies with host load.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { parseSync } from "oxc-parser";
import { testWorkerBudget } from "./lib/test-worker-budget.ts";

const STRYKER_VERSION = "10.1.1";
/** Bumping this re-runs every file: it is part of each report's key. */
const TOOL_KEY = `stryker-${STRYKER_VERSION}/perTest/disableBail/forks`;

export type Verdict = "KILLS-NONE" | "DUPLICATE" | "KILLS";

export interface TestCase {
  /** Repository-relative test file. */
  readonly file: string;
  readonly line: number;
  /** Vitest's full name: describe blocks and the case title joined by " > ". */
  readonly name: string;
}

export interface Mutant {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly mutator: string;
  /** The original source text the mutant replaces, on one line. */
  readonly original: string;
  readonly replacement: string;
  readonly status: string;
  readonly killedBy: readonly string[];
  readonly coveredBy: readonly string[];
}

export interface CullRow {
  readonly test: TestCase;
  readonly verdict: Verdict;
  /** `owner path:line | old → new` for KILLS, the covering test for DUPLICATE, empty for KILLS-NONE. */
  readonly mutation: string;
  readonly reason: string;
}

export const testKey = (test: TestCase): string => `${test.file}:${test.line}\t${test.name}`;

interface StrykerTest {
  readonly id: string;
  readonly name: string;
  readonly location?: { readonly start: { readonly line: number } };
}
interface StrykerMutant {
  readonly mutatorName: string;
  readonly replacement?: string;
  readonly status: string;
  readonly killedBy?: readonly string[];
  readonly coveredBy?: readonly string[];
  readonly location: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
}
interface StrykerReport {
  readonly files: Readonly<
    Record<string, { readonly source: string; readonly mutants: readonly StrykerMutant[] }>
  >;
  readonly testFiles?: Readonly<Record<string, { readonly tests: readonly StrykerTest[] }>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Decodes a mutation-testing-report-schema report as StrykerJS writes it; throws on a shape it cannot read. */
export function decodeStrykerReport(value: unknown): StrykerReport {
  if (!isRecord(value) || !isRecord(value.files)) throw new Error("report: no files object");
  for (const [path, file] of Object.entries(value.files)) {
    if (!isRecord(file) || typeof file.source !== "string" || !Array.isArray(file.mutants))
      throw new Error(`report: ${path} has no source or mutants`);
    for (const mutant of file.mutants as unknown[]) {
      if (
        !isRecord(mutant) ||
        typeof mutant.status !== "string" ||
        typeof mutant.mutatorName !== "string" ||
        !isRecord(mutant.location)
      )
        throw new Error(`report: ${path} has a mutant without status, mutator or location`);
    }
  }
  if (value.testFiles !== undefined && !isRecord(value.testFiles))
    throw new Error("report: testFiles is not an object");
  return value as unknown as StrykerReport;
}

const offsetOf = (lineStarts: readonly number[], line: number, column: number) =>
  (lineStarts[line - 1] ?? 0) + column - 1;

/** The report's mutants with killers and coverers named by test key instead of the run's numeric ids. */
export function reportMutants(report: StrykerReport): Mutant[] {
  const keyById = new Map<string, string>();
  for (const [file, { tests }] of Object.entries(report.testFiles ?? {}))
    for (const test of tests)
      keyById.set(
        test.id,
        testKey({ file, line: test.location?.start.line ?? 0, name: test.name }),
      );
  const named = (ids: readonly string[] | undefined) =>
    (ids ?? []).flatMap((id) => {
      const key = keyById.get(id);
      return key === undefined ? [] : [key];
    });
  return Object.entries(report.files).flatMap(([file, { source, mutants }]) => {
    const lineStarts = [0];
    for (let index = 0; index < source.length; index++)
      if (source[index] === "\n") lineStarts.push(index + 1);
    return mutants.map((mutant) => {
      const { start, end } = mutant.location;
      return {
        file,
        line: start.line,
        column: start.column,
        mutator: mutant.mutatorName,
        original: source
          .slice(
            offsetOf(lineStarts, start.line, start.column),
            offsetOf(lineStarts, end.line, end.column),
          )
          .replace(/\s+/g, " "),
        replacement: (mutant.replacement ?? "").replace(/\s+/g, " "),
        status: mutant.status,
        killedBy: named(mutant.killedBy),
        coveredBy: named(mutant.coveredBy),
      };
    });
  });
}

/**
 * The Timeout mutants of a report, as Stryker `mutate` ranges grouped by the test file that covers them ("" for a
 * static mutant, which every test runs). Ranges take Stryker's 1-based lines and 0-based inclusive columns; the
 * report's columns are 1-based.
 */
export function timeoutPlan(report: StrykerReport): Map<string, string[]> {
  const fileById = new Map<string, string>();
  for (const [file, { tests }] of Object.entries(report.testFiles ?? {}))
    for (const test of tests) fileById.set(test.id, file);
  const plan = new Map<string, string[]>();
  for (const [file, { mutants }] of Object.entries(report.files))
    for (const mutant of mutants) {
      if (mutant.status !== "Timeout") continue;
      const { start, end } = mutant.location;
      const range = `${file}:${start.line}:${start.column - 1}-${end.line}:${end.column - 1}`;
      const testFiles = new Set((mutant.coveredBy ?? []).flatMap((id) => fileById.get(id) ?? []));
      for (const testFile of testFiles.size === 0 ? [""] : testFiles) {
        const ranges = plan.get(testFile) ?? [];
        if (!ranges.includes(range)) ranges.push(range);
        plan.set(testFile, ranges);
      }
    }
  return plan;
}

const TIMEOUT_ORDER = ["Killed", "Timeout", "RuntimeError", "Survived"];

/**
 * Replaces each Timeout mutant by its re-runs, one per covering test file: killed by every test any re-run names,
 * otherwise the strongest status a re-run saw (Timeout, then RuntimeError, then Survived). A re-run's outcome
 * comes from a failed assertion or Stryker's hit counter, never the clock, so the table does not depend on load.
 */
export function settleTimeouts(mutants: readonly Mutant[], reruns: readonly Mutant[]): Mutant[] {
  const byId = new Map<string, Mutant[]>();
  for (const rerun of reruns) {
    const id = mutantId(rerun);
    byId.set(id, [...(byId.get(id) ?? []), rerun]);
  }
  return mutants.map((mutant) => {
    if (mutant.status !== "Timeout") return mutant;
    const runs = byId.get(mutantId(mutant));
    if (runs === undefined) throw new Error(`no re-run of Timeout mutant ${mutantId(mutant)}`);
    const killedBy = [...new Set(runs.flatMap((run) => run.killedBy))].sort();
    const status =
      killedBy.length > 0
        ? "Killed"
        : (TIMEOUT_ORDER.find((candidate) => runs.some((run) => run.status === candidate)) ??
          runs[0]!.status);
    return { ...mutant, status, killedBy };
  });
}

/** The cases a report's runs executed, with `it.each` rows expanded to their own titles. */
export const reportTests = (report: StrykerReport): TestCase[] =>
  Object.entries(report.testFiles ?? {}).flatMap(([file, { tests }]) =>
    tests.map((test) => ({ file, line: test.location?.start.line ?? 0, name: test.name })),
  );

/**
 * Every case of the directory once: the cases Stryker ran, plus the listed cases of test files no run executed.
 * A run executes whole test files, and `vitest list` names an `it.each` table once by its template, so a listed
 * case stands in only for a file no run reported.
 */
export function caseInventory(
  listed: readonly TestCase[],
  reported: readonly TestCase[],
): TestCase[] {
  const cases = new Map(reported.map((test) => [testKey(test), test]));
  const ranFiles = new Set(reported.map((test) => test.file));
  for (const test of listed) if (!ranFiles.has(test.file)) cases.set(testKey(test), test);
  return [...cases.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name),
  );
}

const mutantId = (mutant: Mutant) =>
  `${mutant.file}:${mutant.line}:${mutant.column}:${mutant.mutator}:${mutant.original}→${mutant.replacement}`;

const isString = (mutant: Mutant) => mutant.mutator === "StringLiteral";

const clip = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

export const witnessLine = (mutant: Mutant): string =>
  `${mutant.file}:${mutant.line} | ${clip(mutant.original)} → ${clip(mutant.replacement)}`;

/**
 * Classifies every inventoried test against the mutants of its directory.
 * KILLS-NONE: no mutant fails it. DUPLICATE: another test kills every mutant it kills and is no more expensive;
 * cost is the number of mutants a test covers or kills (deterministic, unlike its run time); ties go to the
 * earlier test.
 * KILLS: the rest; its witness is the killed mutant with the fewest killers, a logic mutant before a string
 * literal one (a changed string is a copy check), then the shortest original text.
 * The reason column carries the facts an agent needs: kill, unique-kill and coverage counts, whether a minimal
 * set of killing tests (greedy set cover, pruned) needs it, and how many covered mutants no test kills.
 */
export function classifyTests(tests: readonly TestCase[], mutants: readonly Mutant[]): CullRow[] {
  const order = new Map(tests.map((test, index) => [testKey(test), index]));
  const kills = new Map<string, Set<string>>();
  const covered = new Map<string, Set<string>>();
  const survivorsCovered = new Map<string, number>();
  const timeoutsCovered = new Map<string, number>();
  const killers = new Map<string, number>();
  const mutantById = new Map<string, Mutant>();
  for (const key of order.keys()) {
    kills.set(key, new Set());
    covered.set(key, new Set());
  }
  for (const mutant of mutants) {
    const id = mutantId(mutant);
    mutantById.set(id, mutant);
    killers.set(id, new Set(mutant.killedBy).size);
    for (const key of mutant.killedBy) {
      kills.get(key)?.add(id);
      covered.get(key)?.add(id);
    }
    for (const key of mutant.coveredBy) {
      covered.get(key)?.add(id);
      if (mutant.status === "Survived")
        survivorsCovered.set(key, (survivorsCovered.get(key) ?? 0) + 1);
      if (mutant.status === "Timeout")
        timeoutsCovered.set(key, (timeoutsCovered.get(key) ?? 0) + 1);
    }
  }
  // Static mutants (module-level code) run every test and name no coverers, so a killer counts as covering.
  const cost = (key: string) => covered.get(key)?.size ?? 0;
  const cheaper = (a: string, b: string) =>
    cost(a) !== cost(b) ? cost(a) < cost(b) : order.get(a)! < order.get(b)!;
  const killing = [...kills.entries()].filter(([, set]) => set.size > 0).map(([key]) => key);

  const cover = new Set<string>();
  const uncovered = new Set(killing.flatMap((key) => [...kills.get(key)!]));
  while (uncovered.size > 0) {
    let best: string | undefined;
    let bestGain = 0;
    for (const key of killing) {
      if (cover.has(key)) continue;
      let gain = 0;
      for (const id of kills.get(key)!) if (uncovered.has(id)) gain++;
      if (
        gain > bestGain ||
        (gain === bestGain && gain > 0 && best !== undefined && cheaper(key, best))
      ) {
        best = key;
        bestGain = gain;
      }
    }
    if (best === undefined) break;
    cover.add(best);
    for (const id of kills.get(best)!) uncovered.delete(id);
  }
  for (const key of [...cover].sort((a, b) => (cheaper(a, b) ? 1 : -1))) {
    const others = [...cover].filter((other) => other !== key);
    if ([...kills.get(key)!].every((id) => others.some((other) => kills.get(other)!.has(id))))
      cover.delete(key);
  }

  return tests.map((test) => {
    const key = testKey(test);
    const own = kills.get(key)!;
    const unique = [...own].filter((id) => killers.get(id) === 1).length;
    const stringKills = [...own].filter((id) => isString(mutantById.get(id)!)).length;
    const facts = [
      `kills=${own.size}`,
      `unique=${unique}`,
      `string-kills=${stringKills}`,
      `covers=${cost(key)}`,
      `survivors-covered=${survivorsCovered.get(key) ?? 0}`,
      ...(timeoutsCovered.has(key) ? [`timeouts-covered=${timeoutsCovered.get(key)}`] : []),
      `cover=${cover.has(key) ? "needed" : "redundant"}`,
    ];
    if (own.size === 0)
      return { test, verdict: "KILLS-NONE", mutation: "", reason: facts.join(" ") } as const;
    const superset = killing.find(
      (other) =>
        other !== key && !cheaper(key, other) && [...own].every((id) => kills.get(other)!.has(id)),
    );
    if (superset !== undefined)
      return {
        test,
        verdict: "DUPLICATE",
        mutation: superset.split("\t")[0]!,
        reason: [...facts, `duplicate-of=${superset.replace("\t", " ")}`].join(" "),
      } as const;
    const witness = [...own]
      .map((id) => mutantById.get(id)!)
      .sort(
        (a, b) =>
          killers.get(mutantId(a))! - killers.get(mutantId(b))! ||
          Number(isString(a)) - Number(isString(b)) ||
          a.original.length - b.original.length,
      )[0]!;
    return {
      test,
      verdict: "KILLS",
      mutation: witnessLine(witness),
      reason: facts.join(" "),
    } as const;
  });
}

const cell = (text: string) => text.replace(/\t/g, " ").replace(/\r?\n/g, "\\n");
const title = (name: string) => name.split(" > ").at(-1)!;

/** CULL.tsv's columns: `file:line  title  verdict  sentence  mutation  reason`. */
export function cullTsv(rows: readonly CullRow[]): string {
  return [
    "file:line\ttitle\tverdict\tsentence\tmutation\treason",
    ...rows.map((row) =>
      [
        `${row.test.file}:${row.test.line}`,
        title(row.test.name),
        row.verdict,
        row.test.name,
        row.mutation,
        row.reason,
      ]
        .map(cell)
        .join("\t"),
    ),
  ].join("\n");
}

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const NOT_MUTATED =
  /\.(?:test|spec|d)\.|(?:^|\/)(?:__fixtures__|__tests__|fixtures|testing|test)\//;
/** Source files the tool mutates: tracked code in the directory, without tests, fixtures and test helpers. */
export const mutatedFile = (path: string): boolean => SOURCE.test(path) && !NOT_MUTATED.test(path);

/** Names some file calls `.toString()` on: a function stringified that way runs without Stryker's runtime. */
export const stringifiedNames = (texts: readonly string[]): Set<string> =>
  new Set(
    texts.flatMap((text) =>
      [...text.matchAll(/\b([A-Za-z_$][\w$]*)\.toString\(\)/g)].map((m) => m[1]!),
    ),
  );

/**
 * Stryker `mutate` entries for a file without the top-level functions named in `stringified`: instrumented
 * code inside them references Stryker's global, so a test that rebuilds one from its text fails the dry run.
 */
export function mutateEntries(
  file: string,
  source: string,
  stringified: ReadonlySet<string>,
): string[] {
  const { program } = parseSync(file, source);
  const lineOf = (offset: number) => source.slice(0, offset).split("\n").length;
  const skipped: Array<readonly [number, number]> = [];
  for (const statement of program.body) {
    const node =
      statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    if (!node) continue;
    const names =
      node.type === "FunctionDeclaration"
        ? [node.id?.name]
        : node.type === "VariableDeclaration"
          ? node.declarations.map((declarator) =>
              declarator.id.type === "Identifier" ? declarator.id.name : undefined,
            )
          : [];
    if (names.some((name) => name !== undefined && stringified.has(name)))
      skipped.push([lineOf(statement.start), lineOf(statement.end)]);
  }
  if (skipped.length === 0) return [file];
  const entries: string[] = [];
  let next = 1;
  for (const [start, end] of skipped) {
    if (start > next) entries.push(`${file}:${next}-${start - 1}`);
    next = end + 1;
  }
  const last = source.split("\n").length;
  if (next <= last) entries.push(`${file}:${next}-${last}`);
  return entries;
}

/** gitignore lines that leave only `dir` visible to Stryker's file scan (a parent cannot be re-included). */
export function onlyDirectoryPatterns(dir: string): string[] {
  const patterns = ["/*"];
  const parts = dir.split("/").filter(Boolean);
  parts.forEach((part, index) => {
    const path = `/${parts.slice(0, index + 1).join("/")}`;
    patterns.push(`!${path}`);
    if (index < parts.length - 1) patterns.push(`${path}/*`);
  });
  return patterns;
}

const run = (command: string, args: readonly string[], cwd: string) => {
  const result = NodeChildProcess.spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  return result.stdout;
};

const sha = (...parts: readonly (string | Buffer)[]) => {
  const hash = NodeCrypto.createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
};

/** One npm install of Stryker per version, shared by every worktree on the machine. */
function strykerCache(): string {
  const base = process.env.WT_ROOT
    ? NodePath.join(process.env.WT_ROOT, ".cache")
    : NodePath.join(NodeOS.homedir(), ".cache");
  const cache = NodePath.join(base, "mutation-cull", `stryker-${STRYKER_VERSION}`);
  if (NodeFS.existsSync(NodePath.join(cache, "node_modules/@stryker-mutator/core/package.json")))
    return cache;
  NodeFS.mkdirSync(cache, { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(cache, "package.json"),
    JSON.stringify({
      name: "mutation-cull-tool",
      private: true,
      dependencies: {
        "@stryker-mutator/core": STRYKER_VERSION,
        "@stryker-mutator/vitest-runner": STRYKER_VERSION,
      },
    }),
  );
  run("npm", ["install", "--no-audit", "--no-fund", "--omit=peer"], cache);
  return cache;
}

/**
 * The vitest runner must load the same vitest copy as the tests (vite-plus re-exports it), or its runner state
 * never sees their cases. Node resolves a package from its real path, so the worktree gets its own copy of the
 * small runner package beside a `vitest` link to the worktree's vitest; every other package links to the cache.
 */
function runnerPlugin(root: string, cache: string): string {
  const fromRoot = NodeModule.createRequire(NodePath.join(root, "package.json"));
  const vitePlus = NodeFS.realpathSync(
    NodePath.dirname(fromRoot.resolve("vite-plus/package.json")),
  );
  const vitest = NodePath.dirname(
    NodeModule.createRequire(NodePath.join(vitePlus, "package.json")).resolve(
      "vitest/package.json",
    ),
  );
  const layer = NodePath.join(root, "node_modules/.mutation-cull", STRYKER_VERSION, "node_modules");
  const cached = NodePath.join(cache, "node_modules");
  const link = (target: string, path: string) => {
    NodeFS.rmSync(path, { recursive: true, force: true });
    NodeFS.symlinkSync(target, path);
  };
  NodeFS.mkdirSync(NodePath.join(layer, "@stryker-mutator"), { recursive: true });
  for (const entry of NodeFS.readdirSync(cached)) {
    if (entry.startsWith(".") || entry === "@stryker-mutator" || entry === "vitest") continue;
    if (!NodeFS.existsSync(NodePath.join(layer, entry)))
      link(NodePath.join(cached, entry), NodePath.join(layer, entry));
  }
  for (const entry of NodeFS.readdirSync(NodePath.join(cached, "@stryker-mutator"))) {
    const path = NodePath.join(layer, "@stryker-mutator", entry);
    if (entry === "vitest-runner") {
      if (!NodeFS.existsSync(path))
        NodeFS.cpSync(NodePath.join(cached, "@stryker-mutator", entry), path, { recursive: true });
    } else if (!NodeFS.existsSync(path))
      link(NodePath.join(cached, "@stryker-mutator", entry), path);
  }
  const vitestLink = NodePath.join(layer, "vitest");
  if (!NodeFS.existsSync(vitestLink) || NodeFS.realpathSync(vitestLink) !== vitest)
    link(vitest, vitestLink);
  return NodePath.join(layer, "@stryker-mutator/vitest-runner/dist/src/index.js");
}

interface Inventory {
  readonly tests: TestCase[];
  readonly testFiles: string[];
}

function inventory(root: string, dir: string, out: string): Inventory {
  const json = NodePath.join(out, "inventory.json");
  run(NodePath.join(root, "node_modules/.bin/vp"), ["test", "list", `--json=${json}`, dir], root);
  const listed = JSON.parse(NodeFS.readFileSync(json, "utf8")) as unknown;
  if (!Array.isArray(listed)) throw new Error("vitest list: not an array");
  const tests = listed.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.file !== "string" ||
      !isRecord(entry.location) ||
      typeof entry.location.line !== "number"
    )
      throw new Error(`vitest list: unreadable entry ${JSON.stringify(entry)}`);
    return {
      file: NodePath.relative(root, entry.file),
      line: entry.location.line,
      name: entry.name,
    };
  });
  return { tests, testFiles: [...new Set(tests.map((test) => test.file))].sort() };
}

function nearestVitestConfig(root: string, dir: string): string {
  for (let at = NodePath.join(root, dir); ; at = NodePath.dirname(at)) {
    for (const name of ["vitest.config.ts", "vite.config.ts"])
      if (NodeFS.existsSync(NodePath.join(at, name)))
        return NodePath.relative(root, NodePath.join(at, name));
    if (at === root)
      throw new Error(`no vite or vitest config between ${dir} and the repository root`);
  }
}

const reportName = (file: string) => file.replace(/[/\\]/g, "__");

/**
 * Stryker's timeout is wall-clock (dry-run time × 1.5 + 5 s), so under load a slow kill becomes a Timeout without
 * killers. Timeout mutants are re-run alone, per covering test file, where the clock only guards a hang.
 */
const RERUN_TIMEOUT_MS = 30_000;

/** tsconfig text without comments and trailing commas (JSONC), as JSON.parse reads it. */
const jsonc = (text: string): unknown => {
  let out = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at]!;
    if (char === '"') {
      const end = text.indexOf('"', at + 1);
      let close = end;
      while (close > 0 && text[close - 1] === "\\") close = text.indexOf('"', close + 1);
      out += text.slice(at, close + 1);
      at = close;
    } else if (char === "/" && text[at + 1] === "/") at = text.indexOf("\n", at) - 1;
    else if (char === "/" && text[at + 1] === "*") at = text.indexOf("*/", at) + 1;
    else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
};

/**
 * The tracked files a test file imports directly, by a relative specifier or one of its nearest tsconfig's
 * `paths` patterns (`"~/*": ["./src/*"]`); TypeScript's `.js` spelling resolves to the `.ts` source.
 */
export function directImports(
  root: string,
  testFile: string,
  tracked: ReadonlySet<string>,
): string[] {
  const text = NodeFS.readFileSync(NodePath.join(root, testFile), "utf8");
  const { program } = parseSync(testFile, text);
  const specifiers = program.body.flatMap((statement) =>
    (statement.type === "ImportDeclaration" ||
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportAllDeclaration") &&
    statement.source
      ? [statement.source.value]
      : [],
  );
  let paths: Array<readonly [string, string]> = [];
  for (let at = NodePath.dirname(testFile); ; at = NodePath.dirname(at)) {
    const tsconfig = NodePath.join(root, at, "tsconfig.json");
    if (NodeFS.existsSync(tsconfig)) {
      const options = (
        jsonc(NodeFS.readFileSync(tsconfig, "utf8")) as {
          compilerOptions?: { paths?: Record<string, readonly string[]> };
        }
      ).compilerOptions;
      paths = Object.entries(options?.paths ?? {}).flatMap(([pattern, [target]]) =>
        pattern.endsWith("*") && target?.endsWith("*")
          ? [[pattern.slice(0, -1), NodePath.join(at, target.slice(0, -1))] as const]
          : [],
      );
      break;
    }
    if (at === "." || at === "") break;
  }
  return [
    ...new Set(
      specifiers.flatMap((specifier) => {
        const alias = paths.find(([prefix]) => specifier.startsWith(prefix));
        const base = specifier.startsWith(".")
          ? NodePath.join(NodePath.dirname(testFile), specifier)
          : alias
            ? NodePath.join(alias[1], specifier.slice(alias[0].length))
            : undefined;
        if (base === undefined) return [];
        const stem = base.replace(/\.[cm]?js$/, "");
        const found = [
          base,
          ...["ts", "tsx", "index.ts", "index.tsx"].map((ext) =>
            ext.startsWith("index") ? `${stem}/${ext}` : `${stem}.${ext}`,
          ),
        ].find((candidate) => tracked.has(candidate));
        return found === undefined ? [] : [found];
      }),
    ),
  ];
}

export interface CullOptions {
  readonly dir: string;
  readonly out?: string;
  readonly concurrency?: number;
  /**
   * Scope to these test files: only their cases are classified, only they run, and only the files they import
   * directly are mutated (a whole large directory costs hours; a card's test files and their owners do not).
   */
  readonly tests?: readonly string[];
}

export function mutationCull(options: CullOptions): {
  readonly tsv: string;
  readonly rows: CullRow[];
} {
  const absolute = NodePath.resolve(options.dir);
  const root = run("git", ["rev-parse", "--show-toplevel"], absolute).trim();
  const dir = NodePath.relative(root, absolute) || ".";
  const out = NodePath.resolve(
    options.out ?? NodePath.join(root, ".plans/mutation-cull", dir.replace(/[/\\]/g, "-")),
  );
  const concurrency =
    options.concurrency ??
    testWorkerBudget(process.env.HEAVY_SLOTS ?? "7", NodeOS.availableParallelism())!;
  if (run("git", ["status", "--porcelain", "--", dir], root).trim() !== "")
    throw new Error(
      `${dir} has uncommitted changes; Stryker mutates it in place. After an interrupted run, restore it with ` +
        `\`git checkout -- ${dir}\` (Stryker's backup: ${out}/stryker-tmp).`,
    );
  for (const sub of ["reports", "logs", "configs"])
    NodeFS.mkdirSync(NodePath.join(out, sub), { recursive: true });

  const cache = strykerCache();
  const plugin = runnerPlugin(root, cache);
  const core = NodePath.join(cache, "node_modules/@stryker-mutator/core/bin/stryker.js");
  const scope = options.tests?.map((file) => NodePath.relative(root, NodePath.resolve(file)));
  const listed = inventory(root, dir, out);
  const testFiles = scope ?? listed.testFiles;
  const tests = scope ? listed.tests.filter((test) => scope.includes(test.file)) : listed.tests;
  const testsKey = sha(
    TOOL_KEY,
    ...(scope ? ["scoped", ...scope] : []),
    ...testFiles.map((file) => NodeFS.readFileSync(NodePath.join(root, file))),
  );
  const tracked = run("git", ["ls-files", "--", dir], root).split("\n").filter(Boolean);
  const trackedSet = new Set(tracked);
  const sources = scope
    ? [...new Set(scope.flatMap((file) => directImports(root, file, trackedSet)))]
        .filter(mutatedFile)
        .sort()
    : tracked.filter(mutatedFile);
  const stringified = stringifiedNames(
    tracked
      .filter((file) => SOURCE.test(file))
      .map((file) => NodeFS.readFileSync(NodePath.join(root, file), "utf8")),
  );
  const vitestConfig = nearestVitestConfig(root, dir);
  // Stryker runs from the config's folder, as the repository runs a package's tests: a package config's
  // `include` and `globalSetup` paths are relative to it. Paths cross that boundary through these two maps.
  const base = NodePath.dirname(vitestConfig);
  const cwd = NodePath.join(root, base);
  const fromRoot = (entry: string) => {
    const [, path, range = ""] = /^(.*?)(:\d+(?::\d+)?-\d+(?::\d+)?)?$/.exec(entry)!;
    return NodePath.relative(base, path!) + range;
  };
  const toRoot = <T>(record: unknown): Record<string, T> =>
    Object.fromEntries(
      Object.entries((record ?? {}) as Record<string, T>).map(([path, value]) => [
        NodePath.relative(root, NodePath.resolve(cwd, path)),
        value,
      ]),
    );
  const revision = run("git", ["rev-parse", "HEAD"], root).trim();

  /**
   * One Stryker run writing `<name>.json` with its provenance and `<name>.key` (restart: a matching key skips it).
   * Returns the decoded report, or undefined after recording the failure.
   */
  const strykerReport = (
    name: string,
    key: string,
    source: string,
    job: {
      readonly mutate: readonly string[];
      readonly testFiles: readonly string[];
      readonly rerun: boolean;
    },
    failed: string[],
  ): StrykerReport | undefined => {
    const reportPath = NodePath.join(out, "reports", `${name}.json`);
    const keyPath = NodePath.join(out, "reports", `${name}.key`);
    const fresh =
      NodeFS.existsSync(reportPath) &&
      NodeFS.existsSync(keyPath) &&
      NodeFS.readFileSync(keyPath, "utf8") === key;
    if (!fresh) {
      NodeFS.rmSync(reportPath, { force: true });
      const started = Date.now();
      if (job.mutate.length > 0) {
        const configPath = NodePath.join(out, "configs", `${name}.json`);
        NodeFS.writeFileSync(
          configPath,
          JSON.stringify({
            testRunner: "vitest",
            plugins: [plugin],
            // The repository runs vitest's default forks pool; the runner would pick threads, where a test
            // stubbing TZ cannot move the process time zone.
            // The directory's tests are named through `testFiles`: vitest's `dir` would re-root a package
            // config's `include` patterns and find nothing.
            vitest: { configFile: NodePath.basename(vitestConfig), related: true, pool: "forks" },
            coverageAnalysis: "perTest",
            disableBail: true,
            inPlace: true,
            // Vitest strips types without checking them; Stryker's default would write `// @ts-nocheck` into
            // every file of the directory in place on every run.
            disableTypeChecks: false,
            allowEmpty: true,
            mutate: job.mutate.map(fromRoot),
            testFiles: job.testFiles.map(fromRoot),
            ignorePatterns: onlyDirectoryPatterns(NodePath.relative(base, dir)),
            reporters: ["json"],
            jsonReporter: { fileName: reportPath },
            tempDirName: NodePath.relative(cwd, NodePath.join(out, "stryker-tmp")),
            cleanTempDir: true,
            ...(job.rerun ? { concurrency: 1, timeoutMS: RERUN_TIMEOUT_MS } : { concurrency }),
          }),
        );
        const log = NodeFS.openSync(NodePath.join(out, "logs", `${name}.log`), "w");
        const result = NodeChildProcess.spawnSync(process.execPath, [core, "run", configPath], {
          cwd,
          stdio: ["ignore", log, log],
        });
        NodeFS.closeSync(log);
        for (const entry of NodeFS.readdirSync(cwd))
          if (/^stryker-setup-\d+\.js$/.test(entry)) NodeFS.rmSync(NodePath.join(cwd, entry));
        if (result.status !== 0) {
          failed.push(`${name}: stryker exited ${result.status}; see ${out}/logs/${name}.log`);
          NodeFS.rmSync(reportPath, { force: true });
          return undefined;
        }
      }
      // A file without mutants writes no report; record it as empty so a rerun skips it.
      const written: Record<string, unknown> = NodeFS.existsSync(reportPath)
        ? (JSON.parse(NodeFS.readFileSync(reportPath, "utf8")) as Record<string, unknown>)
        : { schemaVersion: "2", files: {}, testFiles: {} };
      NodeFS.writeFileSync(
        reportPath,
        JSON.stringify({
          $provenance: {
            producer: `StrykerJS ${STRYKER_VERSION} via scripts/mutation-cull.ts`,
            revision,
            source: job.rerun ? `${source} with ${job.testFiles.join(", ")}` : source,
            schema: `mutation-testing-report-schema ${String(written.schemaVersion)}`,
          },
          schemaVersion: written.schemaVersion,
          files: toRoot(written.files),
          testFiles: toRoot(written.testFiles),
        }),
      );
      NodeFS.writeFileSync(keyPath, key);
      console.log(`${name} ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    return decodeStrykerReport(JSON.parse(NodeFS.readFileSync(reportPath, "utf8")));
  };

  const mutants: Mutant[] = [];
  const reported: TestCase[] = [];
  const failed: string[] = [];
  for (const file of sources) {
    const name = reportName(file);
    const source = NodeFS.readFileSync(NodePath.join(root, file), "utf8");
    const mutate = mutateEntries(file, source, stringified);
    // The key covers the source and, when some functions stay unmutated, the ranges Stryker mutates.
    const key = sha(testsKey, source, ...mutate.filter((entry) => entry !== file));
    const report = strykerReport(name, key, file, { mutate, testFiles, rerun: false }, failed);
    if (report === undefined) continue;
    const reruns: Mutant[] = [];
    for (const [testFile, ranges] of timeoutPlan(report)) {
      const rerun = strykerReport(
        `${name}.timeouts${testFile ? `.${reportName(testFile)}` : ""}`,
        sha(key, String(RERUN_TIMEOUT_MS), testFile, ...ranges),
        file,
        {
          mutate: ranges,
          testFiles: testFile ? [testFile] : testFiles,
          rerun: true,
        },
        failed,
      );
      if (rerun !== undefined) reruns.push(...reportMutants(rerun));
    }
    if (failed.length > 0) continue;
    mutants.push(...settleTimeouts(reportMutants(report), reruns));
    reported.push(...reportTests(report));
  }
  if (run("git", ["status", "--porcelain", "--", dir], root).trim() !== "")
    throw new Error(`${dir} changed during the run; Stryker's backup is under ${out}/stryker-tmp`);
  // A table without a file's mutants would call its tests KILLS-NONE; rerun to retry only these files.
  if (failed.length > 0)
    throw new Error(`no table: ${failed.length} file(s) failed\n${failed.join("\n")}`);

  // Stryker exits 0 without a report when its dry run finds no test (a wrong config or test list); a table
  // without any run test would call every case KILLS-NONE.
  if (sources.length > 0 && reported.length === 0)
    throw new Error(`no table: no Stryker run executed a test of ${dir}; see ${out}/logs`);
  const rows = classifyTests(caseInventory(tests, reported), mutants);
  const tsv = cullTsv(rows);
  NodeFS.writeFileSync(NodePath.join(out, "MUTCULL.tsv"), `${tsv}\n`);
  return { tsv, rows };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const [, value] = args.splice(index, 2);
    if (value === undefined) throw new Error(`${name} needs a value`);
    return value;
  };
  const out = flag("--out");
  const concurrency = flag("--concurrency");
  const tests = flag("--tests");
  const [dir] = args;
  if (dir === undefined || args.length !== 1) {
    console.error(
      "usage: node scripts/mutation-cull.ts <package-or-dir> [--out DIR] [--concurrency N] [--tests a.test.ts,b.test.ts]",
    );
    process.exit(2);
  }
  const { rows } = mutationCull({
    dir,
    ...(out === undefined ? {} : { out }),
    ...(concurrency === undefined ? {} : { concurrency: Number(concurrency) }),
    ...(tests === undefined ? {} : { tests: tests.split(",") }),
  });
  const counts = new Map<Verdict, number>();
  for (const row of rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  console.log([...counts].map(([verdict, count]) => `${verdict} ${count}`).join(", "));
}
