#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- static tree check CLI.
/**
 * A unit is a directory holding a `SENTENCES.md`; its cases are the `*.unit.test.ts` files directly
 * in it. This check owns the list's format, the one-case-per-sentence mapping, each case's witness
 * line and the unit's admission (no mocks, processes, network, DOM, timers or wall clock), and
 * prints the list's delta against `--base`: the diff of the list is the record of a sentence.
 *
 * An id is numbered (`ED12`) or lane-local (`ED+1`). A branch writes lane-local ids for the
 * sentences it adds and never touches a list's `next:` line; a new unit's list starts `next: ED+`,
 * its prefix a proposal. With `--base` this branch rule is checked against the base's lists. The
 * landing (`scripts/land.ts`), the only writer of `main`, numbers them through `numberSentences`.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync } from "oxc-parser";
import { parseWitness } from "./gate-input-scopes.ts";

const LIST = "SENTENCES.md";
const UNIT_FILE = ".unit.test.ts";
// `+` marks a lane-local id (`ED+1`) and a list whose prefix is a proposal (`next: ED+`).
const nextLine = /^next: ([A-Z]{2,4})(\+|0|[1-9]\d*)$/u;
const sentenceLine = /^- ([A-Z]{2,4})(\+?)(0|[1-9]\d*) — (\S(?:.*\S)?)$/u;
const caseTitle = /^([A-Z]{2,4}\+?(?:0|[1-9]\d*)): ([\s\S]*)$/u;
const witnessLine = /^\s*\/\/ witness: (.*)$/u;

const bannedModules = new Set([
  "child_process",
  "net",
  "http",
  "https",
  "dgram",
  "worker_threads",
  "react-dom",
  "jsdom",
  "happy-dom",
  "playwright",
  "puppeteer",
]);
const bannedText: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfetch\(/u, "fetch("],
  [/\bnew WebSocket\b/u, "new WebSocket"],
  [/\bsetTimeout\(/u, "setTimeout("],
  [/\bsetInterval\(/u, "setInterval("],
  [/\bDate\.now\(/u, "Date.now("],
  [/\bperformance\.now\(/u, "performance.now("],
  [/\bnew Date\(\s*\)/u, "new Date()"],
];
const bannedModifiers: Readonly<Record<string, ReadonlyArray<string>>> = {
  it: ["each", "skip", "only", "todo"],
  describe: ["skip", "only", "each"],
};

interface Problem {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

interface Sentence {
  readonly id: string;
  /** The id's number: the final one, or `k` of a lane-local `<PREFIX>+<k>`. */
  readonly number: number;
  readonly local: boolean;
  readonly sentence: string;
  readonly line: number;
}

interface SentenceList {
  readonly prefix: string | undefined;
  /** The next free number; undefined for a `next: <PREFIX>+` list, whose prefix is a proposal. */
  readonly next: number | undefined;
  readonly proposal: boolean;
  readonly sentences: ReadonlyArray<Sentence>;
}

function git(root: string, args: ReadonlyArray<string>): string {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || `git ${args.join(" ")} failed`);
  return result.stdout;
}

/** Tracked files matching a pathspec that exist in the working tree. */
function listFiles(root: string, pattern: string, name: (path: string) => boolean): string[] {
  const paths = git(root, ["ls-files", "-z", "--", pattern])
    .split("\0")
    .filter((path) => path && name(path) && NodeFS.existsSync(NodePath.join(root, path)));
  return [...new Set(paths)].toSorted();
}

const unitDir = (listPath: string): string => NodePath.posix.dirname(listPath);

function findUnits(root: string): string[] {
  return listFiles(root, `*${LIST}`, (path) => NodePath.posix.basename(path) === LIST).map(unitDir);
}

const listUnitFiles = (root: string): string[] =>
  listFiles(root, `*${UNIT_FILE}`, (path) => path.endsWith(UNIT_FILE));

export interface Unit {
  readonly dir: string;
  /** The unit's cases: its `*.unit.test.ts` files directly in `dir`, repository-relative. */
  readonly files: ReadonlyArray<string>;
}

/** The units and their case files; T1 and the gate's replay selection read the list from here. */
export function readUnits(root: string): Unit[] {
  const unitFiles = listUnitFiles(root);
  return findUnits(root).map((dir) => ({
    dir,
    files: unitFiles.filter((path) => NodePath.posix.dirname(path) === dir),
  }));
}

