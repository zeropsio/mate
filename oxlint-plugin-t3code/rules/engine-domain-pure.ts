import { defineRule, type ESTree } from "@oxlint/plugins";

/**
 * The conversation's decision core imports no runtime, store or bridge: a non-test module under
 * `apps/server/src/engine/domain/` imports only a module of that directory or a source on
 * `ALLOWED_SOURCES`. Every import, re-export and dynamic import is judged, type-only ones included;
 * a relative source must resolve inside the directory. The list grows only in review, never by an
 * exception, so the rule has no ledger.
 */
const SCOPE = "apps/server/src/engine/domain/";
const SCOPE_MARKER = `/${SCOPE}`;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const ALLOWED_SOURCES: ReadonlySet<string> = new Set([
  "@t3tools/contracts",
  "@t3tools/shared/hqChanges",
  "@t3tools/shared/modelOptions",
  "@t3tools/shared/userAsk",
  "effect/Cron",
  "effect/Option",
  "effect/Result",
  "effect/Schema",
]);

const SUMMARY =
  "apps/server/src/engine/domain is the conversation's pure decision core: it imports no runtime, store or bridge, only its own modules and the sources listed in t3code/engine-domain-pure.";

/** The repo-relative path of a covered module, or undefined outside the scope. */
const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const index = normalized.lastIndexOf(SCOPE_MARKER);
  if (index === -1) return undefined;
  const path = normalized.slice(index + 1);
  return TEST_FILE_PATTERN.test(path) ? undefined : path;
};

/** Joins segments onto a base, applying `.` and `..` as a POSIX path would; undefined above the root. */
const joinSegments = (base: ReadonlyArray<string>, relative: string): string | undefined => {
  const segments = [...base];
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
};

/** Whether a covered module at `path` may import `source`. */
const allowed = (path: string, source: string): boolean => {
  if (source.startsWith("./") || source.startsWith("../")) {
    const resolved = joinSegments(path.split("/").slice(0, -1), source);
    return resolved !== undefined && resolved.startsWith(SCOPE);
  }
  return ALLOWED_SOURCES.has(source);
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "apps/server/src/engine/domain imports no runtime, store or bridge.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    const check = (node: ESTree.Node, source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (allowed(path, source.value)) return;
      context.report({ node, message: `${SUMMARY} Not allowed: "${source.value}".` });
    };

    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
});
