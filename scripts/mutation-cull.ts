#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off preferSchemaOverJson:off -- host mutation-testing tool.
/**
 * mutation-cull <package-or-dir> [--out DIR] [--concurrency N]
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

export interface CullOptions {
  readonly dir: string;
  readonly out?: string;
  readonly concurrency?: number;
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
  const { tests, testFiles } = inventory(root, dir, out);
  const testsKey = sha(
    TOOL_KEY,
    ...testFiles.map((file) => NodeFS.readFileSync(NodePath.join(root, file))),
  );
  const tracked = run("git", ["ls-files", "--", dir], root).split("\n").filter(Boolean);
  const sources = tracked.filter(mutatedFile);
  const stringified = stringifiedNames(
    tracked
      .filter((file) => SOURCE.test(file))
      .map((file) => NodeFS.readFileSync(NodePath.join(root, file), "utf8")),
  );
  const vitestConfig = nearestVitestConfig(root, dir);
  const revision = run("git", ["rev-parse", "HEAD"], root).trim();

  const mutants: Mutant[] = [];
  const reported: TestCase[] = [];
  const failed: string[] = [];
  sources.forEach((file, index) => {
    const name = reportName(file);
    const reportPath = NodePath.join(out, "reports", `${name}.json`);
    const keyPath = NodePath.join(out, "reports", `${name}.key`);
    const source = NodeFS.readFileSync(NodePath.join(root, file), "utf8");
    const mutate = mutateEntries(file, source, stringified);
    // The key covers the source and, when some functions stay unmutated, the ranges Stryker mutates.
    const key = sha(testsKey, source, ...mutate.filter((entry) => entry !== file));
    const fresh =
      NodeFS.existsSync(reportPath) &&
      NodeFS.existsSync(keyPath) &&
      NodeFS.readFileSync(keyPath, "utf8") === key;
    if (!fresh) {
      NodeFS.rmSync(reportPath, { force: true });
      const started = Date.now();
      if (mutate.length > 0) {
        const configPath = NodePath.join(out, "configs", `${name}.json`);
        NodeFS.writeFileSync(
          configPath,
          JSON.stringify({
            testRunner: "vitest",
            plugins: [plugin],
            // The repository runs vitest's default forks pool; the runner would pick threads, where a test
            // stubbing TZ cannot move the process time zone.
            vitest: { configFile: vitestConfig, related: true, dir, pool: "forks" },
            coverageAnalysis: "perTest",
            disableBail: true,
            inPlace: true,
            // Vitest strips types without checking them; Stryker's default would write `// @ts-nocheck` into
            // every file of the directory in place on every run.
            disableTypeChecks: false,
            allowEmpty: true,
            mutate,
            ignorePatterns: onlyDirectoryPatterns(dir),
            reporters: ["json"],
            jsonReporter: { fileName: reportPath },
            tempDirName: NodePath.relative(root, NodePath.join(out, "stryker-tmp")),
            cleanTempDir: true,
            concurrency,
          }),
        );
        const log = NodeFS.openSync(NodePath.join(out, "logs", `${name}.log`), "w");
        const result = NodeChildProcess.spawnSync(process.execPath, [core, "run", configPath], {
          cwd: root,
          stdio: ["ignore", log, log],
        });
        NodeFS.closeSync(log);
        for (const entry of NodeFS.readdirSync(root))
          if (/^stryker-setup-\d+\.js$/.test(entry)) NodeFS.rmSync(NodePath.join(root, entry));
        if (result.status !== 0) {
          failed.push(`${file}: stryker exited ${result.status}; see ${out}/logs/${name}.log`);
          NodeFS.rmSync(reportPath, { force: true });
          return;
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
            source: file,
            schema: `mutation-testing-report-schema ${String(written.schemaVersion)}`,
          },
          schemaVersion: written.schemaVersion,
          files: written.files,
          testFiles: written.testFiles,
        }),
      );
      NodeFS.writeFileSync(keyPath, key);
      console.log(
        `[${index + 1}/${sources.length}] ${file} ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
    }
    const report = decodeStrykerReport(JSON.parse(NodeFS.readFileSync(reportPath, "utf8")));
    mutants.push(...reportMutants(report));
    reported.push(...reportTests(report));
  });
  if (run("git", ["status", "--porcelain", "--", dir], root).trim() !== "")
    throw new Error(`${dir} changed during the run; Stryker's backup is under ${out}/stryker-tmp`);
  // A table without a file's mutants would call its tests KILLS-NONE; rerun to retry only these files.
  if (failed.length > 0)
    throw new Error(`no table: ${failed.length} file(s) failed\n${failed.join("\n")}`);

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
  const [dir] = args;
  if (dir === undefined || args.length !== 1) {
    console.error(
      "usage: node scripts/mutation-cull.ts <package-or-dir> [--out DIR] [--concurrency N]",
    );
    process.exit(2);
  }
  const { rows } = mutationCull({
    dir,
    ...(out === undefined ? {} : { out }),
    ...(concurrency === undefined ? {} : { concurrency: Number(concurrency) }),
  });
  const counts = new Map<Verdict, number>();
  for (const row of rows) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  console.log([...counts].map(([verdict, count]) => `${verdict} ${count}`).join(", "));
}
