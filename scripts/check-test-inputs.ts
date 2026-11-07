#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- host Git guard.
/**
 * Wire-shaped test input comes from a recording (`recorded(name, edit?)` from
 * `@t3tools/test-recordings`), not from a literal a test types as a contract: in test and
 * `__fixtures__` files, `as T`, `as unknown as T`, `satisfies T` and a `: T` annotation on an object
 * literal, where T is imported from a contract module below, may only grow fewer than at the base.
 * The count is computed from the files the change touches; there is no ledger.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseSync, Visitor } from "oxc-parser";
import { sentenceComparison } from "./check-test-sentences.ts";
import { testInputFile } from "./gate-input-scopes.ts";

/** Modules whose types are wire shapes: `@t3tools/contracts`, its subpaths, and these. */
export const contractModules = new Set(["@t3tools/shared/hqStream"]);

const contractModule = (source: string): boolean =>
  source === "@t3tools/contracts" ||
  source.startsWith("@t3tools/contracts/") ||
  contractModules.has(source);

export interface ContractInput {
  readonly line: number;
  readonly column: number;
  readonly form: "as" | "satisfies" | "annotation";
}

interface Node {
  readonly type: string;
  readonly start: number;
  readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

/** Every place `source` types a value as a contract type it imports. */
export function findContractInputs(source: string, file: string): ContractInput[] {
  const { program, errors } = parseSync(file, source);
  if (errors.length) throw new Error(`${file}: ${errors[0]!.message}`);
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of program.body)
    if (statement.type === "ImportDeclaration" && contractModule(statement.source.value))
      for (const specifier of statement.specifiers)
        (specifier.type === "ImportNamespaceSpecifier" ? namespaces : names).add(
          specifier.local.name,
        );
  if (!names.size && !namespaces.size) return [];
  const leftmost = (name: Node): string | undefined =>
    name.type === "Identifier"
      ? String(name.name)
      : isNode(name.left)
        ? leftmost(name.left)
        : undefined;
  // Whether a type names a contract type anywhere in it (`T`, `T[]`, `Partial<T>`, `NS.T`).
  const namesContract = (type: unknown): boolean => {
    if (Array.isArray(type)) return type.some(namesContract);
    if (!isNode(type)) return false;
    if (type.type === "TSTypeReference" && isNode(type.typeName)) {
      const head = leftmost(type.typeName);
      if (
        head !== undefined &&
        (type.typeName.type === "Identifier" ? names.has(head) : namespaces.has(head))
      )
        return true;
    }
    return Object.entries(type).some(([key, value]) => key !== "type" && namesContract(value));
  };
  const inputs: ContractInput[] = [];
  const at = (offset: number, form: ContractInput["form"]) => {
    const before = source.slice(0, offset).split("\n");
    inputs.push({ line: before.length, column: before.at(-1)!.length + 1, form });
  };
  const unwrapped = (expression: unknown): unknown =>
    isNode(expression) && expression.type === "ParenthesizedExpression"
      ? unwrapped(expression.expression)
      : expression;
  new Visitor({
    TSAsExpression(node) {
      if (namesContract(node.typeAnnotation)) at(node.start, "as");
    },
    TSSatisfiesExpression(node) {
      if (namesContract(node.typeAnnotation)) at(node.start, "satisfies");
    },
    VariableDeclarator(node) {
      const init = unwrapped(node.init);
      if (
        isNode(init) &&
        init.type === "ObjectExpression" &&
        node.id.type === "Identifier" &&
        namesContract(node.id.typeAnnotation)
      )
        at(node.start, "annotation");
    },
  }).visit(program);
  return inputs.sort((a, b) => a.line - b.line || a.column - b.column);
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

/** Contract-typed test input in the working tree against `base`, over the files that differ. */
export function checkTestInputs(root: string, { base }: { readonly base?: string } = {}): string[] {
  const comparison = sentenceComparison(root, base);
  const changed = [
    ...new Set([
      ...git(root, ["diff", "--name-only", "--no-renames", "-z", comparison]).split("\0"),
      ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
    ]),
  ]
    .filter(testInputFile)
    .sort();
  const baseFiles = new Set(
    git(root, ["ls-tree", "-r", "--name-only", "-z", comparison, "--", ...changed]).split("\0"),
  );
  let before = 0;
  let after = 0;
  const grown: string[] = [];
  for (const file of changed) {
    const path = NodePath.join(root, file);
    const then = baseFiles.has(file)
      ? findContractInputs(git(root, ["show", `${comparison}:${file}`]), file).length
      : 0;
    const now = NodeFS.existsSync(path)
      ? findContractInputs(NodeFS.readFileSync(path, "utf8"), file)
      : [];
    before += then;
    after += now.length;
    if (now.length > then)
      grown.push(...now.map((input) => `${file}:${input.line}:${input.column} (${input.form})`));
  }
  if (after <= before) return [];
  return [
    `Test input typed as a contract grew from ${before} to ${after} in the changed files; build it with recorded(name, edit?) from @t3tools/test-recordings instead.`,
    ...grown.map((site) => `  ${site}`),
  ];
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const base = args[0] === "--base" ? args[1] : undefined;
    if ((args.length !== 0 && args.length !== 2) || (args.length === 2 && !base))
      throw new Error("Usage: node scripts/check-test-inputs.ts [--base <ref>]");
    const problems = checkTestInputs(
      NodePath.resolve(import.meta.dirname, ".."),
      base === undefined ? {} : { base },
    );
    for (const problem of problems) console.error(problem);
    if (problems.length) process.exitCode = 1;
    else console.log("Test input typed as a contract did not grow against the base.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