/** Parses a list; `problems` receives every way the text departs from the format. */
function parseList(text: string, file: string, problems: Problem[] = []): SentenceList {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const problem = (line: number, what: string) => problems.push({ file, line, what });
  const head = nextLine.exec(lines[0] ?? "");
  if (!head) problem(1, "first line is not `next: <PREFIX><n>` or `next: <PREFIX>+`");
  const prefix = head?.[1];
  const proposal = head?.[2] === "+";
  const next = head && !proposal ? Number(head[2]) : undefined;
  if (lines.length > 1 && lines[1] !== "") problem(2, "second line is not blank");
  if (lines.length === 2 && lines[1] === "")
    problem(2, "a blank line ends the file with no sentence after it");
  const sentences: Sentence[] = [];
  const seen = new Set<string>();
  // A missing blank line is reported once; the line in its place is still read as a sentence.
  for (let index = lines[1] === "" ? 2 : 1; index < lines.length; index++) {
    const line = index + 1;
    const match = sentenceLine.exec(lines[index]!);
    if (!match) {
      problem(line, "not a `- <ID> — <sentence>` line");
      continue;
    }
    const [, idPrefix, plus, digits, sentence] = match;
    const local = plus === "+";
    const id = `${idPrefix}${plus}${digits}`;
    const number = Number(digits);
    if (prefix !== undefined && idPrefix !== prefix)
      problem(line, `${id} does not use the list's prefix ${prefix}`);
    if (!local && next !== undefined && number >= next)
      problem(line, `${id} is not below next ${prefix}${next}`);
    if (!local && proposal)
      problem(line, `${id} is numbered in a list whose next is ${prefix}+: the landing numbers it`);
    if (seen.has(id)) problem(line, `${id} is listed twice`);
    seen.add(id);
    sentences.push({ id, number, local, sentence: sentence!, line });
  }
  return { prefix, next, proposal, sentences };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function memberName(value: unknown): string | undefined {
  const node = record(value);
  if (node?.type !== "MemberExpression") return undefined;
  const property = record(node.property);
  const name = node.computed ? property?.value : property?.name;
  return typeof name === "string" ? name : undefined;
}

const testFunctions = ["it", "test", "describe"];
const testModules = ["vitest", "@effect/vitest", "vite-plus/test"];

/**
 * The test function each local name stands for: the file's named imports of `it`, `test` and
 * `describe` from a test module (`it as itEffect`), plus the bare names, which stay test functions
 * as globals and callback parameters (`(it) => it.effect(…)`).
 */
function testNames(program: unknown): ReadonlyMap<string, string> {
  const names = new Map(testFunctions.map((name) => [name, name]));
  const body = record(program)?.body;
  for (const declaration of (Array.isArray(body) ? body : []).map(record)) {
    if (
      declaration?.type !== "ImportDeclaration" ||
      !testModules.includes(String(record(declaration.source)?.value)) ||
      !Array.isArray(declaration.specifiers)
    )
      continue;
    for (const specifier of declaration.specifiers.map(record)) {
      const imported = record(specifier?.imported);
      const name = String(imported?.name ?? imported?.value);
      const local = record(specifier?.local)?.name;
      if (specifier?.type === "ImportSpecifier" && testFunctions.includes(name) && local)
        names.set(String(local), name);
    }
  }
  return names;
}

// Curried modifiers wrap the declaration; the title is the outer call's first argument.
function testCallee(value: unknown, names: ReadonlyMap<string, string>): boolean {
  const node = record(value);
  if (!node) return false;
  if (node.type === "Identifier") return names.has(String(node.name));
  if (memberName(node) !== undefined) return testCallee(node.object, names);
  if (node.type === "CallExpression" || node.type === "TaggedTemplateExpression")
    return curriedModifier(node.callee ?? node.tag, names);
  return false;
}

function curriedModifier(value: unknown, names: ReadonlyMap<string, string>): boolean {
  const node = record(value);
  return (
    node?.type === "MemberExpression" &&
    ["each", "for", "skipIf", "runIf", "layer"].includes(String(memberName(node))) &&
    testCallee(node.object, names)
  );
}

// Type assertions and parentheses do not change a table's literal rows.
function unwrap(value: unknown): Record<string, unknown> | undefined {
  const node = record(value);
  return node &&
    [
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
      "ParenthesizedExpression",
    ].includes(String(node.type))
    ? unwrap(node.expression)
    : node;
}

function stringValue(value: unknown): string | undefined {
  const node = unwrap(value);
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (
    node?.type !== "TemplateLiteral" ||
    !Array.isArray(node.expressions) ||
    node.expressions.length ||
    !Array.isArray(node.quasis)
  )
    return undefined;
  const text = record(record(node.quasis[0])?.value)?.cooked;
  return typeof text === "string" ? text : undefined;
}

const unresolved = Symbol("unresolved");

/** A row cell's source value, or `unresolved` when it is not written as a literal. */
function literalValue(value: unknown): unknown {
  const node = unwrap(value);
  const text = stringValue(node);
  if (text !== undefined) return text;
  if (node?.type === "Literal" && node.regex === undefined) return node.value;
  if (node?.type === "UnaryExpression" && node.operator === "-") {
    const number = literalValue(node.argument);
    return typeof number === "number" ? -number : unresolved;
  }
  if (node?.type === "ArrayExpression" && Array.isArray(node.elements)) {
    const items = node.elements.map(literalValue);
    return items.includes(unresolved) ? unresolved : items;
  }
  const fields = objectFields(node);
  if (!fields) return unresolved;
  const entries = [...fields].map(([key, field]) => [key, literalValue(field)] as const);
  return entries.some(([, field]) => field === unresolved)
    ? unresolved
    : Object.fromEntries(entries);
}

function objectFields(node: Record<string, unknown> | undefined) {
  if (node?.type !== "ObjectExpression" || !Array.isArray(node.properties)) return undefined;
  const fields = new Map<string, unknown>();
  for (const property of node.properties.map(record)) {
    const key = record(property?.key);
    const name = key?.type === "Identifier" ? key.name : key?.value;
    if (property?.type !== "Property" || property.computed || typeof name !== "string")
      return undefined;
    fields.set(name, property.value);
  }
  return fields;
}

function display(value: unknown, json: boolean): string | typeof unresolved {
  if (value === unresolved) return unresolved;
  if (!json && (typeof value !== "object" || value === null)) return String(value);
  return JSON.stringify(value);
}

/**
 * The title one literal table row gives a parameterized test, following Vitest's `%` and `$`
 * placeholders; rows that put no string into the title (indices, numbers) name no new sentence.
 */
function rowTitle(template: string, row: unknown, spread: boolean): string | undefined {
  const node = unwrap(row);
  const items =
    spread && node?.type === "ArrayExpression" && Array.isArray(node.elements)
      ? node.elements
      : [row];
  let sentence = false;
  let failed = false;
  const show = (value: unknown, json = false): string => {
    if (typeof value === "string") sentence = true;
    const text = display(value, json);
    if (text === unresolved) failed = true;
    return text === unresolved ? "" : text;
  };
  let next = 0;
  let title = template.replace(/%[sdifjoO#$%]/g, (token) => {
    if (token === "%%") return "%";
    // Row numbers stay placeholders so deleting one row does not rename every later row.
    if (token === "%#" || token === "%$") return token;
    return show(literalValue(items[next++]), token === "%j");
  });
  const fields = objectFields(unwrap(items[0]));
  if (fields)
    title = title.replace(/\$([$\w]+(?:\.[$\w]+)*)/g, (_, path: string) => {
      const [head, ...rest] = path.split(".");
      let value = literalValue(fields.get(head!));
      for (const key of rest)
        value =
          typeof value === "object" && value !== null && Object.hasOwn(value, key)
            ? (value as Record<string, unknown>)[key]
            : unresolved;
      return show(value);
    });
  return sentence && !failed ? title : undefined;
}

/** One `it`/`test` case or `describe` suite: its retained titles and the witness lines covering it. */
export interface TestCase {
  readonly titles: ReadonlyArray<string>;
  readonly witnesses: ReadonlyArray<string>;
  readonly suite: boolean;
  readonly line: number;
  /** The source offset of the title literal's opening quote: the landing rewrites its id there. */
  readonly titleStart: number;
  /** The first titles of the suites it is declared in, outermost first. */
  readonly within: ReadonlyArray<string>;
}

const witnessPrefix = /^\s*witness: /u;

/** The test function a callee's root identifier stands for. */
function rootName(value: unknown, names: ReadonlyMap<string, string>): string | undefined {
  const node = record(value);
  if (node?.type === "Identifier") return names.get(String(node.name));
  if (node?.type === "MemberExpression") return rootName(node.object, names);
  if (node?.type === "CallExpression") return rootName(node.callee, names);
  if (node?.type === "TaggedTemplateExpression") return rootName(node.tag, names);
  return undefined;
}

export function collectTestCases(source: string, file: string): TestCase[] {
  const { program, comments, errors } = parseSync(file, source);
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const names = testNames(program);
  const lineStarts = [0];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1))
    lineStarts.push(index + 1);
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  // A witness sits in the block of whole-line comments directly above its call.
  const commentLines = new Map<number, string>();
  for (const comment of comments) {
    const line = lineOf(comment.start);
    if (comment.type === "Line" && !source.slice(lineStarts[line], comment.start).trim())
      commentLines.set(line, comment.value);
  }
  const witnessesAbove = (offset: number): string[] => {
    const found: string[] = [];
    for (let line = lineOf(offset) - 1; commentLines.has(line); line--) {
      const text = commentLines.get(line)!;
      if (witnessPrefix.test(text)) found.unshift(text.replace(witnessPrefix, "").trimEnd());
    }
    return found;
  };
  const walk = (value: unknown, enter: (node: Record<string, unknown>) => void): void => {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, enter);
      return;
    }
    const node = record(value);
    if (!node) return;
    enter(node);
    for (const child of Object.values(node)) walk(child, enter);
  };
  // Tables named once in the file resolve to their literal rows; a reused name stays ambiguous.
  const tables = new Map<string, unknown>();
  walk(program, (node) => {
    const id = record(node.id);
    if (node.type !== "VariableDeclarator" || id?.type !== "Identifier") return;
    const name = String(id.name);
    tables.set(name, tables.has(name) ? undefined : unwrap(node.init));
  });
  const rows = (table: unknown): unknown[] => {
    let node = unwrap(table);
    if (node?.type === "Identifier") node = record(tables.get(String(node.name)));
    return node?.type === "ArrayExpression" && Array.isArray(node.elements) ? node.elements : [];
  };
  const cases: TestCase[] = [];
  // A describe table's witness covers every case declared inside it.
  const visit = (
    value: unknown,
    inherited: ReadonlyArray<string>,
    within: ReadonlyArray<string>,
  ): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, inherited, within);
      return;
    }
    const node = record(value);
    if (!node) return;
    let scope = inherited;
    let suites = within;
    const titleNode =
      node.type === "CallExpression" &&
      testCallee(node.callee, names) &&
      !curriedModifier(node.callee, names) &&
      Array.isArray(node.arguments)
        ? unwrap(node.arguments[0])
        : undefined;
    const title = stringValue(titleNode);
    if (title !== undefined) {
      const titles = [title];
      const table = record(node.callee);
      const kind = memberName(table?.callee);
      const parameterized = table?.type === "CallExpression" && (kind === "each" || kind === "for");
      if (parameterized)
        for (const row of rows(Array.isArray(table.arguments) ? table.arguments[0] : undefined)) {
          const text = rowTitle(title, row, kind === "each");
          if (text !== undefined) titles.push(text);
        }
      const own = witnessesAbove(Number(node.start));
      // `it.layer(L)("title", (it) => …)` groups its cases like a `describe`.
      const suite = rootName(node.callee, names) === "describe" || kind === "layer";
      cases.push({
        titles,
        witnesses: [...own, ...inherited],
        suite,
        line: lineOf(Number(node.start)) + 1,
        titleStart: Number(titleNode?.start),
        within,
      });
      if (suite && parameterized) scope = [...own, ...inherited];
      if (suite) suites = [...within, title];
    }
    for (const child of Object.values(node)) visit(child, scope, suites);
  };
  visit(program, [], []);
  return cases;
}

