import { defineRule, type Context, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

const RULE_NAME = "no-failure-to-empty";
const LEDGER_DIRECTORY_ENV = "T3CODE_FAILURE_TO_EMPTY_LEDGER_DIRECTORY";
const GUARDED_ROOTS = [
  "apps/web/src/zerops/",
  "apps/web/src/components/zerops/",
  "packages/client-runtime/src/zerops/",
] as const;
const HOOK_NAME_PATTERN = /^use[A-Z]/u;
const EMPTY_CONSTANT_PATTERN = /^EMPTY_/u;
// React's own local-state hooks answer what the component holds, never a store's fact.
const LOCAL_STATE_HOOKS = new Set([
  "useCallback",
  "useId",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
  "useTransition",
]);
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__\/|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$)/u;

const ledgerDirectory = globalThis.process.env[LEDGER_DIRECTORY_ENV];
const ledger = loadExceptionLedger(RULE_NAME, ledgerDirectory);

const sourcePath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const root of GUARDED_ROOTS) {
    const markerIndex = normalized.lastIndexOf(`/${root}`);
    if (markerIndex !== -1) return normalized.slice(markerIndex + 1);
  }
  return undefined;
};

/** `[]`, `undefined` or `null`: the empties a failure is turned into. */
const isEmptyValue = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return false;
  const value = expression.value;
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  if (value.type === "Identifier") return value.name === "undefined";
  return value.type === "Literal" && value.value === null && !("regex" in value);
};

/**
 * A handler that ends in an empty: `() => []`, or a block whose last statement returns one
 * (`(cause) => { log(cause); return null; }`).
 */
const answersEmpty = (node: unknown): boolean => {
  const handler = unwrapExpression(node);
  if (Option.isNone(handler)) return false;
  const fn = handler.value;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  const body = fn.body;
  if (body === null || body === undefined) return false;
  if (body.type !== "BlockStatement") return isEmptyValue(body);
  const last = body.body.at(-1);
  return last?.type === "ReturnStatement" && last.argument !== null && isEmptyValue(last.argument);
};

const isCatchCall = (node: ESTree.CallExpression): boolean => {
  const callee = unwrapExpression(node.callee);
  return (
    Option.isSome(callee) &&
    callee.value.type === "MemberExpression" &&
    !callee.value.computed &&
    Option.getOrUndefined(getPropertyName(callee.value.property)) === "catch"
  );
};

/** `[]` or an `EMPTY_…` constant: the empties a store read is defaulted to. */
const isEmptyDefault = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return false;
  const value = expression.value;
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  return value.type === "Identifier" && EMPTY_CONSTANT_PATTERN.test(value.name);
};

const isStoreHookCall = (node: ESTree.Node): boolean => {
  if (node.type !== "CallExpression") return false;
  const callee = unwrapExpression(node.callee);
  if (Option.isNone(callee)) return false;
  const name =
    callee.value.type === "MemberExpression"
      ? Option.getOrUndefined(getPropertyName(callee.value.property))
      : Option.getOrUndefined(getPropertyName(callee.value));
  return name !== undefined && HOOK_NAME_PATTERN.test(name) && !LOCAL_STATE_HOOKS.has(name);
};

/**
 * The base of a member/call chain (`deploys.get(id)?.pullRequests` → `deploys`), stopping at a
 * hook call (`useTopology().view` → `useTopology()`).
 */
const chainRoot = (node: unknown): ESTree.Node | undefined => {
  let current = Option.getOrUndefined(unwrapExpression(node));
  while (current !== undefined) {
    if (current.type === "MemberExpression") {
      current = Option.getOrUndefined(unwrapExpression(current.object));
    } else if (current.type === "CallExpression" && !isStoreHookCall(current)) {
      current = Option.getOrUndefined(unwrapExpression(current.callee));
    } else {
      return current;
    }
  }
  return undefined;
};

/**
 * A value read from a store: a hook's answer (`useAtomValue`, `useZerops…`), reached directly, by
 * member access, through destructuring, or through a chain of `const` aliases in the same file.
 * A prop, a parameter or a value passed across modules is not followed.
 */
const isStoreRead = (context: Context, node: unknown, seen: Set<ESTree.Node>): boolean => {
  const root = chainRoot(node);
  if (root === undefined || seen.has(root)) return false;
  seen.add(root);
  if (isStoreHookCall(root)) return true;
  if (root.type !== "Identifier") return false;
  const [definition, ...others] = resolveVariable(context, root)?.defs ?? [];
  return (
    others.length === 0 &&
    definition?.type === "Variable" &&
    definition.node.type === "VariableDeclarator" &&
    definition.node.init !== null &&
    isStoreRead(context, definition.node.init, seen)
  );
};

const TRANSPARENT_PARENTS = new Set([
  "AwaitExpression",
  "ChainExpression",
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
]);

/** A value nobody reads (`p.catch(…);`, `await p.catch(…);`, `void p.catch(…)`) holds no empty. */
const isDiscarded = (node: ESTree.Node): boolean => {
  let current: ESTree.Node = node;
  while (current.parent !== null && TRANSPARENT_PARENTS.has(current.parent.type)) {
    current = current.parent;
  }
  const parent = current.parent;
  return (
    parent?.type === "ExpressionStatement" ||
    (parent?.type === "UnaryExpression" && parent.operator === "void")
  );
};

/**
 * Guards the failure-to-empty shapes of the client state model
 * (`docs/internals/zerops/client-state-model.md`, "Negatives are earned") in the Zerops client
 * code: a rejected read turned into `[]`, `undefined` or `null` by `.catch`, and a store read
 * defaulted to `[]` or an `EMPTY_…` constant with `??`. Without types or inter-file data flow,
 * these stay gaps: a store read that reaches the default through a prop, a parameter or another
 * module; `.then(onFulfilled, () => [])`; Effect's `orElseSucceed` or `catch` into
 * `Effect.succeed([])`; a handler that stores the empty with a setter instead of returning it;
 * and `|| []`. A caught empty that nobody reads (`p.catch(() => undefined);`) is not a finding.
 */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Reject a failed or unread remote fact turned into an empty value; a failure is not a negative.",
    },
  },
  create(context) {
    const path = sourcePath(context.filename);
    if (path === undefined || TEST_FILE_PATTERN.test(path)) return {};

    const report = (node: ESTree.Node, summary: string) => {
      const kind = node.type;
      const fingerprint = normalizeFingerprint(context.sourceCode.text.slice(node.start, node.end));
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;

      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    return {
      CallExpression(node) {
        if (!isCatchCall(node) || !answersEmpty(node.arguments[0]) || isDiscarded(node)) return;
        report(
          node,
          "A failed read caught into an empty reads as a negative. Keep the failure: hold the value as Known and let the view say it could not read it.",
        );
      },
      LogicalExpression(node) {
        if (node.operator !== "??" || !isEmptyDefault(node.right)) return;
        if (!isStoreRead(context, node.left, new Set())) return;
        report(
          node,
          "A store read defaulted to an empty reads unread or failed as a negative. Render its Known state instead.",
        );
      },
    };
  },
});
