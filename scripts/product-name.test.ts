// The server and the shared packages name the product Zerops Mate, never
// "T3 Code": what an agent is told about where it runs, and what a person
// reads in a provider status, a compatibility advisory or a CLI description.
// Upstream ports bring the old name back with every intake, so this scans
// every string, template and JSX text literal there. Comments are not copy
// and are not scanned; neither are identifiers such as the Codex originator
// `t3code_desktop` or the Grok OAuth referrer `t3code`, which name the client
// to a vendor and do not spell the product name.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { parseSync } from "oxc-parser";

const repoRootUrl = new URL("..", import.meta.url);
const SCANNED_ROOTS = [
  "apps/server/src",
  "packages/contracts/src",
  "packages/shared/src",
  "packages/client-runtime/src",
];
// The vocabulary table spells the old name in order to ban it (design-system R4).
const VOCABULARY_TABLE = "packages/shared/src/legacyVocabulary.ts";
const OLD_NAME = /\bT3 Code\b/u;

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly value?: unknown;
}

function literalText(node: AstNode): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "JSXText" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateElement") {
    const value = node.value as { readonly cooked?: string | null; readonly raw: string };
    return value.cooked ?? value.raw;
  }
  return undefined;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

export function collectOldNameLiterals(source: string, file: string): ReadonlyArray<string> {
  const { program, errors } = parseSync(file, source);
  if (errors.length > 0) return [`${file}: does not parse (${errors[0]!.message})`];
  const findings: Array<string> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isAstNode(value)) return;
    const text = literalText(value);
    if (text !== undefined && OLD_NAME.test(text)) {
      const line = source.slice(0, value.start).split("\n").length;
      findings.push(`${file}:${line}: ${text.trim().split("\n")[0]}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "parent") visit(child);
    }
  };
  visit(program);
  return findings;
}

function collectSourceFiles(
  dir: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files: Array<string> = [];
    for (const entry of yield* fs.readDirectory(dir)) {
      const entryPath = path.join(dir, entry);
      const stat = yield* fs.stat(entryPath);
      if (stat.type === "Directory") {
        files.push(...(yield* collectSourceFiles(entryPath)));
      } else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
        files.push(entryPath);
      }
    }
    return files;
  });
}

describe("collectOldNameLiterals", () => {
  const cases: ReadonlyArray<readonly [string, string, number]> = [
    ["a string literal", `const message = "Codex is disabled in T3 Code settings.";`, 1],
    ["a template's static part", "const title = `T3 Code ${operation}`;", 1],
    ["a template without substitutions", "const prompt = `you are running in T3 Code`;", 1],
    ["JSX text", "const view = <p>Open T3 Code</p>;", 1],
    ["a line comment", "// T3 Code's own OTLP variables name no signal", 0],
    ["a block comment", "/** What T3 Code exports with. */\nconst x = 1;", 0],
    ["a vendor identifier", `const clientInfo = { name: "t3code_desktop" };`, 0],
    ["the product's own name", `const message = "Codex is disabled in settings.";`, 0],
  ];
  for (const [name, source, expected] of cases) {
    it(`${expected === 0 ? "ignores" : "reports"} ${name}`, () => {
      assert.lengthOf(collectOldNameLiterals(source, "sample.tsx"), expected);
    });
  }
});

it.effect("no server or shared-package literal names the product T3 Code", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(repoRootUrl);
    const findings: Array<string> = [];
    for (const scanned of SCANNED_ROOTS) {
      for (const file of yield* collectSourceFiles(path.join(root, scanned))) {
        const relative = path.relative(root, file);
        if (relative === VOCABULARY_TABLE) continue;
        findings.push(...collectOldNameLiterals(yield* fs.readFileString(file), relative));
      }
    }
    assert.deepStrictEqual(findings, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