function walk(value: unknown, enter: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) walk(child, enter);
    return;
  }
  const node = record(value);
  if (!node) return;
  enter(node);
  for (const child of Object.values(node)) walk(child, enter);
}

function lineOf(source: string): (offset: number) => number {
  const starts = [0];
  for (let index = source.indexOf("\n"); index >= 0; index = source.indexOf("\n", index + 1))
    starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

function propertyName(node: Record<string, unknown>): string | undefined {
  const property = record(node.property);
  const name = node.computed ? property?.value : property?.name;
  return typeof name === "string" ? name : undefined;
}

function rootIdentifier(value: unknown): string | undefined {
  const node = record(value);
  if (node?.type === "Identifier") return String(node.name);
  if (node?.type === "MemberExpression") return rootIdentifier(node.object);
  if (node?.type === "CallExpression") return rootIdentifier(node.callee);
  return undefined;
}

/** `it` itself or a member chain on it (`it.effect`), never a curried call such as `it.each(t)`. */
function itCallee(value: unknown): boolean {
  const node = record(value);
  if (node?.type === "Identifier") return node.name === "it";
  if (node?.type !== "MemberExpression") return false;
  const name = propertyName(node);
  return !(name && bannedModifiers.it!.includes(name)) && itCallee(node.object);
}

/**
 * `it.each`, `it.skip`, `test(`, `describe.only` and the like: forms a unit file never uses; and
 * every `it(` call the collector found no literal title for (a variable or template title, a call
 * inside a loop), since each such call is a case with no sentence.
 */
function bannedForms(
  program: unknown,
  at: (offset: number) => number,
  file: string,
  caseLines: ReadonlySet<number>,
): Problem[] {
  const problems: Problem[] = [];
  walk(program, (node) => {
    if (node.type === "CallExpression" && rootIdentifier(node.callee) === "test")
      problems.push({ file, line: at(Number(node.start)), what: "uses test(; cases are it(" });
    if (
      node.type === "CallExpression" &&
      itCallee(node.callee) &&
      !caseLines.has(at(Number(node.start)))
    )
      problems.push({
        file,
        line: at(Number(node.start)),
        what: "title is not a literal `<ID>: <sentence>`",
      });
    if (node.type !== "MemberExpression") return;
    const root = rootIdentifier(node.object);
    const name = propertyName(node);
    if (root && name && bannedModifiers[root]?.includes(name))
      problems.push({ file, line: at(Number(node.start)), what: `uses ${root}.${name}` });
  });
  return problems;
}

const testHelper = (path: string): boolean =>
  /\/(?:__fixtures__|testing|test)\//u.test(`/${path}`) || /\.(?:fixture|testing)\.ts$/u.test(path);

const testFile = (path: string): boolean =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) || testHelper(path);

