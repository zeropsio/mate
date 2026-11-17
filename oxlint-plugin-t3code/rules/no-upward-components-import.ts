import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

/**
 * `apps/web/src/zerops` sits below `components/`: an answer it needs lives with it or below, never
 * in a surface. Every import, re-export and dynamic import from a non-test module there that
 * resolves into `apps/web/src/components/` is reported, type-only ones included. The fingerprint
 * is the resolved target, so `~/` and relative spellings of one module are one identity.
 */
const RULE_NAME = "no-upward-components-import";
const LEDGER_DIRECTORY_ENV = "T3CODE_UPWARD_COMPONENTS_LEDGER_DIRECTORY";
const WEB_SOURCE = "apps/web/src/";
const SCOPE_MARKER = `/${WEB_SOURCE}zerops/`;
const TARGET_PREFIX = "components/";
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;
const EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/u;

const SUMMARY =
  "apps/web/src/zerops imports nothing from components/: move the answer down (docs/internals/zerops/data-layer.md, Where a verdict lives).";

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

/** The repo-relative path of a covered module, or undefined outside the scope. */
const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Joins segments onto a base, applying `.` and `..` as a POSIX path would. */
const joinSegments = (base: ReadonlyArray<string>, relative: string): string => {
  const segments = [...base];
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
};

/** The import's target relative to `apps/web/src`, without extension; undefined for packages. */
const resolveTarget = (path: string, source: string): string | undefined => {
  let resolved: string;
  if (source.startsWith("~/")) {
    resolved = joinSegments([], source.slice(2));
  } else if (source.startsWith("./") || source.startsWith("../")) {
    resolved = joinSegments(path.slice(WEB_SOURCE.length).split("/").slice(0, -1), source);
  } else {
    return undefined;
  }
  return resolved.replace(EXTENSION_PATTERN, "");
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "apps/web/src/zerops imports nothing from apps/web/src/components.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    const check = (node: ESTree.Node, source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      const target = resolveTarget(path, source.value);
      if (target === undefined || !target.startsWith(TARGET_PREFIX)) return;
      const kind = node.type;
      const fingerprint = normalizeFingerprint(target);
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: SUMMARY,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
});
