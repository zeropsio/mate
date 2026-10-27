#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- host Git guard.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync } from "oxc-parser";
import { changedPaths, comparisonBase } from "./gate-changed.ts";
import { decodeGitHubEvent, githubRatchetRevision } from "./lib/github-ratchet.ts";

import { retainedTestFile } from "./gate-input-scopes.ts";
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

export function collectTestTitles(source: string, file: string): Set<string> {
  const { program, errors } = parseSync(file, source);
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const titles = new Set<string>();
  // Tables named once in the file resolve to their literal rows; a reused name stays ambiguous.
  const tables = new Map<string, unknown>();
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
  walk(program, (node) => {
    if (node.type !== "CallExpression" || !testCallee(node.callee) || curriedModifier(node.callee))
      return;
    const title = stringValue(Array.isArray(node.arguments) ? node.arguments[0] : undefined);
    if (title === undefined) return;
    titles.add(title);
    const table = record(node.callee);
    const kind = memberName(table?.callee);
    if (table?.type !== "CallExpression" || (kind !== "each" && kind !== "for")) return;
    for (const row of rows(Array.isArray(table.arguments) ? table.arguments[0] : undefined)) {
      const text = rowTitle(title, row, kind === "each");
      if (text !== undefined) titles.add(text);
    }
  });
  return titles;
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

export function checkTestSentences(root: string, base?: string): string[] {
  const ancestor = sentenceComparison(root, base);
  const paths = changedPaths(root, ancestor).filter((path) => retainedTestFile.test(path));
  if (!paths.length) return [];
  const baselineFiles = new Set(
    git(root, ["ls-tree", "-r", "--name-only", "-z", ancestor, "--", ...paths]).split("\0"),
  );
  const before = new Set<string>();
  const after = new Set<string>();
  for (const path of paths) {
    if (baselineFiles.has(path))
      for (const title of collectTestTitles(git(root, ["show", `${ancestor}:${path}`]), path))
        before.add(title);
    const current = NodePath.join(root, path);
    if (NodeFS.existsSync(current))
      for (const title of collectTestTitles(NodeFS.readFileSync(current, "utf8"), path))
        after.add(title);
  }
  const allowed = new Set<string>();
  // Git finds the trailer block; the bare format preserves exact text rather than normalizing it.
  for (const line of git(root, ["log", "--format=%(trailers)", `${ancestor}..HEAD`]).split("\n"))
    if (line.startsWith("Drops-test: ")) allowed.add(line.slice("Drops-test: ".length));
  return [...before].filter((title) => !after.has(title) && !allowed.has(title)).sort();
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--base" || !args[1]))
      throw new Error("Usage: node scripts/check-test-sentences.ts [--base <ref>]");
    const dropped = checkTestSentences(NodePath.resolve(import.meta.dirname, ".."), args[1]);
    for (const title of dropped)
      console.error(`Dropped test sentence: ${title}\nNeeds Drops-test: ${title}`);
    if (dropped.length) process.exitCode = 1;
    else console.log("Test sentences retained (or approved by Drops-test trailers).");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