function resolveRelative(root: string, from: string, specifier: string): string | undefined {
  const base = NodePath.posix.join(NodePath.posix.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    const full = NodePath.join(root, candidate);
    if (NodeFS.existsSync(full) && NodeFS.statSync(full).isFile()) return candidate;
  }
  return undefined;
}

/** The modules a file imports, with the line of each import and whether it names `vi`. */
function imports(program: unknown, at: (offset: number) => number) {
  const found: Array<{ readonly source: string; readonly line: number; readonly vi: boolean }> = [];
  walk(program, (node) => {
    const source = record(node.source);
    if (
      ![
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
      ].includes(String(node.type)) ||
      typeof source?.value !== "string"
    )
      return;
    const specifiers = Array.isArray(node.specifiers) ? node.specifiers.map(record) : [];
    const vi = specifiers.some(
      (specifier) =>
        record(specifier?.local)?.name === "vi" ||
        record(specifier?.imported)?.name === "vi" ||
        record(specifier?.imported)?.value === "vi" ||
        record(specifier?.exported)?.name === "vi",
    );
    found.push({ source: source.value, line: at(Number(node.start)), vi });
  });
  return found;
}

/** Admission of a unit file and every test helper it reaches through relative imports. */
function admission(root: string, unitFile: string): Problem[] {
  const problems: Problem[] = [];
  const queue = [unitFile];
  const visited = new Set(queue);
  while (queue.length) {
    const file = queue.shift()!;
    const reached = file === unitFile ? "" : ` (reached from ${unitFile})`;
    const source = NodeFS.readFileSync(NodePath.join(root, file), "utf8");
    const { program, errors } = parseSync(file, source);
    if (errors.length) {
      problems.push({ file, line: 1, what: `does not parse: ${errors[0]!.message}${reached}` });
      continue;
    }
    const at = lineOf(source);
    for (const entry of imports(program, at)) {
      if (entry.vi) problems.push({ file, line: entry.line, what: `imports vi${reached}` });
      const module = entry.source.replace(/^node:/u, "");
      if (bannedModules.has(module) || module.startsWith("@testing-library/"))
        problems.push({ file, line: entry.line, what: `imports ${entry.source}${reached}` });
      if (!entry.source.startsWith(".")) continue;
      const helper = resolveRelative(root, file, entry.source);
      if (helper && testHelper(helper) && !visited.has(helper)) {
        visited.add(helper);
        queue.push(helper);
      }
    }
    const lines = source.split("\n");
    lines.forEach((text, index) => {
      for (const [pattern, name] of bannedText)
        if (pattern.test(text))
          problems.push({ file, line: index + 1, what: `uses ${name}${reached}` });
    });
  }
  return problems;
}

