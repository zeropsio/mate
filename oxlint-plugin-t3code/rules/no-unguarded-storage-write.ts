import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, unwrapExpression } from "../utils.ts";

/**
 * A full origin throws on `localStorage.setItem`, and a throw from a store's write reaches the
 * error boundary: the app crashed on a 5 MiB origin filled by draft copies. Every write goes
 * through `writeBrowserStorage` (apps/web/src/lib/storage.ts), which frees what the owners of
 * growing keys registered, retries once and otherwise skips the write.
 */
const GUARD_MODULE = "apps/web/src/lib/storage.ts";
const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/packages/client-runtime/src/",
] as const;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

const covered = (filename: string): boolean => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const marker of SCOPE_MARKERS) {
    const index = normalized.lastIndexOf(marker);
    if (index === -1) continue;
    const path = normalized.slice(index + 1);
    return !TEST_FILE_PATTERN.test(path) && path !== GUARD_MODULE;
  }
  return false;
};

/** `localStorage`, `x.localStorage`, or a choice between storages that includes one. */
const isLocalStorage = (node: ESTree.Node): boolean => {
  const expression = Option.getOrUndefined(unwrapExpression(node));
  switch (expression?.type) {
    case "Identifier":
      return expression.name === "localStorage";
    case "MemberExpression":
      return getPropertyName(expression.property).pipe(Option.getOrUndefined) === "localStorage";
    case "ConditionalExpression":
      return isLocalStorage(expression.consequent) || isLocalStorage(expression.alternate);
    case "LogicalExpression":
      return isLocalStorage(expression.left) || isLocalStorage(expression.right);
    default:
      return false;
  }
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Write browser storage through writeBrowserStorage: a full origin never crashes the app.",
    },
  },
  create(context) {
    if (!covered(context.filename)) return {};
    return {
      CallExpression(node) {
        const callee = Option.getOrUndefined(unwrapExpression(node.callee));
        if (callee?.type !== "MemberExpression") return;
        if (getPropertyName(callee.property).pipe(Option.getOrUndefined) !== "setItem") return;
        if (!isLocalStorage(callee.object)) return;
        context.report({
          node,
          message:
            "A full localStorage throws here and crashes the app. Write through writeBrowserStorage from apps/web/src/lib/storage.ts.",
        });
      },
    };
  },
});
