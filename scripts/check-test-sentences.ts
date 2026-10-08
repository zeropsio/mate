#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- host Git guard.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync } from "oxc-parser";
import { changedPaths, comparisonBase } from "./gate-changed.ts";

const testFile = /(?:\.test\.tsx?|\.scenario\.ts)$/u;
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

export function collectTestTitles(source: string, file: string): Set<string> {
  const { program, errors } = parseSync(file, source);
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const titles = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const node = record(value);
    if (!node) return;
    if (
      node.type === "CallExpression" &&
      testCallee(node.callee) &&
      !curriedModifier(node.callee)
    ) {
      const title = record(Array.isArray(node.arguments) ? node.arguments[0] : undefined);
      if (title?.type === "Literal" && typeof title.value === "string") titles.add(title.value);
      if (
        title?.type === "TemplateLiteral" &&
        Array.isArray(title.expressions) &&
        title.expressions.length === 0 &&
        Array.isArray(title.quasis)
      ) {
        const text = record(record(title.quasis[0])?.value)?.cooked;
        if (typeof text === "string") titles.add(text);
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(program);
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

/** CI's push baseline covers the entire push; origin/main can already be HEAD. */
export function sentenceComparison(root: string, base?: string): string {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true")
    throw new Error("Test sentence guard needs full Git history; fetch with --unshallow.");
  let ref = base ?? "origin/main";
  if (base === undefined && process.env.GITHUB_ACTIONS === "true") {
    const path = process.env.GITHUB_EVENT_PATH;
    if (!path) throw new Error("Test sentence guard needs a GitHub push or PR event baseline.");
    const event = record(JSON.parse(NodeFS.readFileSync(path, "utf8")));
    const revision = record(record(event?.pull_request)?.base)?.sha ?? event?.before;
    if (typeof revision !== "string" || !/^[a-f0-9]{40}$/u.test(revision) || /^0+$/u.test(revision))
      throw new Error("Test sentence guard needs a valid previous main or PR base commit.");
    ref = revision;
  }
  return comparisonBase(root, ref);
}

export function checkTestSentences(root: string, base?: string): string[] {
  const ancestor = sentenceComparison(root, base);
  const paths = changedPaths(root, ancestor).filter((path) => testFile.test(path));
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
