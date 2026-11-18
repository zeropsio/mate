import { defineRule, type ESTree } from "@oxlint/plugins";

import { engineImportAllowed } from "../engineBoundary.ts";

/**
 * The Mate engine's direction rule (`oxlint-plugin-t3code/engineBoundary.ts`): every import,
 * re-export and dynamic import with a relative source in a non-test server module, type-only ones
 * included, is resolved to its repo path and judged by the rule's lists, exactly as written (the
 * lists name `.ts` files).
 */
const SERVER_SOURCE = "apps/server/src/";
const SCOPE_MARKER = `/${SERVER_SOURCE}`;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const SUMMARY =
  "This import crosses the Mate engine's boundary: the engine reaches only its neutral seams, and only the wiring reaches its public surface (oxlint-plugin-t3code/engineBoundary.ts).";

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

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "The Mate engine reaches only its neutral seams; only the wiring reaches it.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};
    const directory = path.split("/").slice(0, -1);

    const check = (node: ESTree.Node, source: ESTree.Node | null | undefined) => {
      if (source?.type !== "Literal" || typeof source.value !== "string") return;
      if (!source.value.startsWith(".")) return;
      const target = joinSegments(directory, source.value);
      if (engineImportAllowed(path, target)) return;
      context.report({ node, message: SUMMARY });
    };

    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
});