function witness(root: string, file: string, line: number, text: string): Problem[] {
  const parsed = parseWitness(text);
  if (!parsed) return [{ file, line, what: "witness is not `<product file> | <old> → <new>`" }];
  const product = parsed.owner;
  const full = NodePath.join(root, product);
  if (!NodeFS.existsSync(full) || !NodeFS.statSync(full).isFile())
    return [{ file, line, what: `witness file ${product} does not exist` }];
  if (testFile(product)) return [{ file, line, what: `witness file ${product} is a test file` }];
  if (!parsed.old) return [{ file, line, what: "witness has an empty <old>" }];
  const count = NodeFS.readFileSync(full, "utf8").split(parsed.old).length - 1;
  return count === 1
    ? []
    : [{ file, line, what: `witness <old> occurs ${count} times in ${product}, not once` }];
}

/** Cases of one unit against its list: one case per id, verbatim titles, a witness above each. */
function mapping(root: string, dir: string, list: SentenceList, files: ReadonlyArray<string>) {
  const problems: Problem[] = [];
  const listed = new Map(list.sentences.map((entry) => [entry.id, entry]));
  const cases = new Map<string, number>();
  for (const file of files) {
    const source = NodeFS.readFileSync(NodePath.join(root, file), "utf8");
    let collected;
    try {
      collected = collectTestCases(source, file);
    } catch (error) {
      problems.push({ file, line: 1, what: `does not parse: ${String(error)}` });
      continue;
    }
    const at = lineOf(source);
    const caseLines = new Set(collected.filter((entry) => !entry.suite).map((entry) => entry.line));
    problems.push(...bannedForms(parseSync(file, source).program, at, file, caseLines));
    const lines = source.split("\n");
    for (const testCase of collected) {
      if (testCase.suite) continue;
      const title = testCase.titles[0] ?? "";
      const match = caseTitle.exec(title);
      const entry = match ? listed.get(match[1]!) : undefined;
      if (!match || !entry)
        problems.push({
          file,
          line: testCase.line,
          what: `title names no id listed in ${dir}/${LIST}: ${title}`,
        });
      else {
        cases.set(entry.id, (cases.get(entry.id) ?? 0) + 1);
        if (match[2] !== entry.sentence)
          problems.push({
            file,
            line: testCase.line,
            what: `title's sentence differs from ${entry.id} — ${entry.sentence}`,
          });
      }
      const above = witnessLine.exec(lines[testCase.line - 2] ?? "");
      if (!above || testCase.witnesses.length !== 1)
        problems.push({
          file,
          line: testCase.line,
          what: "needs exactly one `// witness:` line, directly above the case",
        });
      else problems.push(...witness(root, file, testCase.line - 1, above[1]!.trimEnd()));
    }
    problems.push(...admission(root, file));
  }
  const listFile = `${dir === "." ? "" : `${dir}/`}${LIST}`;
  for (const entry of list.sentences) {
    const count = cases.get(entry.id) ?? 0;
    if (count !== 1)
      problems.push({
        file: listFile,
        line: entry.line,
        what: count ? `${entry.id} has ${count} cases, not one` : `${entry.id} has no case`,
      });
  }
  return problems;
}

