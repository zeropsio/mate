import { defineRule, type ESTree } from "@oxlint/plugins";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";

/**
 * In the client runtime, data may import zerops. A zerops module may not import or re-export
 * data, even through a type-only or dynamic import. The fingerprint is the resolved target
 * relative to the source root, without its extension.
 */
const RULE_NAME = "no-upward-data-import";
const LEDGER_DIRECTORY_ENV = "T3CODE_UPWARD_DATA_LEDGER_DIRECTORY";
const RUNTIME_SOURCE = "packages/client-runtime/src/";
const SCOPE_MARKER = `/${RUNTIME_SOURCE}zerops/`;
const DATA_PACKAGE = "@t3tools/client-runtime/data";
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;
const EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/u;

const SUMMARY =
  "packages/client-runtime/src/zerops imports nothing from data: a rule over values lives in zerops, a reader of the store in data (docs/internals/zerops/data-layer.md, Where a verdict lives).";

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

/** The repo-relative path of a covered module, or undefined outside the scope. */
const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Join a relative import onto its repo-relative directory. */
const joinSegments = (segments: string[], relative: string): string | undefined => {
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return undefined;
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
};

/** Resolve relative imports and the public data package spelling to the same target. */
const resolveTarget = (path: string, source: string): string | undefined => {
  let resolved: string | undefined;
  if (source === DATA_PACKAGE || source.startsWith(`${DATA_PACKAGE}/`)) {
    resolved = joinSegments(["data"], source.slice(DATA_PACKAGE.length));
  } else if (source.startsWith("./") || source.startsWith("../")) {
    const joined = joinSegments(path.split("/").slice(0, -1), source);
    if (!joined?.startsWith(RUNTIME_SOURCE)) return undefined;
    resolved = joined.slice(RUNTIME_SOURCE.length);
  }
  return resolved?.replace(EXTENSION_PATTERN, "");
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "packages/client-runtime/src/zerops imports nothing from data.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    const check = (node: ESTree.Node, source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      const target = resolveTarget(path, source.value);
      if (target !== "data" && !target?.startsWith("data/")) return;
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
