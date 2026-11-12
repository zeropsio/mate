#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalJsonInEffect:off -- host Git guard.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync } from "oxc-parser";
import { changedPaths, comparisonBase } from "./gate-changed.ts";
import { decodeGitHubEvent, githubRatchetRevision } from "./lib/github-ratchet.ts";

import { parseWitness, retainedTestFile, witnessOwners } from "./gate-input-scopes.ts";
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

// Curried modifiers wrap the declaration; the title is the outer call's first argument.
function testCallee(value: unknown): boolean {
  const node = record(value);
  if (!node) return false;
  if (node.type === "Identifier") return ["it", "test", "describe"].includes(String(node.name));
  if (memberName(node) !== undefined) return testCallee(node.object);
  if (node.type === "CallExpression" || node.type === "TaggedTemplateExpression")
    return curriedModifier(node.callee ?? node.tag);
  return false;
}

function curriedModifier(value: unknown): boolean {
  const node = record(value);
  return (
    node?.type === "MemberExpression" &&
    ["each", "for", "skipIf", "runIf", "layer"].includes(String(memberName(node))) &&
    testCallee(node.object)
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
  /** The first titles of the suites it is declared in, outermost first. */
  readonly within: ReadonlyArray<string>;
}

const witnessPrefix = /^\s*witness: /u;

function rootName(value: unknown): string | undefined {
  const node = record(value);
  if (node?.type === "Identifier") return String(node.name);
  if (node?.type === "MemberExpression") return rootName(node.object);
  if (node?.type === "CallExpression") return rootName(node.callee);
  if (node?.type === "TaggedTemplateExpression") return rootName(node.tag);
  return undefined;
}

export function collectTestCases(source: string, file: string): TestCase[] {
  const { program, comments, errors } = parseSync(file, source);
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
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
    const title =
      node.type === "CallExpression" && testCallee(node.callee) && !curriedModifier(node.callee)
        ? stringValue(Array.isArray(node.arguments) ? node.arguments[0] : undefined)
        : undefined;
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
      const suite = rootName(node.callee) === "describe";
      cases.push({
        titles,
        witnesses: [...own, ...inherited],
        suite,
        line: lineOf(Number(node.start)) + 1,
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

export function collectTestTitles(source: string, file: string): Set<string> {
  return new Set(collectTestCases(source, file).flatMap((testCase) => testCase.titles));
}

function git(root: string, args: string[]): string {
  const result = NodeChildProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || `git ${args.join(" ")} failed`);
  return result.stdout;
}

/** Non-main pushes protect main's sentences; main pushes and PRs retain their event baseline. */
export function sentenceComparison(root: string, base?: string): string {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true")
    throw new Error("Test sentence guard needs full Git history; fetch with --unshallow.");
  let ref = base ?? "origin/main";
  if (base === undefined && process.env.GITHUB_ACTIONS === "true") {
    const path = process.env.GITHUB_EVENT_PATH;
    if (!path) throw new Error("Test sentence guard needs a GitHub push or PR event baseline.");
    const event = decodeGitHubEvent(NodeFS.readFileSync(path, "utf8"));
    const branch = process.env.GITHUB_REF;
    if (
      event.pull_request !== undefined ||
      !branch?.startsWith("refs/heads/") ||
      branch === "refs/heads/main"
    )
      ref = githubRatchetRevision(event, ref);
  }
  return comparisonBase(root, ref);
}

/** The removal classes of docs/engineering-rules.md §4; `reworded` also needs a replacement case with the same witness. */
export const dropClasses = [
  "copy",
  "duplicate",
  "fake-input",
  "mock",
  "dead",
  "library",
  "trivia",
  "harness",
  "reworded",
] as const;

// Commits up to the merge base of the change that introduced classes approve with a bare title.
export const bareDropsCutoff = "3aadd73c94da2670d69b85d49b374e557060bb9f";

// Owners are product code: a witness on a test, fixture or recording proves nothing about behaviour.
const nonOwnerPath = (path: string): boolean =>
  retainedTestFile.test(path) ||
  /(?:^|\/)(?:__)?(?:fixtures?|recordings?|tests?)(?:__)?\/|\.(?:fixture|recording)s?\.[^/]+$/u.test(
    path,
  );

function witnessProblem(root: string, text: string): string | undefined {
  const witness = parseWitness(text);
  if (!witness || witness.owner.startsWith("/") || witness.owner.split("/").includes(".."))
    return "is not `<owner path> | <old> → <new>` inside the repository";
  const { owner, old, next } = witness;
  if (nonOwnerPath(owner)) return `names ${owner}, a test, fixture or recording path, as its owner`;
  const absolute = NodePath.join(root, owner);
  if (!NodeFS.statSync(absolute, { throwIfNoEntry: false })?.isFile())
    return `names a missing owner ${owner}`;
  if (old === next) return "changes nothing: its old text equals its new text";
  const source = NodeFS.readFileSync(absolute, "utf8");
  let count = 0;
  for (
    let index = old ? source.indexOf(old) : -1;
    index >= 0;
    index = source.indexOf(old, index + 1)
  )
    count++;
  return count === 1 ? undefined : `old text occurs ${count} times in ${owner}, not exactly once`;
}

/** Blob contents by `<revision>:<path>` spec, read in one Git process; missing specs are absent. */
function readBlobs(root: string, specs: ReadonlyArray<string>): Map<string, string> {
  const blobs = new Map<string, string>();
  if (!specs.length) return blobs;
  const result = NodeChildProcess.spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: `${specs.join("\n")}\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString() || "git cat-file failed");
  const output = result.stdout;
  let offset = 0;
  for (const spec of specs) {
    const end = output.indexOf(10, offset);
    const header = output.toString("utf8", offset, end).split(" ");
    offset = end + 1;
    if (header.length !== 3) continue;
    const size = Number(header[2]);
    blobs.set(spec, output.toString("utf8", offset, offset + size));
    offset += size + 1;
  }
  return blobs;
}

const unwitnessed = (cases: ReadonlyArray<TestCase>): number =>
  cases.filter((testCase) => !testCase.suite && !testCase.witnesses.length).length;

const titlesOf = (files: ReadonlyMap<string, ReadonlyArray<TestCase>>): Set<string> =>
  new Set([...files.values()].flat().flatMap((testCase) => testCase.titles));

/** Whether a commit adds a case (a title new against its parent) carrying one of the witness lines. */
function addsWitnessedCase(root: string, commit: string, lines: ReadonlySet<string>): boolean {
  const files = git(root, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "-r",
    "--name-only",
    "--no-renames",
    "-z",
    commit,
  ])
    .split("\0")
    .filter((path) => retainedTestFile.test(path));
  const blobs = readBlobs(
    root,
    files.flatMap((path) => [`${commit}^:${path}`, `${commit}:${path}`]),
  );
  const at = (revision: string) =>
    new Map(
      files.flatMap((path) => {
        const source = blobs.get(`${revision}:${path}`);
        return source === undefined ? [] : [[path, collectTestCases(source, path)] as const];
      }),
    );
  const parent = titlesOf(at(`${commit}^`));
  return [...at(commit).values()]
    .flat()
    .some(
      (testCase) =>
        !testCase.suite &&
        testCase.titles.some((title) => !parent.has(title)) &&
        testCase.witnesses.some((line) => lines.has(line)),
    );
}

// The Import zone carries upstream's tests byte for byte (imported.lock proves it), so it can
// neither carry witness lines nor keep a sentence upstream dropped: a re-import owns its tests.
function importedRoots(root: string): string[] {
  const lock = NodePath.join(root, "imported.lock");
  if (!NodeFS.existsSync(lock)) return [];
  const parsed: unknown = JSON.parse(NodeFS.readFileSync(lock, "utf8"));
  const paths =
    typeof parsed === "object" && parsed !== null && "paths" in parsed ? parsed.paths : undefined;
  return typeof paths === "object" && paths !== null ? Object.keys(paths) : [];
}

export interface SentenceReport {
  /** Removed titles no trailer approves. */
  readonly dropped: string[];
  /** Witness rule failures, one line each. */
  readonly problems: string[];
}

export function checkTestSentences(
  root: string,
  base?: string,
  bareCutoff: string = bareDropsCutoff,
): SentenceReport {
  const ancestor = sentenceComparison(root, base);
  const touched = changedPaths(root, ancestor);
  const imported = importedRoots(root);
  // `.repos/` holds vendored references, synced whole from their own repositories.
  const paths = touched.filter(
    (path) =>
      retainedTestFile.test(path) &&
      !path.startsWith(".repos/") &&
      !imported.some((dir) => path.startsWith(`${dir}/`)),
  );
  const baseSources = readBlobs(
    root,
    paths.map((path) => `${ancestor}:${path}`),
  );
  const before = new Map<string, TestCase[]>();
  const after = new Map<string, TestCase[]>();
  for (const path of paths) {
    const source = baseSources.get(`${ancestor}:${path}`);
    if (source !== undefined) before.set(path, collectTestCases(source, path));
    const current = NodePath.join(root, path);
    if (NodeFS.existsSync(current))
      after.set(path, collectTestCases(NodeFS.readFileSync(current, "utf8"), path));
  }
  const beforeTitles = titlesOf(before);
  const afterTitles = titlesOf(after);
  const problems: string[] = [];
  for (const [path, cases] of after)
    for (const testCase of cases)
      if (
        !testCase.suite &&
        !testCase.witnesses.length &&
        testCase.titles.some((title) => !beforeTitles.has(title))
      )
        problems.push(
          `${path}:${testCase.line}: added case "${testCase.titles[0]}" has no \`// witness: <owner path> | <old> → <new>\` line directly above it.`,
        );
  // Touched tests check every witness; untouched tests check the ones naming a touched owner.
  const touchedOwners = new Set(touched);
  const checked = new Map(after);
  for (const [path, owners] of witnessOwners(root))
    if (!checked.has(path) && [...owners].some((owner) => touchedOwners.has(owner)))
      checked.set(
        path,
        collectTestCases(NodeFS.readFileSync(NodePath.join(root, path), "utf8"), path),
      );
  for (const [path, cases] of checked) {
    const seen = new Set<string>();
    for (const testCase of cases)
      for (const text of testCase.witnesses) {
        const owner = parseWitness(text)?.owner;
        if (seen.has(text) || (!after.has(path) && (!owner || !touchedOwners.has(owner)))) continue;
        seen.add(text);
        const problem = witnessProblem(root, text);
        if (problem) problems.push(`${path}:${testCase.line}: witness "${text}" ${problem}.`);
      }
  }
  const baseCount = unwitnessed([...before.values()].flat());
  const headCount = unwitnessed([...after.values()].flat());
  if (headCount > baseCount)
    problems.push(
      `Cases without a witness grew from ${baseCount} at the base to ${headCount} in the touched test files; witness each case.`,
    );

  const approvals = new Map<string, { commit: string; kind: string | undefined }[]>();
  const droppedFiles = new Set<string>();
  // Git finds the trailer block; the bare format preserves exact text rather than normalizing it.
  for (const entry of git(root, ["log", "--format=%x1e%H%n%(trailers)", `${ancestor}..HEAD`])
    .split("\x1e")
    .slice(1)) {
    const [commit = "", ...lines] = entry.split("\n");
    const approve = (title: string, kind: string | undefined) =>
      approvals.set(title, [...(approvals.get(title) ?? []), { commit, kind }]);
    for (const line of lines) {
      if (line.startsWith("Drops-test-file: "))
        droppedFiles.add(line.slice("Drops-test-file: ".length));
      if (!line.startsWith("Drops-test: ")) continue;
      const value = line.slice("Drops-test: ".length);
      // Titles may contain ` — `; the class is the fixed word after the last one.
      const classed = /^(.*) — ([a-z-]+)$/u.exec(value);
      if (classed && (dropClasses as ReadonlyArray<string>).includes(classed[2]!))
        approve(classed[1]!, classed[2]);
      approve(value, undefined);
    }
  }
  const legacy = new Map<string, boolean>();
  const beforeBare = (commit: string): boolean => {
    if (!legacy.has(commit))
      legacy.set(
        commit,
        NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", commit, bareCutoff], {
          cwd: root,
        }).status === 0,
      );
    return legacy.get(commit)!;
  };
  const approved = (title: string): boolean => {
    const files = [...before].filter(([, cases]) =>
      cases.some((testCase) => testCase.titles.includes(title)),
    );
    if (files.some(([path]) => droppedFiles.has(path) && !after.has(path))) return true;
    const witnesses = new Set(
      files.flatMap(([, cases]) =>
        cases
          .filter((testCase) => testCase.titles.includes(title))
          .flatMap((testCase) => testCase.witnesses),
      ),
    );
    const rewordings = (approvals.get(title) ?? []).filter(({ kind }) => kind === "reworded");
    if (
      (approvals.get(title) ?? []).some(({ commit, kind }) =>
        kind === undefined ? beforeBare(commit) : kind !== "reworded",
      )
    )
      return true;
    if (rewordings.some(({ commit }) => addsWitnessedCase(root, commit, witnesses))) return true;
    for (const { commit } of rewordings)
      problems.push(
        `Drops-test: ${title} — reworded needs commit ${commit.slice(0, 12)} to add a case carrying the dropped case's witness line.`,
      );
    return false;
  };
  const dropped = [...beforeTitles].filter((title) => !afterTitles.has(title) && !approved(title));
  return { dropped: dropped.sort(), problems };
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--base" || !args[1]))
      throw new Error("Usage: node scripts/check-test-sentences.ts [--base <ref>]");
    const { dropped, problems } = checkTestSentences(
      NodePath.resolve(import.meta.dirname, ".."),
      args[1],
    );
    for (const title of dropped)
      console.error(
        `Dropped test sentence: ${title}\nNeeds Drops-test: ${title} — <class> (${dropClasses.join(", ")}), or Drops-test-file: <path> deleting its file`,
      );
    for (const problem of problems) console.error(problem);
    if (dropped.length || problems.length) process.exitCode = 1;
    else
      console.log(
        "Test sentences retained (or approved by Drops-test trailers); added cases carry witnesses that apply.",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
