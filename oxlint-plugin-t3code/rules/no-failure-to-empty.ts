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

/** `[]`, `undefined` (`void …` included) or `null`: the empties a failure is turned into. */
const isEmptyValue = (node: unknown): boolean => {
  const expression = unwrapExpression(node);
  if (Option.isNone(expression)) return false;
  const value = expression.value;
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  if (value.type === "Identifier") return value.name === "undefined";
  if (value.type === "UnaryExpression") return value.operator === "void";
  return value.type === "Literal" && value.value === null && !("regex" in value);
};

/**
 * Whether a statement list can end in an empty: its last statement returns one, returns nothing,
 * or lets control run off the end (`{}`, `{ log(cause); }`, an `if` a branch of which does).
 * A `try`, `switch` or loop at the end is not followed.
 */
const endsEmpty = (statements: ReadonlyArray<ESTree.Statement>): boolean => {
  const last = statements.at(-1);
  if (last === undefined) return true;
  switch (last.type) {
    case "ReturnStatement":
      return last.argument === null || isEmptyValue(last.argument);
    case "ThrowStatement":
    case "TryStatement":
    case "SwitchStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "LabeledStatement":
      return false;
    case "BlockStatement":
      return endsEmpty(last.body);
    case "IfStatement":
      return endsEmpty([last.consequent]) || last.alternate === null || endsEmpty([last.alternate]);
    default:
      return true;
  }
};

/**
 * A handler that answers an empty: `() => []`, `() => void 0`, or a block that ends in one
 * (`(cause) => { log(cause); return null; }`, `(cause) => { log(cause); }`).
 */
