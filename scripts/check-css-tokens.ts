#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off -- This host CLI resolves repo paths before Effect runs.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CSS_KIND,
  cssDeclarationFingerprint,
  formatReconcileReport,
  loadCompletedPhases,
  loadExceptionLedger,
  reconcileExceptions,
  type ExceptionFinding,
} from "@t3tools/oxlint-plugin-t3code/exceptions";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command } from "effect/unstable/cli";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  collectCssSources,
  isGeneratedCssSource,
  type CollectCssSourcesOptions,
} from "./cssSources.ts";

const RULE_NAME = "no-theme-escape-hatches";
const RAW_COLOR_PATTERN =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/u;
const DEFAULT_REPO_ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_EXCEPTION_DIRECTORY = NodePath.join(
  DEFAULT_REPO_ROOT,
  "oxlint-plugin-t3code",
  "exceptions",
);

/** One declaration fingerprint before its ledger status is attached. */
export interface CssTokenFinding {
  readonly path: string;
  readonly kind: typeof CSS_KIND;
  readonly fingerprint: string;
}

/** The report and exit status returned by both tests and the Effect CLI. */
export interface CssTokenCheckResult {
  readonly report: string;
  readonly problemCount: number;
  readonly exitCode: 0 | 1;
}

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//gu, " ");

const blockHeader = (text: string): string => stripComments(text).trim();

const declarationColon = (text: string): number => {
  let parentheses = 0;
  let brackets = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote !== undefined) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === ":" && parentheses === 0 && brackets === 0) return index;
  }
  return -1;
};

const selectorList = (selector: string): ReadonlyArray<string> => {
  const items: Array<string> = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "," && parentheses === 0 && brackets === 0) {
      items.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(selector.slice(start).trim());
  return items;
};

const isRootSelector = (header: string): boolean =>
  selectorList(header).some((selector) => /^:root(?:$|[.#[\]:])/u.test(selector));

const THEME_ID_SELECTOR_PATTERN = /^html\[data-theme-id(?:[^\]]*)\](?::[^\s>+~]+)*$/u;

const isThemeIdBlockSelector = (header: string): boolean => {
  const selector = header.trim();
  if (THEME_ID_SELECTOR_PATTERN.test(selector)) return true;
  const list = /^:is\(([\s\S]*)\)$/u.exec(selector);
  return (
    list !== null &&
    selectorList(list[1]!).every((candidate) => THEME_ID_SELECTOR_PATTERN.test(candidate))
  );
};

const isPaletteSource = (stack: ReadonlyArray<string>): boolean => {
  if (
    stack.some(
      (header) =>
        isRootSelector(header) ||
        /^@theme(?:\s|$)/u.test(header) ||
        /^@layer\s+(?:base|theme)(?:\s|$)/u.test(header),
    )
  ) {
    return true;
  }

  const ownSelector = stack.findLast((header) => !header.startsWith("@"));
  return ownSelector !== undefined && isThemeIdBlockSelector(ownSelector);
};

const declarationFinding = ({
  path,
  stack,
  declaration,
}: {
  readonly path: string;
  readonly stack: ReadonlyArray<string>;
  readonly declaration: string;
}): CssTokenFinding | undefined => {
  const normalized = stripComments(declaration).trim();
  const colon = declarationColon(normalized);
  if (colon < 1) return undefined;

  const property = normalized.slice(0, colon).trim();
  const value = normalized.slice(colon + 1).trim();
  const valueWithoutUrls = value.replace(/\burl\([^)]*\)/giu, "");
  if (!RAW_COLOR_PATTERN.test(valueWithoutUrls)) return undefined;
  if (property.startsWith("--") && isPaletteSource(stack)) return undefined;

  return {
    path,
    kind: CSS_KIND,
    fingerprint: cssDeclarationFingerprint({
      selector: stack.join(" > "),
      property,
      value,
    }),
  };
};

/** Scans declarations while preserving the selector and at-rule ancestor stack. */
export const scanCssSource = ({
  path,
  source,
}: {
  readonly path: string;
  readonly source: string;
}): ReadonlyArray<CssTokenFinding> => {
  if (isGeneratedCssSource(source)) return [];

  const findings: Array<CssTokenFinding> = [];
  const stack: Array<string> = [];
  let segmentStart = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: '"' | "'" | undefined;

  const collectDeclaration = (end: number) => {
    if (stack.length === 0) return;
    const finding = declarationFinding({
      path,
      stack,
      declaration: source.slice(segmentStart, end),
    });
    if (finding !== undefined) findings.push(finding);
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (quote !== undefined) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") {
      parentheses += 1;
      continue;
    }
    if (character === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (character === "[") {
      brackets += 1;
      continue;
    }
    if (character === "]") {
      brackets = Math.max(0, brackets - 1);
      continue;
    }
    if (parentheses !== 0 || brackets !== 0) continue;

    if (character === "{") {
      const header = blockHeader(source.slice(segmentStart, index));
      stack.push(header);
      segmentStart = index + 1;
      continue;
    }
    if (character === ";") {
      collectDeclaration(index);
      segmentStart = index + 1;
      continue;
    }
    if (character === "}") {
      collectDeclaration(index);
      stack.pop();
      segmentStart = index + 1;
    }
  }

  return findings;
};

/** Reconciles pre-scanned CSS declarations against the CSS scope of the shared ledger. */
export const reconcileCssTokenFindings = ({
  directory,
  findings,
}: {
  readonly directory: string;
  readonly findings: ReadonlyArray<CssTokenFinding>;
}): CssTokenCheckResult => {
  const ledger = loadExceptionLedger(RULE_NAME, directory);
  const reconciledFindings: ReadonlyArray<ExceptionFinding> = findings.map((finding) => ({
    ...finding,
    ledgered: ledger.has(finding),
  }));
  const result = reconcileExceptions({
    entries: ledger.entries,
    findings: reconciledFindings,
    completedPhases: loadCompletedPhases(directory),
    scope: "css",
  });
  const problemCount =
    result.unlisted.length + result.dead.length + result.changed.length + result.expired.length;
  return {
    report: formatReconcileReport({ ruleName: RULE_NAME, result }),
    problemCount,
    exitCode: problemCount === 0 ? 0 : 1,
  };
};

/** Walks the web and mobile CSS roots and reconciles every ad-hoc raw-colour declaration. */
export const checkCssTokens = Effect.fn("checkCssTokens")(function* ({
  cwd = DEFAULT_REPO_ROOT,
  directory = DEFAULT_EXCEPTION_DIRECTORY,
  warn,
}: {
  readonly cwd?: string;
  readonly directory?: string;
  readonly warn?: CollectCssSourcesOptions["warn"];
} = {}) {
  const sources = yield* collectCssSources({
    repoRoot: cwd,
    ...(warn === undefined ? {} : { warn }),
  });
  const findings = sources.flatMap(scanCssSource);
  return reconcileCssTokenFindings({ directory, findings });
});

export const checkCssTokensCommand = Command.make("check-css-tokens", {}, () =>
  Effect.gen(function* () {
    const result = yield* checkCssTokens();
    yield* Console.log(result.report);
    if (result.exitCode !== 0) {
      yield* Effect.sync(() => {
        globalThis.process.exitCode = result.exitCode;
      });
    }
  }),
).pipe(Command.withDescription("Reject raw CSS colours outside reviewed theme-token sources."));

if (import.meta.main) {
  Command.run(checkCssTokensCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