/** The list's differences against the base list, each with its id, and the one delta that fails: a reused id. */
function delta(base: SentenceList | undefined, now: SentenceList, listFile: string) {
  const lines: string[] = [];
  const ids: string[] = [];
  const problems: Problem[] = [];
  const before = new Map((base?.sentences ?? []).map((entry) => [entry.id, entry]));
  const after = new Map(now.sentences.map((entry) => [entry.id, entry]));
  for (const [id, entry] of before)
    if (!after.has(id)) {
      lines.push(`retired ${id} — ${entry.sentence}`);
      ids.push(id);
    }
  for (const [id, entry] of after) {
    const old = before.get(id);
    if (old && old.sentence !== entry.sentence) {
      lines.push(`changed ${id} — ${old.sentence} → ${entry.sentence}`);
      ids.push(id);
    }
    if (old) continue;
    lines.push(`added ${id} — ${entry.sentence}`);
    ids.push(id);
    if (
      base?.next !== undefined &&
      !entry.local &&
      id === `${base.prefix}${entry.number}` &&
      entry.number < base.next
    )
      problems.push({
        file: listFile,
        line: entry.line,
        what: `added ${id} is below the base list's next ${base.prefix}${base.next}: ids are never reused`,
      });
  }
  return { lines, ids, problems };
}

const headText = (list: SentenceList): string =>
  `next: ${list.prefix ?? ""}${list.proposal ? "+" : (list.next ?? "")}`;

/**
 * The branch rule: a branch keeps an existing list's `next:` line as the base has it, writes every
 * sentence it adds as `<PREFIX>+<k>`, and starts a new list `next: <PREFIX>+`; the landing numbers them.
 */
function branchRule(base: SentenceList | undefined, now: SentenceList, listFile: string) {
  const problems: Problem[] = [];
  const problem = (line: number, what: string) => problems.push({ file: listFile, line, what });
  if (base === undefined && !now.proposal && now.prefix !== undefined)
    problem(
      1,
      `a new list starts \`next: ${now.prefix}+\`; the landing picks its prefix and numbers its ids`,
    );
  if (base !== undefined && headText(base) !== headText(now))
    problem(1, `a branch leaves \`${headText(base)}\` as the base has it; the landing writes it`);
  const before = new Set((base?.sentences ?? []).map((entry) => entry.id));
  for (const entry of now.sentences)
    if (!entry.local && !before.has(entry.id))
      problem(
        entry.line,
        `a branch adds \`${now.prefix ?? ""}+<k>\`, not ${entry.id}; the landing numbers it`,
      );
  return problems;
}