const answersEmpty = (node: unknown): boolean => {
  const handler = unwrapExpression(node);
  if (Option.isNone(handler)) return false;
  const fn = handler.value;
  if (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression") return false;
  const body = fn.body;
  if (body === null || body === undefined) return false;
  return body.type === "BlockStatement" ? endsEmpty(body.body) : isEmptyValue(body);
};

/** The receiver of `receiver.method(…)`, when `node` is that call. */
const methodReceiver = (node: unknown, method: string): ESTree.Node | undefined => {
  const call = Option.getOrUndefined(unwrapExpression(node));
  if (call?.type !== "CallExpression") return undefined;
  const callee = Option.getOrUndefined(unwrapExpression(call.callee));
  return callee?.type === "MemberExpression" &&
    !callee.computed &&
    Option.getOrUndefined(getPropertyName(callee.property)) === method
    ? callee.object
    : undefined;
};

/**
 * `p.then(onFulfilled)` whose handler already answers an empty: a catch after it turns no value
 * into an empty, since the chain carries none (`.then(() => { refresh(); }).catch(…)`).
 */
const answersEmptyOnSuccess = (node: ESTree.Node): boolean => {
  const call = Option.getOrUndefined(unwrapExpression(node));
  return (
    call?.type === "CallExpression" &&
    methodReceiver(call, "then") !== undefined &&
    answersEmpty(call.arguments[0])
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

/** The property a Known's or an AsyncResult's state is in, and the state that holds a value. */
const HELD_STATES = new Map([
  ["state", "known"],
  ["_tag", "Success"],
]);
/** `AsyncResult.isSuccess(result)`: the guard form of the same check. */
const HELD_GUARDS = new Set(["isSuccess"]);
const EQUALITY_OPERATORS = new Set(["===", "==", "!==", "!="]);

/** An expression's source as a subject, so `read?.value` and `read.value` name one subject. */
const subjectText = (context: Context, node: ESTree.Node): string =>
  context.sourceCode.text.slice(node.start, node.end).replaceAll("?.", ".").replace(/\s+/gu, "");

interface HeldCheck {
  /** The Known or AsyncResult the test checks. */
  readonly subject: string;
  /** Whether the conditional's consequent is the branch that holds its value. */
  readonly heldInConsequent: boolean;
}

/**
 * A test that checks whether a Known holds its value (`read.state === "known"`, the literal on
 * either side, `!==` inverted) or an AsyncResult does (`result._tag === "Success"`,
 * `AsyncResult.isSuccess(result)`), negated with `!` or not.
 */
const heldCheck = (context: Context, node: unknown): HeldCheck | undefined => {
  const test = Option.getOrUndefined(unwrapExpression(node));
  if (test?.type === "UnaryExpression" && test.operator === "!") {
    const inner = heldCheck(context, test.argument);
    return inner === undefined
      ? undefined
      : { ...inner, heldInConsequent: !inner.heldInConsequent };
  }
  if (test?.type === "CallExpression") {
    const callee = Option.getOrUndefined(unwrapExpression(test.callee));
    const name =
      callee?.type === "MemberExpression" && !callee.computed
        ? Option.getOrUndefined(getPropertyName(callee.property))
        : Option.getOrUndefined(getPropertyName(callee));
    const subject = Option.getOrUndefined(unwrapExpression(test.arguments[0]));
    return name !== undefined && HELD_GUARDS.has(name) && subject !== undefined
      ? { subject: subjectText(context, subject), heldInConsequent: true }
      : undefined;
  }
  if (test?.type !== "BinaryExpression" || !EQUALITY_OPERATORS.has(test.operator)) return undefined;
  for (const [stateSide, literalSide] of [
    [test.left, test.right],
    [test.right, test.left],
  ] as const) {
    const state = Option.getOrUndefined(unwrapExpression(stateSide));
    const literal = Option.getOrUndefined(unwrapExpression(literalSide));
    if (state?.type !== "MemberExpression" || state.computed || literal?.type !== "Literal") {
      continue;
    }
    const property = Option.getOrUndefined(getPropertyName(state.property));
    const held = property === undefined ? undefined : HELD_STATES.get(property);
    if (held === undefined || literal.value !== held) continue;
    const subject = Option.getOrUndefined(unwrapExpression(state.object));
    if (subject === undefined) return undefined;
    return {
      subject: subjectText(context, subject),
      heldInConsequent: test.operator === "===" || test.operator === "==",
    };
  }
  return undefined;
};

/** Whether `node` reads `<subject>.value` anywhere inside it, JSX included. */
const readsValueOf = (context: Context, node: unknown, subject: string): boolean => {
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) return node.some((child) => readsValueOf(context, child, subject));
  if (!("type" in node)) return false;
  const current = node as ESTree.Node;
  if (
    current.type === "MemberExpression" &&
    !current.computed &&
    Option.getOrUndefined(getPropertyName(current.property)) === "value"
  ) {
    const object = Option.getOrUndefined(unwrapExpression(current.object));
    if (object !== undefined && subjectText(context, object) === subject) return true;
  }
  return Object.entries(current).some(
    ([key, child]) => key !== "parent" && readsValueOf(context, child, subject),
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

/** `p.finally(…)` around `p`: it settles with `p`'s value. */
const finallyCallOn = (node: ESTree.Node): ESTree.Node | undefined => {
  const member = node.parent;
  if (
    member?.type !== "MemberExpression" ||
    member.object !== node ||
    member.computed ||
    Option.getOrUndefined(getPropertyName(member.property)) !== "finally"
  ) {
    return undefined;
  }
  const call = member.parent;
  return call?.type === "CallExpression" && call.callee === member ? call : undefined;
};

/**
 * A value nobody reads (`p.catch(…);`, `await p.catch(…);`, `void p.catch(…)`, also after a
 * `.finally(…)`) holds no empty.
 */
const isDiscarded = (node: ESTree.Node): boolean => {
  let current: ESTree.Node = node;
  for (;;) {
    if (current.parent !== null && TRANSPARENT_PARENTS.has(current.parent.type)) {
      current = current.parent;
      continue;
    }
    const settled = finallyCallOn(current);
    if (settled === undefined) break;
    current = settled;
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
 * code: a rejected read turned into `[]`, `undefined` or `null` by `.catch` (a handler that
 * returns nothing or runs off its end answers `undefined`), a store read defaulted to `[]` or
 * an `EMPTY_…` constant with `??`, and a conditional that checks whether a Known or an
 * AsyncResult holds its value, reads that `.value` on one branch and answers `[]`, `undefined`,
 * `null` or an `EMPTY_…` constant on the other (`read.state === "known" ? read.value.rows : []`,
 * JSX that renders `null` included). Without types or inter-file data flow, these stay gaps: a
 * store read that reaches the default through a prop, a parameter or another module;
 * `.then(onFulfilled, () => [])`; Effect's `orElseSucceed` or `catch` into `Effect.succeed([])`;
 * a handler that stores the empty with a setter instead of returning it; a handler ending in a
 * `try`, `switch` or loop; and `|| []`. Not a finding: a caught empty that nobody reads
 * (`p.catch(() => undefined);`, also after a `.finally`), and a catch after a `.then` handler
 * that already answers an empty, since that chain carries no value to lose. A command's promise
 * kept after a catch that answers nothing (`return signOut().catch(show)`) reads the same as a
 * read and is reported.
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
        const receiver = methodReceiver(node, "catch");
        if (receiver === undefined || !answersEmpty(node.arguments[0])) return;
        if (answersEmptyOnSuccess(receiver) || isDiscarded(node)) return;
        report(
          node,
          "A failed read caught into an empty reads as a negative. Keep the failure: hold the value as Known and let the view say it could not read it.",
        );
      },
      ConditionalExpression(node) {
        const check = heldCheck(context, node.test);
        if (check === undefined) return;
        const [held, otherwise] = check.heldInConsequent
          ? [node.consequent, node.alternate]
          : [node.alternate, node.consequent];
        if (!isEmptyValue(otherwise) && !isEmptyDefault(otherwise)) return;
        if (!readsValueOf(context, held, check.subject)) return;
        report(
          node,
          "A Known or a result that holds no value turned into an empty reads unread or failed as a negative. Render its state: a placeholder while it is read, the cause when it failed.",
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