function baseList(root: string, ref: string, listFile: string): SentenceList | undefined {
  const result = NodeChildProcess.spawnSync("git", ["show", `${ref}:${listFile}`], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? parseList(result.stdout, listFile) : undefined;
}

const listPath = (dir: string) => (dir === "." ? LIST : `${dir}/${LIST}`);

interface UnitDelta {
  readonly unit: string;
  readonly lines: ReadonlyArray<string>;
  readonly ids: ReadonlyArray<string>;
}

/** Every unit's delta against `base`, removed units included: the one derivation of the delta. */
function unitDeltas(
  root: string,
  base: string,
  lists: ReadonlyArray<{ readonly dir: string; readonly list: SentenceList }>,
  problems: Problem[] = [],
): UnitDelta[] {
  const deltas: UnitDelta[] = [];
  const unitSet = new Set(lists.map((entry) => entry.dir));
  for (const { dir, list } of lists) {
    const file = listPath(dir);
    const before = baseList(root, base, file);
    const change = delta(before, list, file);
    problems.push(...change.problems, ...branchRule(before, list, file));
    if (change.lines.length) deltas.push({ unit: dir, lines: change.lines, ids: change.ids });
  }
  const baseUnits = git(root, ["ls-tree", "-r", "-z", "--name-only", base])
    .split("\0")
    .filter((path) => NodePath.posix.basename(path) === LIST)
    .map(unitDir);
  for (const dir of baseUnits.filter((dir) => !unitSet.has(dir)).toSorted()) {
    const change = delta(baseList(root, base, listPath(dir)), parseList("", listPath(dir)), "");
    if (change.lines.length) deltas.push({ unit: dir, lines: change.lines, ids: change.ids });
  }
  return deltas;
}

/** The ids every unit's list retires, changes or adds between `base` and the tree, with the delta's lines. */
export function sentenceDelta(
  root: string,
  base: string,
): { ids: ReadonlyArray<string>; lines: ReadonlyArray<string> } {
  const lists = readUnits(root).map(({ dir }) => ({
    dir,
    list: parseList(NodeFS.readFileSync(NodePath.join(root, listPath(dir)), "utf8"), listPath(dir)),
  }));
  const deltas = unitDeltas(root, base, lists);
  return {
    ids: deltas.flatMap((change) => change.ids),
    lines: deltas.flatMap((change) => change.lines),
  };
}

/** One id the landing numbered, in its unit. */
export interface NumberedId {
  readonly unit: string;
  readonly from: string;
  readonly to: string;
}

const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

/** The proposal when no list holds it, else it with one letter appended (≤ 4 letters), else with its last letter replaced. */
function freePrefix(proposal: string, held: ReadonlySet<string>): string | undefined {
  return [
    proposal,
    ...(proposal.length < 4 ? letters.map((letter) => `${proposal}${letter}`) : []),
    ...letters.map((letter) => `${proposal.slice(0, -1)}${letter}`),
  ].find((candidate) => !held.has(candidate));
}

/**
 * Numbers the tree's lane-local ids, list by list in path order: a `next: <PREFIX>+` list first
 * gets a prefix no other list holds (`freePrefix`), then each `<PREFIX>+<k>`, in k order, becomes
 * `<PREFIX><next>` counting from the list's `next:` (1 for a new list), in its list line and in its
 * case's title literal, and `next:` is written above the highest id. Only the landing calls it, on a
 * tree the gate passed; it writes the files and returns them with every renaming.
 */
export function numberSentences(root: string): {
  readonly files: ReadonlyArray<string>;
  readonly numbered: ReadonlyArray<NumberedId>;
} {
  const lists = readUnits(root).map((unit) => {
    const file = listPath(unit.dir);
    const text = NodeFS.readFileSync(NodePath.join(root, file), "utf8");
    const problems: Problem[] = [];
    const list = parseList(text, file, problems);
    const first = problems[0];
    if (first) throw new Error(`${file}:${first.line}: ${first.what}`);
    return { unit, file, text, list };
  });
  const held = new Set(
    lists.flatMap(({ list }) => (list.proposal || !list.prefix ? [] : [list.prefix])),
  );
  const files: string[] = [];
  const numbered: NumberedId[] = [];
  for (const { unit, file, text, list } of lists) {
    const locals = list.sentences
      .filter((entry) => entry.local)
      .toSorted((left, right) => left.number - right.number);
    if (!list.proposal && locals.length === 0) continue;
    const prefix = list.proposal ? freePrefix(list.prefix!, held) : list.prefix!;
    if (prefix === undefined) throw new Error(`${file}: no prefix near ${list.prefix} is free`);
    held.add(prefix);
    let next = list.next ?? 1;
    const renamed = new Map(locals.map((entry) => [entry.id, `${prefix}${next++}`]));
    const lines = text.split("\n");
    lines[0] = `next: ${prefix}${next}`;
    for (const entry of locals)
      lines[entry.line - 1] = `- ${renamed.get(entry.id)!} — ${entry.sentence}`;
    NodeFS.writeFileSync(NodePath.join(root, file), lines.join("\n"));
    files.push(file);
    for (const [from, to] of renamed) numbered.push({ unit: unit.dir, from, to });
    const titled = new Set<string>();
    for (const caseFile of unit.files) {
      const source = NodeFS.readFileSync(NodePath.join(root, caseFile), "utf8");
      const edits = collectTestCases(source, caseFile).flatMap((testCase) => {
        const id = testCase.suite ? undefined : caseTitle.exec(testCase.titles[0] ?? "")?.[1];
        const to = id === undefined ? undefined : renamed.get(id);
        if (id === undefined || to === undefined) return [];
        // Past the opening quote the literal reads the title as written: the id comes first.
        const at = testCase.titleStart + 1;
        if (!source.startsWith(`${id}:`, at))
          throw new Error(`${caseFile}:${testCase.line}: the title literal does not start ${id}:`);
        titled.add(id);
        return [{ at, id, to }];
      });
      if (edits.length === 0) continue;
      let rewritten = source;
      for (const edit of edits.toSorted((left, right) => right.at - left.at))
        rewritten = `${rewritten.slice(0, edit.at)}${edit.to}${rewritten.slice(edit.at + edit.id.length)}`;
      NodeFS.writeFileSync(NodePath.join(root, caseFile), rewritten);
      files.push(caseFile);
    }
    const untitled = [...renamed.keys()].filter((id) => !titled.has(id));
    if (untitled.length) throw new Error(`${file}: no case title names ${untitled.join(", ")}`);
  }
  return { files, numbered };
}

function checkSentences(root: string, base?: string) {
  const problems: Problem[] = [];
  const units = readUnits(root);
  const unitSet = new Set(units.map((unit) => unit.dir));
  for (const file of listUnitFiles(root))
    if (!unitSet.has(NodePath.posix.dirname(file)))
      problems.push({ file, line: 1, what: `unit file in a directory without ${LIST}` });
  let sentences = 0;
  const prefixes = new Map<string, string>();
  const lists: Array<{ readonly dir: string; readonly list: SentenceList }> = [];
  for (const { dir, files } of units) {
    const file = listPath(dir);
    const list = parseList(NodeFS.readFileSync(NodePath.join(root, file), "utf8"), file, problems);
    sentences += list.sentences.length;
    // A `next: <PREFIX>+` list's prefix is a proposal: the landing picks a free one.
    if (list.prefix !== undefined && !list.proposal) {
      const other = prefixes.get(list.prefix);
      if (other) problems.push({ file, line: 1, what: `prefix ${list.prefix} is also ${other}'s` });
      else prefixes.set(list.prefix, file);
    }
    problems.push(...mapping(root, dir, list, files));
    lists.push({ dir, list });
  }
  const deltas = base === undefined ? [] : unitDeltas(root, base, lists, problems);
  return { units: units.length, sentences, problems, deltas };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const root = NodePath.resolve(import.meta.dirname, "..");
    let base: string | undefined;
    let listUnits = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--base" && args[index + 1]) base = args[++index];
      else if (args[index] === "units" && !listUnits) listUnits = true;
      else throw new Error("Usage: node scripts/check-sentences.ts [--base <ref>] [units]");
    }
    if (listUnits) {
      for (const { dir } of readUnits(root)) console.log(dir);
      process.exit(0);
    }
    const result = checkSentences(root, base);
    for (const problem of result.problems)
      console.log(`${problem.file}:${problem.line}: ${problem.what}`);
    for (const change of result.deltas) {
      console.log(`delta ${change.unit}:`);
      for (const line of change.lines) console.log(`  ${line}`);
    }
    console.log(
      `sentences: ${result.units} units, ${result.sentences} sentences, ${result.problems.length} problems`,
    );
    process.exit(result.problems.length ? 1 : 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
